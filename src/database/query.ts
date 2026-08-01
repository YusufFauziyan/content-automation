import { Prisma } from './generated/client.js';
import { PersistenceError } from '../types/errors/persistence.error.js';

/**
 * Runs a Prisma query and translates any driver failure into a typed,
 * retryable {@link PersistenceError}.
 *
 * Repositories must never leak a raw driver error upwards: the workflow decides
 * whether to retry based on `error.retryable`, and a `PrismaClientKnownRequestError`
 * carries no such flag.
 *
 * @param description Human-readable operation name used in the error message.
 * @param query       The Prisma call to execute.
 */
export const runQuery = async <TResult>(
  description: string,
  query: () => Promise<TResult>,
): Promise<TResult> => {
  try {
    return await query();
  } catch (error) {
    throw new PersistenceError(`${description} failed.`, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Boundary cast for values written into a Prisma `Json` column.
 *
 * DTOs are plain, JSON-serialisable structures, but TypeScript cannot prove
 * that to Prisma's recursive `InputJsonValue` type. The assertion is confined
 * to this helper so it never spreads into the repositories.
 */
export const toJsonColumn = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

/**
 * Boundary cast for values read from a Prisma `Json` column.
 *
 * The shape is guaranteed by the writer, not by the database, so this is the
 * one place where that trust is made explicit.
 */
// The type parameter appears once by design: it is the shape the caller claims
// the column holds, which is exactly the trust this helper isolates.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export const fromJsonColumn = <TValue>(value: Prisma.JsonValue | null): TValue | null =>
  value === null ? null : (value as TValue);

/**
 * Boundary cast for a nullable `Json` column.
 *
 * PostgreSQL distinguishes a JSON `null` value from a SQL `NULL` column, so
 * Prisma requires the explicit `DbNull` sentinel to clear the column.
 */
export const toNullableJsonColumn = (
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull => value ?? Prisma.DbNull;
