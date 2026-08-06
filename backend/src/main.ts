import 'dotenv/config';

import { createApplication, type Application } from './composition-root.js';
import { startHttpServer } from './http-server.js';
import { loadConfig } from './config/config.loader.js';
import { isApplicationError } from './types/errors/application.error.js';
import { ExitCode } from './controllers/cli.controller.js';

/**
 * Process entry point.
 *
 * Responsibilities, in order: load and validate configuration, assemble the
 * application, hand the arguments to the controller, and always release the
 * connection pool — including when a signal interrupts the run.
 */

/** Signals that must lead to an orderly shutdown rather than an abrupt exit. */
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/**
 * Reports a startup failure.
 *
 * Used before the logger exists, which is the only situation in which writing
 * straight to a process stream is appropriate.
 */
const reportFatal = (error: unknown): void => {
  const payload = isApplicationError(error)
    ? error.toJSON()
    : { message: error instanceof Error ? error.message : String(error) };

  process.stderr.write(`${JSON.stringify({ level: 'ERROR', ...payload })}\n`);
};

/** Registers signal handlers that shut the application down once. */
const registerShutdownHandlers = (application: Application): void => {
  let shuttingDown = false;

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;

      application.logger.info('Shutdown signal received', { signal });

      void application.shutdown().finally(() => {
        process.exit(ExitCode.Failure);
      });
    });
  }
};

/** Runs inspected for stranded steps when the server starts. */
const RECONCILE_LIMIT = 200;

/**
 * How often schedules are checked.
 *
 * A minute is far finer than any schedule needs — the shortest interval an
 * operator can set is fifteen — but it keeps a due schedule from sitting idle
 * for a noticeable stretch, and the check itself is one indexed query.
 */
const SCHEDULE_TICK_MS = 60_000;

const main = async (): Promise<ExitCode> => {
  const config = loadConfig();
  const application = createApplication(config);

  registerShutdownHandlers(application);

  const argv = process.argv.slice(2);

  // `serve` is the one command that does not end: it hands the same use-cases
  // the CLI drives to an HTTP API and waits. Shutdown is left to the signal
  // handlers registered above.
  if (argv[0] === 'serve') {
    // Nothing this process inherited is still executing. Say so before serving,
    // or the editor spends forever showing a spinner for work that stopped.
    const settled = await application.reconcileRunsUseCase.execute(RECONCILE_LIMIT);

    if (settled.runs > 0) {
      application.logger.info('Settled interrupted runs at startup', {
        source: 'main',
        runs: settled.runs,
        steps: settled.steps,
      });
    }

    // The schedules only advance while something is serving. That is the point:
    // a video nobody is around to see fail is not worth making, and tying the
    // timer to the API means one process owns both.
    const scheduleTimer = setInterval(() => {
      void application.runSchedulesUseCase.tick().then(
        (result) => {
          if (result.fired > 0) {
            application.logger.info('Schedules fired', {
              source: 'main',
              fired: result.fired,
              started: result.started,
            });
          }
        },
        (error: unknown) => {
          application.logger.error('A schedule tick failed', error, { source: 'main' });
        },
      );
    }, SCHEDULE_TICK_MS);
    scheduleTimer.unref();

    startHttpServer(application.httpController, config.http.port, application.logger);
    // Resolves only on a shutdown signal, which the handlers above own.
    await new Promise<never>(() => {
      /* intentionally never settles */
    });
    return ExitCode.Success;
  }

  try {
    return await application.controller.run(argv);
  } finally {
    await application.shutdown();
  }
};

try {
  process.exitCode = await main();
} catch (error) {
  reportFatal(error);
  process.exitCode = ExitCode.Failure;
}
