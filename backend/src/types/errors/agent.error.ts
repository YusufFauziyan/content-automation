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
/**
 * Raised when a topic somebody typed already exists.
 *
 * Distinct from {@link TopicNotUniqueError}, which means the model ran out of
 * fresh ideas. Here nothing was generated and nothing will be: the person named
 * a subject the library already covers, and the way forward is to name a
 * different one or remove the existing topic — not to try again.
 */
export class TopicAlreadyExistsError extends ApplicationError {
  constructor(title: string) {
    super({
      code: ErrorCode.TopicNotUnique,
      message: `A topic covering "${title}" already exists. Pick a different subject.`,
      retryable: false,
      details: { title },
    });
  }
}

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
