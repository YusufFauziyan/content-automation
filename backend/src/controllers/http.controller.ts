import type { ImageConfig } from '../config/app.config.js';
import type { PipelineRequestDto } from '../dto/workflow-context.dto.js';
import type { ReadRunsUseCase } from '../use-cases/read-runs.usecase.js';
import type { DeleteRunsUseCase } from '../use-cases/delete-runs.usecase.js';
import type { GenerateContentUseCase } from '../use-cases/generate-content.usecase.js';
import type { ResumeRunUseCase } from '../use-cases/resume-run.usecase.js';
import { CredentialAuthMethod, CredentialPlatform } from '../dto/credential.dto.js';
import { UploadPlatform, UploadStatus } from '../types/upload.js';
import { WorkflowStepName, WorkflowStepStatus } from '../types/workflow.js';
import type { CaptureSessionUseCase } from '../use-cases/capture-session.usecase.js';
import type { ManageUploadsUseCase } from '../use-cases/manage-uploads.usecase.js';
import type { ReadUploadsUseCase } from '../use-cases/read-uploads.usecase.js';
import type { PublishRunUseCase } from '../use-cases/publish-run.usecase.js';
import { SETTLEABLE, type SettleStepUseCase } from '../use-cases/settle-step.usecase.js';
import type { ManageCredentialsUseCase } from '../use-cases/manage-credentials.usecase.js';
import type { ManageSchedulesUseCase } from '../use-cases/manage-schedules.usecase.js';
import type { SuggestTopicsUseCase } from '../use-cases/suggest-topics.usecase.js';
import { isApplicationError } from '../types/errors/application.error.js';
import { ErrorCode } from '../types/errors/error-code.js';
import type { Logger } from '../types/logger.js';

/** What a handler gives back, before it becomes an HTTP response. */
export interface HttpReply {
  readonly status: number;
  readonly body: unknown;
}

export interface HttpRequest {
  readonly method: string;
  /** Path only — the query string is already split off. */
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  /** Parsed JSON body, or undefined when there was none. */
  readonly body?: unknown;
}

/**
 * Pipeline parameters used when a resumed run still needs them.
 *
 * A resumed run has already decided its topic and script, so these only matter
 * for steps that never ran. They are overridable per request rather than fixed
 * in configuration, because the caller knows what it is continuing.
 */
const RESUME_DEFAULTS: PipelineRequestDto = {
  category: 'technology',
  language: 'en',
  audience: 'general',
  durationSeconds: 45,
  visualStyle: 'cinematic',
  aspectRatio: '9:16',
};

/** Runs listed by default. Enough for a sidebar, small enough for one query. */
const DEFAULT_LIMIT = 25;

/** Suggestions returned by default, and the most a caller may ask for. */
const DEFAULT_IDEAS = 5;
const MAX_IDEAS = 10;

/** Log lines returned by default, and the ceiling a caller may ask for. */
const DEFAULT_LOG_LINES = 200;
const MAX_LOG_LINES = 1000;

/**
 * Translates HTTP into use-case calls, and typed errors back into statuses.
 *
 * It knows nothing about how the request arrived — no server, no sockets, no
 * framework — which is what lets the routing table be tested by calling
 * {@link handle} with a plain object.
 *
 * The one rule it enforces on its own is the mapping from `ErrorCode` to status.
 * Every other decision belongs to a use case.
 */
export class HttpController {
  constructor(
    private readonly readRunsUseCase: ReadRunsUseCase,
    private readonly resumeRunUseCase: ResumeRunUseCase,
    private readonly deleteRunsUseCase: DeleteRunsUseCase,
    private readonly generateContentUseCase: GenerateContentUseCase,
    private readonly suggestTopicsUseCase: SuggestTopicsUseCase,
    private readonly manageSchedulesUseCase: ManageSchedulesUseCase,
    private readonly manageCredentialsUseCase: ManageCredentialsUseCase,
    private readonly readUploadsUseCase: ReadUploadsUseCase,
    private readonly manageUploadsUseCase: ManageUploadsUseCase,
    private readonly settleStepUseCase: SettleStepUseCase,
    private readonly publishRunUseCase: PublishRunUseCase,
    /** Null when browser publishing is switched off. */
    private readonly captureSessionUseCase: CaptureSessionUseCase | null,
    private readonly imageConfig: ImageConfig,
    private readonly logger: Logger,
  ) {}

