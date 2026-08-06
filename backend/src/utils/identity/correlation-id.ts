import { randomUUID } from 'node:crypto';

/**
 * Creates the identifier that ties every log record, workflow step and error
 * of a single pipeline execution together.
 *
 * Generated once per run by the use-case and never derived from run data, so
 * that a resumed run keeps the identity of the run it continues.
 */
export const createCorrelationId = (): string => randomUUID();
