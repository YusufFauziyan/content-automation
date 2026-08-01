import type { Result } from './result.js';

/**
 * Contract shared by every agent.
 *
 * An agent owns exactly one business decision. It takes a DTO, returns a DTO,
 * and never throws for expected failures — it returns a failed {@link Result}
 * so the workflow can consult `error.retryable`.
 *
 * @typeParam TInput  DTO consumed by the agent.
 * @typeParam TOutput DTO produced by the agent.
 */
export interface Agent<TInput, TOutput> {
  /** Human-readable name used in logs and in `workflow_step_runs`. */
  readonly name: string;

  execute(input: TInput): Promise<Result<TOutput>>;
}