  public async handle(request: HttpRequest): Promise<HttpReply> {
    try {
      return await this.route(request);
    } catch (error) {
      this.logger.error('Request failed', error, {
        source: HttpController.name,
        method: request.method,
        path: request.path,
      });

      if (isApplicationError(error)) {
        return {
          status: STATUS_BY_CODE[error.code] ?? 500,
          body: { error: error.message, code: error.code, retryable: error.retryable },
        };
      }

      return { status: 500, body: { error: 'Something went wrong on the server.' } };
    }
  }

  private async route(request: HttpRequest): Promise<HttpReply> {
    const segments = request.path.split('/').filter(Boolean);
    const [namespace, collection, runId, action] = segments;

    // GET /api/health
    if (request.method === 'GET' && segments.join('/') === 'api/health') {
      return { status: 200, body: { ok: true } };
    }

    // GET /api/config — what the editor shows for env-backed fields.
    if (request.method === 'GET' && segments.join('/') === 'api/config') {
      return {
        status: 200,
        body: {
          imageWidth: this.imageConfig.width,
          imageHeight: this.imageConfig.height,
          aspectRatio: this.imageConfig.aspectRatio,
        },
      };
    }

    // GET /api/logs
    if (request.method === 'GET' && segments.join('/') === 'api/logs') {
      const limit = Math.min(Number(request.query['limit']) || DEFAULT_LOG_LINES, MAX_LOG_LINES);
      return { status: 200, body: { logs: await this.readRunsUseCase.recentLogs(limit) } };
    }

    const onUploads = namespace === 'api' && collection === 'uploads';

    // GET /api/uploads — what has been published, newest first.
    if (request.method === 'GET' && onUploads && runId === undefined) {
      const limit = Number(request.query['limit']) || undefined;

      return {
        status: 200,
        body: { uploads: await this.readUploadsUseCase.history(limit) },
      };
    }

    // POST /api/uploads  { workflowRunId, platform, externalUrl?, status? }
    // Recording a publish the system did not perform.
    if (request.method === 'POST' && onUploads && runId === undefined) {
      const body = (request.body ?? {}) as {
        workflowRunId?: unknown;
        platform?: unknown;
        externalUrl?: unknown;
        status?: unknown;
      };

      if (typeof body.workflowRunId !== 'string' || body.workflowRunId === '') {
        return { status: 400, body: { error: 'Say which run was published.' } };
      }

      const platform =
        body.platform === undefined
          ? UploadPlatform.TikTok
          : Object.values(UploadPlatform).find((value) => value === body.platform);

      if (platform === undefined) {
        return { status: 400, body: { error: 'Name a platform this can publish to.' } };
      }

      const status = Object.values(UploadStatus).find((value) => value === body.status);

      return {
        status: 201,
        body: await this.manageUploadsUseCase.record({
          workflowRunId: body.workflowRunId,
          platform,
          ...(typeof body.externalUrl === 'string' ? { externalUrl: body.externalUrl } : {}),
          ...(status === undefined ? {} : { status }),
        }),
      };
    }

    // PATCH /api/uploads/:id  { externalUrl?, status? }
    if (request.method === 'PATCH' && onUploads && runId !== undefined) {
      const body = (request.body ?? {}) as { externalUrl?: unknown; status?: unknown };
      const status = Object.values(UploadStatus).find((value) => value === body.status);

      if (body.status !== undefined && status === undefined) {
        return { status: 400, body: { error: 'That is not a status an upload can be in.' } };
      }

      return {
        status: 200,
        body: await this.manageUploadsUseCase.edit(runId, {
          ...(typeof body.externalUrl === 'string' ? { externalUrl: body.externalUrl } : {}),
          ...(status === undefined ? {} : { status }),
        }),
      };
    }

    // DELETE /api/uploads  { ids: [...] } — forgets the record, not the video.
    if (request.method === 'DELETE' && onUploads && runId === undefined) {
      const { ids } = (request.body ?? {}) as { ids?: unknown };

      if (!Array.isArray(ids) || ids.length === 0) {
        return { status: 400, body: { error: 'Select at least one upload.' } };
      }

      return {
        status: 200,
        body: {
          deleted: await this.manageUploadsUseCase.remove(
            ids.filter((id): id is string => typeof id === 'string'),
          ),
        },
      };
    }

    // GET /api/runs
    if (request.method === 'GET' && segments.join('/') === 'api/runs') {
      const limit = Number(request.query['limit']) || DEFAULT_LIMIT;
      return { status: 200, body: { runs: await this.readRunsUseCase.list(limit) } };
    }

    const onRun = namespace === 'api' && collection === 'runs' && runId !== undefined;

    // POST /api/runs/:id/publish  { platform? }
    // Publishes an existing video again — one destination, or every connected
    // one. Nothing is re-rendered.
    if (request.method === 'POST' && onRun && segments[3] === 'publish') {
      const { platform } = (request.body ?? {}) as { platform?: unknown };
      const only = Object.values(UploadPlatform).find((value) => value === platform);

      if (platform !== undefined && only === undefined) {
        return { status: 400, body: { error: 'Name a platform this can publish to.' } };
      }

      const result = await this.publishRunUseCase.execute(
        runId,
        only === undefined ? undefined : [only],
      );

      if (result.success) {
        return { status: 200, body: { workflowRunId: runId, published: only ?? 'all connected' } };
      }

      // The step wrapper says "Workflow step UPLOAD failed", which tells the
      // person who pressed the button nothing. What they need is the reason
      // underneath it — "no enabled account", "the session expired".
      const cause: unknown = result.error.details['cause'];
      const reason =
        typeof cause === 'object' && cause !== null && 'message' in cause
          ? String(cause.message)
          : result.error.message;

      return { status: 409, body: { error: reason, code: result.error.code } };
    }

    // PATCH /api/runs/:id/steps/:step  { status }
    // The escape hatch for a step nothing is executing any more.
    if (request.method === 'PATCH' && onRun && segments[3] === 'steps' && segments[4] !== undefined) {
      const { status } = (request.body ?? {}) as { status?: unknown };
      const step = Object.values(WorkflowStepName).find((value) => value === segments[4]);
      const wanted = Object.values(WorkflowStepStatus).find((value) => value === status);

      if (step === undefined) {
        return { status: 400, body: { error: 'That is not a step this pipeline has.' } };
      }
      if (wanted === undefined || !SETTLEABLE.includes(wanted)) {
        return {
          status: 400,
          body: { error: 'A step can be settled as SUCCEEDED or FAILED, nothing else.' },
        };
      }

      await this.settleStepUseCase.settle(runId, step, wanted);

      return { status: 200, body: { workflowRunId: runId, step, status: wanted } };
    }

    const onCredentials = namespace === 'api' && collection === 'credentials';
    // `/api/credentials/capture/:id` — one segment deeper than the rest of the
    // collection, so it is matched before `:id` can claim the word "capture".
    const onCapture = onCredentials && runId === 'capture';

    // POST /api/credentials/capture  { platform, label }
    if (request.method === 'POST' && onCapture && segments[3] === undefined) {
      const body = (request.body ?? {}) as { platform?: unknown; label?: unknown };
      const platform = Object.values(CredentialPlatform).find((value) => value === body.platform);

      if (platform === undefined) {
        return { status: 400, body: { error: 'Name one of TIKTOK, INSTAGRAM, THREADS, YOUTUBE.' } };
      }
      if (typeof body.label !== 'string' || body.label.trim() === '') {
        return { status: 400, body: { error: 'Give the account a handle.' } };
      }
      if (this.captureSessionUseCase === null) {
        return {
          status: 503,
          body: { error: 'Browser publishing is switched off — TIKTOK_UPLOAD_URL is not set.' },
        };
      }

      // 202: a browser has been asked for, and nobody has signed in yet.
      return {
        status: 202,
        body: this.captureSessionUseCase.start({ platform, label: body.label.trim() }),
      };
    }

    // GET /api/credentials/capture/:id
    if (request.method === 'GET' && onCapture && segments[3] !== undefined) {
      const state = this.captureSessionUseCase?.status(segments[3]) ?? null;

      return state === null
        ? { status: 404, body: { error: 'That sign-in is no longer being tracked.' } }
        : { status: 200, body: state };
    }

    // GET /api/credentials — metadata only; no secret is ever returned.
    if (request.method === 'GET' && onCredentials && runId === undefined) {
      return {
        status: 200,
        body: { credentials: await this.manageCredentialsUseCase.list() },
      };
    }

    // POST /api/credentials  { platform, authMethod?, label, fields }
    if (request.method === 'POST' && onCredentials && runId === undefined) {
      const body = (request.body ?? {}) as {
        platform?: unknown;
        authMethod?: unknown;
        label?: unknown;
        fields?: unknown;
      };

      const platform = Object.values(CredentialPlatform).find((value) => value === body.platform);

      if (platform === undefined) {
        return { status: 400, body: { error: 'Name one of TIKTOK, INSTAGRAM, THREADS, YOUTUBE.' } };
      }

      // Omitting the method means the platform's own API — what every caller
      // written before browser sessions existed intended.
      const authMethod =
        body.authMethod === undefined
          ? CredentialAuthMethod.Api
          : Object.values(CredentialAuthMethod).find((value) => value === body.authMethod);

      if (authMethod === undefined) {
        return { status: 400, body: { error: 'Name one of API, BROWSER.' } };
      }
      if (typeof body.label !== 'string' || body.label.trim() === '') {
        return { status: 400, body: { error: 'Give the account a handle.' } };
      }
      if (typeof body.fields !== 'object' || body.fields === null) {
        return { status: 400, body: { error: 'Send the credential fields.' } };
      }

      const credential = await this.manageCredentialsUseCase.connect({
        platform,
        authMethod,
        label: body.label.trim(),
        fields: body.fields as Record<string, string>,
      });

      return { status: 201, body: credential };
    }

    // PATCH /api/credentials/:id  { enabled }
    if (request.method === 'PATCH' && onCredentials && runId !== undefined) {
      const { enabled } = (request.body ?? {}) as { enabled?: unknown };

      if (typeof enabled !== 'boolean') {
        return { status: 400, body: { error: 'Send { "enabled": true } or false.' } };
      }

      return { status: 200, body: await this.manageCredentialsUseCase.setEnabled(runId, enabled) };
    }

    // DELETE /api/credentials  { ids: [...] }
    if (request.method === 'DELETE' && onCredentials && runId === undefined) {
      const { ids } = (request.body ?? {}) as { ids?: unknown };

      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
        return { status: 400, body: { error: 'Send { "ids": ["…"] } naming the credentials.' } };
      }

      return {
        status: 200,
        body: { deleted: await this.manageCredentialsUseCase.remove(ids as string[]) },
      };
    }

