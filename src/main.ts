import 'dotenv/config';

import { createApplication, type Application } from './composition-root.js';
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

const main = async (): Promise<ExitCode> => {
  const config = loadConfig();
  const application = createApplication(config);

  registerShutdownHandlers(application);

  try {
    return await application.controller.run(process.argv.slice(2));
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
