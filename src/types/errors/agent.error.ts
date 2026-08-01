import { ApplicationError, type ErrorDetails } from './application.error.js';
import { ErrorCode } from './error-code.js';

/**
 * Raised when a model answered with a payload the agent cannot accept.
 *
 * Retryable: the prompt and the input are unchanged, so another sample from the
 * model is a legitimate second chance.
 */
export class AgentOutputInvalidError extends ApplicationError {
  constructor(agentName: string, reason: string, details?: ErrorDetails) {
    super({
      code: ErrorCode.AgentOutputInvalid,
      message: `${agentName} received an unusable response: ${reason}`,
      retryable: true,
      details: { agentName, reason, ...(details ?? {}) },
    });
  }
}

/**
 * Raised when the attempt budget for finding a unique topic is exhausted.
 *
 * Not retryable at the workflow level: the agent already retried internally,
 * and repeating the whole step would only repeat that loop.
 */
export class TopicNotUniqueError extends ApplicationError {
  constructor(attempts: number, rejectedTitles: readonly string[]) {
    super({
      code: ErrorCode.TopicNotUnique,
      message: `No unique topic found after ${String(attempts)} attempts.`,
      retryable: false,
      details: { attempts, rejectedTitles },
    });
  }
}