    const onSchedules = namespace === 'api' && collection === 'schedules';

    // GET /api/schedules
    if (request.method === 'GET' && onSchedules && runId === undefined) {
      return { status: 200, body: { schedules: await this.manageSchedulesUseCase.list() } };
    }

    // POST /api/schedules  { name, language, intervalMinutes }
    if (request.method === 'POST' && onSchedules && runId === undefined) {
      const body = (request.body ?? {}) as {
        name?: unknown;
        language?: unknown;
        intervalMinutes?: unknown;
      };

      if (typeof body.name !== 'string' || body.name.trim() === '') {
        return { status: 400, body: { error: 'Give the schedule a name.' } };
      }
      if (typeof body.intervalMinutes !== 'number' || !Number.isFinite(body.intervalMinutes)) {
        return { status: 400, body: { error: 'Say how many minutes between videos.' } };
      }

      const schedule = await this.manageSchedulesUseCase.create({
        name: body.name.trim(),
        language: typeof body.language === 'string' ? body.language : RESUME_DEFAULTS.language,
        intervalMinutes: body.intervalMinutes,
      });

      return { status: 201, body: schedule };
    }

    // PATCH /api/schedules/:id  { name?, language?, intervalMinutes?, enabled? }
    if (request.method === 'PATCH' && onSchedules && runId !== undefined) {
      const body = (request.body ?? {}) as {
        name?: unknown;
        language?: unknown;
        intervalMinutes?: unknown;
        enabled?: unknown;
      };

      const changes = {
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.language === 'string' ? { language: body.language } : {}),
        ...(typeof body.intervalMinutes === 'number' && Number.isFinite(body.intervalMinutes)
          ? { intervalMinutes: body.intervalMinutes }
          : {}),
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
      };

