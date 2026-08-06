import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/client.js';
import type { DatabaseConfig } from '../config/app.config.js';

/**
 * The database handle passed to repositories.
 *
 * Repositories depend on this alias rather than on the generated client, so the
 * generated code stays an implementation detail of the database layer.
 */
export type Database = PrismaClient;

/**
 * Creates the Prisma client backed by the `pg` driver adapter.
 *
 * Prisma 7 has no built-in connection handling: the adapter owns the pool, so
 * pool sizing is configuration and not a hard-coded constant.
 *
 * @param config Validated database settings.
 */
export const createDatabase = (config: DatabaseConfig): Database => {
  const adapter = new PrismaPg({
    connectionString: config.url,
    max: config.poolSize,
  });

  return new PrismaClient({ adapter });
};
