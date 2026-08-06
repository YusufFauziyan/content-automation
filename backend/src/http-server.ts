import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { HttpController } from './controllers/http.controller.js';
import type { Logger } from './types/logger.js';

/** Requests larger than this are refused rather than buffered. */
const MAX_BODY_BYTES = 1_000_000;

/**
 * Puts the HTTP controller on a socket.
 *
 * Deliberately thin: it parses a request into the controller's plain input
 * shape, writes the reply, and owns no routing and no error mapping of its own.
 * Everything a reader needs in order to know what the API does is in the
 * controller, not here.
 */
export function startHttpServer(
  controller: HttpController,
  port: number,
  logger: Logger,
): { close: () => Promise<void> } {
  const server = createServer((request, response) => {
    void serve(controller, request, response, logger);
  });

  // Without this a busy port raises an unhandled 'error' event and the process
  // dies with a stack trace instead of a sentence anyone can act on.
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${String(port)} is already in use. Stop the other server or set HTTP_PORT.`, error, {
        source: 'HttpServer',
        port,
      });
    } else {
      logger.error('The HTTP server failed', error, { source: 'HttpServer', port });
    }
    process.exitCode = 1;
    server.close();
  });

  server.listen(port, () => {
    logger.info('HTTP API listening', { source: 'HttpServer', port });
  });

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

async function serve(
  controller: HttpController,
  request: IncomingMessage,
  response: ServerResponse,
  logger: Logger,
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  // The editor is served from a different origin in development.
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'content-type');
  response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');

  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    logger.warn('Rejected a request body', {
      source: 'HttpServer',
      reason: error instanceof Error ? error.message : String(error),
    });
    write(response, 400, { error: 'The request body could not be read as JSON.' });
    return;
  }

  const reply = await controller.handle({
    method: request.method ?? 'GET',
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    body,
  });

  write(response, reply.status, reply.body);
}

function write(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const carriesBody = ['POST', 'PUT', 'PATCH', 'DELETE'];

  if (!carriesBody.includes(request.method ?? '')) {
    return undefined;
  }

  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new Error(`Body exceeds ${String(MAX_BODY_BYTES)} bytes.`);
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text === '' ? undefined : JSON.parse(text);
}