      if (Object.keys(changes).length === 0) {
        return { status: 400, body: { error: 'Nothing to change. Send a name, interval, language or enabled.' } };
      }

      return { status: 200, body: await this.manageSchedulesUseCase.edit(runId, changes) };
    }

    // DELETE /api/schedules  { ids: [...] }
    if (request.method === 'DELETE' && onSchedules && runId === undefined) {
      const { ids } = (request.body ?? {}) as { ids?: unknown };

      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
        return { status: 400, body: { error: 'Send { "ids": ["…"] } naming the schedules.' } };
      }

      return {
        status: 200,
        body: { deleted: await this.manageSchedulesUseCase.remove(ids as string[]) },
      };
    }

    // POST /api/topics/suggest  { language, count }
    if (request.method === 'POST' && segments.join('/') === 'api/topics/suggest') {
      const body = (request.body ?? {}) as {
        language?: unknown;
        count?: unknown;
        alsoExclude?: unknown;
        angle?: unknown;
      };
      const count = Math.min(Math.max(Number(body.count) || DEFAULT_IDEAS, 1), MAX_IDEAS);

      const result = await this.suggestTopicsUseCase.execute({
        correlationId: `suggest-${String(Date.now())}`,
        language: typeof body.language === 'string' ? body.language : RESUME_DEFAULTS.language,
        count,
        durationSeconds: RESUME_DEFAULTS.durationSeconds,
        alsoExclude: Array.isArray(body.alsoExclude)
          ? body.alsoExclude.filter((title): title is string => typeof title === 'string')
          : [],
        ...(typeof body.angle === 'string' && body.angle.trim() !== ''
          ? { angle: body.angle.trim() }
          : {}),
      });

      if (!result.success) {
        return {
          status: STATUS_BY_CODE[result.error.code] ?? 502,
          body: { error: result.error.message, code: result.error.code },
        };
      }

      return { status: 200, body: { ideas: result.data } };
    }

    // POST /api/runs  { topic, language, ... }
    if (request.method === 'POST' && segments.join('/') === 'api/runs') {
      const body = (request.body ?? {}) as Partial<PipelineRequestDto> & { topic?: unknown };

      if (typeof body.topic !== 'string' || body.topic.trim().length < 3) {
        return { status: 400, body: { error: 'Give the video a topic of at least three characters.' } };
      }

      // Started and left to run: the pipeline takes minutes, and a request that
      // waits for it would time out long before there was anything to report.
      // The run id comes back immediately so the caller can watch it.
      const started = this.generateContentUseCase.execute({
        ...RESUME_DEFAULTS,
        aspectRatio: this.imageConfig.aspectRatio,
        ...body,
        requestedTitle: body.topic.trim(),
      });

      void started.catch((error: unknown) => {
        this.logger.error('A started run failed', error, { source: HttpController.name });
      });

      return { status: 202, body: { accepted: true, topic: body.topic.trim() } };
    }

    // DELETE /api/runs  { ids: [...] }
    if (request.method === 'DELETE' && segments.join('/') === 'api/runs') {
      const { ids } = (request.body ?? {}) as { ids?: unknown };

      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
        return { status: 400, body: { error: 'Send { "ids": ["…"] } naming the runs to delete.' } };
      }

      return { status: 200, body: await this.deleteRunsUseCase.execute({ runIds: ids as string[] }) };
    }

    // GET /api/runs/:runId
    if (request.method === 'GET' && onRun && action === undefined) {
      return { status: 200, body: await this.readRunsUseCase.detail(runId) };
    }

    // POST /api/runs/:runId/resume
    if (request.method === 'POST' && onRun && action === 'resume' && segments.length === 4) {
      const overrides = (request.body ?? {}) as Partial<PipelineRequestDto>;

      const summary = await this.resumeRunUseCase.execute({
        runId,
        defaults: {
          ...RESUME_DEFAULTS,
          aspectRatio: this.imageConfig.aspectRatio,
          ...overrides,
        },
      });

      return { status: 200, body: summary };
    }

    return { status: 404, body: { error: `No route for ${request.method} ${request.path}` } };
  }
}

