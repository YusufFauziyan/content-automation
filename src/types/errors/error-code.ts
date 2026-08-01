/**
 * Stable, machine-readable identifier carried by every {@link ApplicationError}.
 *
 * Codes are part of the public contract: they are persisted in
 * `workflow_runs.last_error` and consumed by retry logic and dashboards.
 * Never rename a code — deprecate it and add a new one.
 */
export enum ErrorCode {
  /** Environment or configuration failed validation on startup. */
  ConfigurationInvalid = 'CONFIGURATION_INVALID',
  /** The code path exists but is scheduled for a later milestone. */
  NotImplemented = 'NOT_IMPLEMENTED',
  /** A database read or write failed. */
  PersistenceFailure = 'PERSISTENCE_FAILURE',
  /** A record required by the caller does not exist. */
  RecordNotFound = 'RECORD_NOT_FOUND',
  /** A workflow step exhausted its retries or failed unrecoverably. */
  WorkflowStepFailed = 'WORKFLOW_STEP_FAILED',

  /** The AI router rejected the request or was unreachable. */
  AiRequestFailed = 'AI_REQUEST_FAILED',
  /** The AI router did not answer within the configured timeout. */
  AiTimeout = 'AI_TIMEOUT',
  /** A router call used its whole retry budget without succeeding. */
  AiRetriesExhausted = 'AI_RETRIES_EXHAUSTED',
  /** The AI router answered, but not with the agreed structure. */
  AiInvalidResponse = 'AI_INVALID_RESPONSE',

  /** The fallback image provider rejected the request or was unreachable. */
  ImageProviderRequestFailed = 'IMAGE_PROVIDER_REQUEST_FAILED',
  /** The fallback image provider did not answer within the configured timeout. */
  ImageProviderTimeout = 'IMAGE_PROVIDER_TIMEOUT',
  /** The fallback image provider answered, but not with usable image data. */
  ImageProviderInvalidResponse = 'IMAGE_PROVIDER_INVALID_RESPONSE',
  /** A fallback image call used its whole retry budget without succeeding. */
  ImageProviderRetriesExhausted = 'IMAGE_PROVIDER_RETRIES_EXHAUSTED',

  /** The speech server rejected the request or was unreachable. */
  SpeechRequestFailed = 'SPEECH_REQUEST_FAILED',
  /** The speech server did not answer within the configured timeout. */
  SpeechTimeout = 'SPEECH_TIMEOUT',
  /** The speech server answered, but not with usable audio. */
  SpeechInvalidResponse = 'SPEECH_INVALID_RESPONSE',
  /** A speech call used its whole retry budget without succeeding. */
  SpeechRetriesExhausted = 'SPEECH_RETRIES_EXHAUSTED',

  /** FFmpeg exited with a failure. */
  RenderFailed = 'RENDER_FAILED',
  /** A render exceeded its configured time budget. */
  RenderTimeout = 'RENDER_TIMEOUT',
  /** The FFmpeg binary could not be run at all. */
  RenderToolUnavailable = 'RENDER_TOOL_UNAVAILABLE',
  /** A render used its whole retry budget without succeeding. */
  RenderRetriesExhausted = 'RENDER_RETRIES_EXHAUSTED',

  /** A prompt file is missing from the prompts directory. */
  PromptNotFound = 'PROMPT_NOT_FOUND',
  /** A prompt template contains a placeholder the caller did not supply. */
  PromptPlaceholderMissing = 'PROMPT_PLACEHOLDER_MISSING',

  /** A model answered with a payload that failed the agent's own validation. */
  AgentOutputInvalid = 'AGENT_OUTPUT_INVALID',
  /** No unique topic could be found within the configured attempt budget. */
  TopicNotUnique = 'TOPIC_NOT_UNIQUE',

  /** The run's working directory could not be prepared or written to. */
  WorkspaceFailure = 'WORKSPACE_FAILURE',
  /** An identifier would have escaped the working directory. */
  WorkspaceUnsafePath = 'WORKSPACE_UNSAFE_PATH',
}
