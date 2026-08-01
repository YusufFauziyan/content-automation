import 'dotenv/config';

import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * Prisma 7 no longer reads `.env` implicitly, so `dotenv/config` is imported
 * above. The schema and migrations live inside `src/database/` because the
 * database is an infrastructure concern owned by the repository layer.
 *
 * The connection URLs are attached only when they exist: `prisma generate`
 * needs no database at all, and it runs during the Docker build where no `.env`
 * is present. Leaving `SHADOW_DATABASE_URL` unset simply lets Prisma create a
 * temporary shadow database itself.
 */
const databaseUrl = process.env['DATABASE_URL'];
const shadowDatabaseUrl = process.env['SHADOW_DATABASE_URL'];

const datasource = {
  ...(databaseUrl === undefined ? {} : { url: databaseUrl }),
  ...(shadowDatabaseUrl === undefined ? {} : { shadowDatabaseUrl }),
};

export default defineConfig({
  experimental: {
    // Required to declare `extensions = [vector]` on the datasource, which lets
    // Prisma manage the pgvector extension through migrations instead of
    // hand-written SQL.
    extensions: true,
  },
  schema: 'src/database/prisma/schema.prisma',
  migrations: {
    path: 'src/database/migrations',
  },
  datasource,
});