/**
 * Error code to HTTP status.
 *
 * Codes are a stable contract (`ErrorCode` is documented as never-rename), so
 * this table can be relied on by clients. Anything not listed is a 500, which
 * is the honest answer for a failure nobody has classified yet.
 */
const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  [ErrorCode.RecordNotFound]: 404,
  [ErrorCode.ConfigurationInvalid]: 500,
  [ErrorCode.NotImplemented]: 501,
  [ErrorCode.TopicNotUnique]: 409,
  [ErrorCode.AgentOutputInvalid]: 422,
  [ErrorCode.WorkflowStepFailed]: 409,
  [ErrorCode.AiRequestFailed]: 502,
  [ErrorCode.AiTimeout]: 504,
  [ErrorCode.AiRetriesExhausted]: 502,
  [ErrorCode.ImageProviderRequestFailed]: 502,
  [ErrorCode.ImageProviderTimeout]: 504,
  [ErrorCode.ImageProviderRetriesExhausted]: 502,
  [ErrorCode.SpeechRequestFailed]: 502,
  [ErrorCode.SpeechTimeout]: 504,
  [ErrorCode.RenderFailed]: 500,
  [ErrorCode.RenderToolUnavailable]: 503,
  [ErrorCode.PersistenceFailure]: 503,
};
