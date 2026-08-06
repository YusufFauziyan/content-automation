import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { readImageSize } from './image-size';
import { MEDIA_ROOT } from './paths';
import type { LogLine, Run, RunStatus, Scene, StepName, StepRun, StepStatus } from '../types';

/**
 * Client for the backend's HTTP API.
 *
 * This is the seam the mock store used to fill. Everything the editor knows
 * about a run now comes from `ReadRunsUseCase`, which is the same code path the
 * CLI drives — so the UI cannot drift from what the pipeline actually did.
 */

const BASE_URL = (process.env.YU_BACKEND_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

export class BackendUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `The backend is not answering at ${BASE_URL}. Start it with \`pnpm serve\` in backend/.`,
    );
    this.name = 'BackendUnavailableError';
    this.cause = cause;
  }
}

export class BackendError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
      cache: 'no-store',
    });
  } catch (error) {
    throw new BackendUnavailableError(error);
  }

  const text = await response.text();
  const body: unknown = text === '' ? {} : JSON.parse(text);

  if (!response.ok) {
    const { error } = body as { error?: string };
    throw new BackendError(response.status, error ?? `Request failed (${response.status})`);
  }

  return body as T;
}

// --- Shapes the backend returns (mirrors ReadRunsUseCase) --------------------

interface ApiScene {
  scene: number;
  prompt: string;
  caption: string;
  durationSeconds: number;
  status: 'ok' | 'failed';
  imagePath: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  source: string | null;
  camera: string;
  transition: string;
  style: string;
}

interface ApiRun {
  id: string;
  correlationId: string;
  title: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  failedStep: StepName | null;
  steps: {
    step: StepName;
    status: string;
    attempt: number;
    durationMs: number | null;
    error: { code: string; message: string; retryable: boolean } | null;
  }[];
  scenes: ApiScene[];
  video: { path: string; durationMs: number; width: number; height: number; byteSize: number } | null;
  uploads: {
    platform: string;
    status: string;
    externalUrl: string | null;
    uploadedAt: string | null;
    verifiedAt: string | null;
  }[];
  logs: { at: string; level: string; source: string; message: string }[];
}

// --- Translation ------------------------------------------------------------

/** The backend's status vocabulary is already the UI's; this only narrows it. */
const asStepStatus = (value: string): StepStatus =>
  (['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'] as const).includes(value as StepStatus)
    ? (value as StepStatus)
    : 'PENDING';

/**
 * The backend records how far a run got, not whether it is going.
 *
 * `TOPIC_CREATED` through `VIDEO_CREATED` are checkpoints on the way, so a run
 * sitting on one of them is in progress; only `UPLOAD_COMPLETED` and
 * `COMPLETED` mean finished. Mapping every unknown value to `PENDING` — as this
 * did at first — showed a run that had rendered a video as "Pending".
 */
const asRunStatus = (value: string, startedAt: string | null, finishedAt: string | null): RunStatus => {
  if (value === 'FAILED') return 'FAILED';
  if (value === 'COMPLETED' || value === 'UPLOAD_COMPLETED') return 'SUCCEEDED';
  if (startedAt === null) return 'PENDING';

  // Started and not finished is in flight. Started, finished, and still sitting
  // on a checkpoint means it stopped partway — which is a halted run, not a
  // pending one, and showing it as "Pending" hid that anything was wrong.
  return finishedAt === null ? 'RUNNING' : 'FAILED';
};

const asLogLevel = (value: string): LogLine['level'] =>
  value === 'ERROR' || value === 'WARN' || value === 'DEBUG' ? value : 'INFO';

/**
 * Media paths are relative to the backend's output root; the browser reaches
 * them through this app's own `/api/media` route, which reads that directory.
 */
const toMediaUrl = (relativePath: string | null, runId: string): string | null =>
  relativePath === null ? null : `/api/media/workflows/${runId}/${relativePath}`;

function toRun(api: ApiRun): Run {
  const steps: StepRun[] = api.steps.map((step) => ({
    step: step.step,
    status: asStepStatus(step.status),
    attempt: step.attempt,
    durationMs: step.durationMs,
    error: step.error,
  }));

  const scenes: Scene[] = api.scenes.map((scene) => ({
    scene: scene.scene,
    prompt: scene.prompt,
    caption: scene.caption,
    durationSeconds: scene.durationSeconds,
    status: scene.status,
    imageUrl: toMediaUrl(scene.imagePath, api.id),
    width: scene.width,
    height: scene.height,
    byteSize: scene.byteSize,
    source: scene.source,
    camera: scene.camera,
    transition: scene.transition,
    style: scene.style,
    error:
      scene.status === 'failed'
        ? {
            code: 'IMAGE_MISSING',
            message: 'No image was produced for this scene.',
            retryable: true,
          }
        : null,
  }));

  const logs: LogLine[] = api.logs.map((line) => ({
    at: line.at,
    level: asLogLevel(line.level),
    source: line.source,
    message: line.message,
  }));

  // A run that stopped with no failed step did not fail — it reached the step
  // `PIPELINE_LAST_STEP` names and stopped there, which is what it was asked to
  // do. Reading the status enum alone reported that as a failure.
  const derived = asRunStatus(api.status, api.startedAt, api.finishedAt);
  const anyFailed = steps.some((step) => step.status === 'FAILED');
  const status: RunStatus = derived === 'FAILED' && !anyFailed ? 'SUCCEEDED' : derived;

  return {
    id: api.id,
    title: api.title,
    status,
    createdAt: api.createdAt,
    failedStep: api.failedStep,
    steps,
    scenes,
    logs,
    audio: null,
    subtitle: null,
    uploads: api.uploads ?? [],
    video:
      api.video === null
        ? null
        : {
            url: toMediaUrl(api.video.path, api.id) ?? '',
            durationMs: api.video.durationMs,
            width: api.video.width,
            height: api.video.height,
            byteSize: api.video.byteSize,
            // The pipeline builds both from the same measured plan, so they
            // agree by construction; the panel still shows them side by side.
            subtitleDurationMs: api.video.durationMs,
            audioDurationMs: api.video.durationMs,
            cueCount: api.scenes.length,
          },
  };
}

// --- Operations -------------------------------------------------------------

export interface RunRow {
  id: string;
  title: string;
  status: RunStatus;
  failedStep: StepName | null;
  createdAt: string;
}

/**
 * @param limit How many to ask for. The table shows everything, the dashboard
 *              only needs the top of the list.
 */
export async function listRuns(limit = 200): Promise<RunRow[]> {
  const { runs } = await call<{
    runs: {
      id: string;
      title: string;
      status: string;
      createdAt: string;
      startedAt: string | null;
      finishedAt: string | null;
      failedStep: StepName | null;
    }[];
  }>(`/api/runs?limit=${String(limit)}`);

  return runs.map((run) => {
    const derived = asRunStatus(run.status, run.startedAt, run.finishedAt);

    return {
      id: run.id,
      title: run.title,
      // Same rule as the detail view: stopped without a failed step is done.
      status: derived === 'FAILED' && run.failedStep === null ? 'SUCCEEDED' : derived,
      failedStep: run.failedStep,
      createdAt: run.createdAt,
    };
  });
}

export interface TopicIdea {
  title: string;
  hook: string;
  why: string;
}

/** Subjects to choose between. Nothing is written until one is started. */
export async function suggestTopics(language: string, count: number): Promise<{ ideas: TopicIdea[] }> {
  return call<{ ideas: TopicIdea[] }>('/api/topics/suggest', {
    method: 'POST',
    body: JSON.stringify({ language, count }),
  });
}

export interface Schedule {
  id: string;
  name: string;
  language: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  runsStarted: number;
  lastError: string | null;
  createdAt: string;
}

export async function listSchedules(): Promise<Schedule[]> {
  const { schedules } = await call<{ schedules: Schedule[] }>('/api/schedules');
  return schedules;
}

export async function createSchedule(input: {
  name: string;
  language: string;
  intervalMinutes: number;
}): Promise<Schedule> {
  return call<Schedule>('/api/schedules', { method: 'POST', body: JSON.stringify(input) });
}

/** Any subset of the editable fields. Omitted ones are left alone. */
export async function editSchedule(
  id: string,
  changes: { name?: string; language?: string; intervalMinutes?: number; enabled?: boolean },
): Promise<Schedule> {
  return call<Schedule>(`/api/schedules/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

export async function deleteSchedules(ids: readonly string[]): Promise<{ deleted: number }> {
  return call<{ deleted: number }>('/api/schedules', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  });
}

/**
 * One publish attempt, as the history reads it.
 *
 * `externalUrl` outlives the video file — cleanup deletes the render once an
 * upload is verified — so this row is the only durable record that a run
 * produced anything.
 */
export interface Upload {
  id: string;
  platform: string;
  title: string;
  status: string;
  externalUrl: string | null;
  externalId: string | null;
  uploadedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  workflowRunId: string | null;
}

export async function recentUploads(limit: number): Promise<Upload[]> {
  const { uploads } = await call<{ uploads: Upload[] }>(`/api/uploads?limit=${String(limit)}`);
  return uploads;
}

/** Publishes an existing run's video again, to one destination or all. */
export async function publishRun(
  runId: string,
  platform?: string,
): Promise<{ published: string }> {
  return call<{ published: string }>(`/api/runs/${runId}/publish`, {
    method: 'POST',
    body: JSON.stringify(platform === undefined ? {} : { platform }),
  });
}

/** Settles a step a person has decided the outcome of. */
export async function settleStep(
  runId: string,
  step: string,
  status: string,
): Promise<{ step: string; status: string }> {
  return call<{ step: string; status: string }>(`/api/runs/${runId}/steps/${step}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

/** Records a publish the system did not perform, or did not finish recording. */
export async function recordUpload(input: {
  workflowRunId: string;
  platform: string;
  externalUrl?: string;
  status?: string;
}): Promise<Upload> {
  return call<Upload>('/api/uploads', { method: 'POST', body: JSON.stringify(input) });
}

export async function editUpload(
  id: string,
  input: { externalUrl?: string; status?: string },
): Promise<Upload> {
  return call<Upload>(`/api/uploads/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function deleteUploads(ids: readonly string[]): Promise<{ deleted: number }> {
  return call<{ deleted: number }>('/api/uploads', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  });
}

export type CredentialPlatform = 'TIKTOK' | 'INSTAGRAM' | 'THREADS' | 'YOUTUBE';

/**
 * How an account authenticates.
 *
 * `API` holds tokens the platform issued. `BROWSER` holds a captured web
 * session, which expires on its own and has to be captured again — worth
 * showing in the UI, because the two fail differently.
 */
export type CredentialAuthMethod = 'API' | 'BROWSER';

/** What the server will say about an account. Never a secret. */
export interface Credential {
  id: string;
  platform: CredentialPlatform;
  authMethod: CredentialAuthMethod;
  label: string;
  fieldNames: string[];
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export async function listCredentials(): Promise<Credential[]> {
  const { credentials } = await call<{ credentials: Credential[] }>('/api/credentials');
  return credentials;
}

export async function connectCredential(input: {
  platform: CredentialPlatform;
  authMethod: CredentialAuthMethod;
  label: string;
  fields: Record<string, string>;
}): Promise<Credential> {
  return call<Credential>('/api/credentials', { method: 'POST', body: JSON.stringify(input) });
}

/** How a sign-in capture is going. Mirrors the backend's own states. */
export type CaptureStatus = 'WAITING' | 'SAVING' | 'SAVED' | 'FAILED';

export interface CaptureState {
  id: string;
  status: CaptureStatus;
  message: string | null;
  credentialId: string | null;
}

export async function startCapture(input: {
  platform: CredentialPlatform;
  label: string;
}): Promise<CaptureState> {
  return call<CaptureState>('/api/credentials/capture', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function readCapture(id: string): Promise<CaptureState> {
  return call<CaptureState>(`/api/credentials/capture/${id}`);
}

export async function setCredentialEnabled(id: string, enabled: boolean): Promise<Credential> {
  return call<Credential>(`/api/credentials/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export async function deleteCredentials(ids: readonly string[]): Promise<{ deleted: number }> {
  return call<{ deleted: number }>('/api/credentials', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  });
}

export async function startRun(topic: string, language: string): Promise<{ accepted: boolean }> {
  return call<{ accepted: boolean }>('/api/runs', {
    method: 'POST',
    body: JSON.stringify({ topic, language }),
  });
}

export async function deleteRuns(ids: readonly string[]): Promise<{ deleted: number; skipped: string[] }> {
  return call<{ deleted: number; skipped: string[] }>('/api/runs', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  });
}

export async function getRun(runId: string): Promise<Run> {
  const run = await withSuppliedStills(toRun(await call<ApiRun>(`/api/runs/${runId}`)), runId);
  return withTracks(run, runId);
}

/**
 * Describes every scene from the file actually sitting in the run's workspace.
 *
 * Two things make this necessary. A still supplied through this app lands on
 * disk immediately, while the database only learns about it when the image step
 * next runs and adopts it — so without this the scene would still read as empty
 * right after someone filled it. And a *replaced* file keeps the same path, so
 * the recorded size and URL would go on describing the picture that is no
 * longer there.
 *
 * The source is only rewritten to `manual` for scenes the pipeline never
 * recorded. A generated still keeps the combo that produced it.
 */
async function withSuppliedStills(run: Run, runId: string): Promise<Run> {
  const directory = join(MEDIA_ROOT, 'workflows', runId, 'images');

  let present: string[];
  try {
    present = await readdir(directory);
  } catch {
    return run;
  }

  const described = await Promise.all(
    run.scenes.map(async (scene) => {
      const stem = `scene-${String(scene.scene).padStart(3, '0')}.`;
      const fileName = present.find((name) => name.startsWith(stem));
      if (fileName === undefined) return scene;

      // Measured, not assumed. Reporting a scene as filled but its size as
      // unknown reads like something went wrong.
      const path = join(directory, fileName);
      const stats = await stat(path);
      const size = await measure(path, stats.mtimeMs);

      return {
        ...scene,
        status: 'ok' as const,
        // The modified time is the cache key: the path never changes, so
        // without it the browser keeps showing the picture it already has.
        imageUrl: `/api/media/workflows/${runId}/images/${fileName}?v=${String(stats.mtimeMs)}`,
        width: size?.width ?? scene.width,
        height: size?.height ?? scene.height,
        byteSize: stats.size,
        source: scene.source ?? 'manual',
        error: null,
      };
    }),
  );

  return { ...run, scenes: described };
}

/**
 * Pixel sizes already measured, keyed by path and modification time.
 *
 * Reading an 800 KB still off disk to learn it is 768x1376 is fine once. Doing
 * it for every scene on every request is not — and this data is read on a
 * timer, so "every request" means continuously. The key includes the mtime, so
 * a replaced file is measured again and a stale entry can never be served.
 */
const measured = new Map<string, { width: number; height: number } | null>();

/** Bounded so a long-lived server cannot grow this without limit. */
const MEASURED_LIMIT = 500;

async function measure(path: string, mtimeMs: number) {
  const key = `${path}:${String(mtimeMs)}`;
  const hit = measured.get(key);
  if (hit !== undefined) return hit;

  const size = readImageSize(new Uint8Array(await readFile(path)));

  if (measured.size >= MEASURED_LIMIT) {
    const oldest = measured.keys().next().value;
    if (oldest !== undefined) measured.delete(oldest);
  }
  measured.set(key, size);

  return size;
}

/** Narration and subtitle file names are fixed by the pipeline. */
const NARRATION_FILE = 'narration.mp3';
const SUBTITLE_FILE = 'subtitle.srt';

/**
 * Attaches the narration track and the captions sitting in the run's workspace.
 *
 * Neither is recorded in the database — media is disposable, so only the
 * knowledge that produced it is persisted. They are read from disk for the same
 * reason the stills are: while the files are still there, they are the most
 * direct answer to "what did this run actually make?".
 */
async function withTracks(run: Run, runId: string): Promise<Run> {
  const root = join(MEDIA_ROOT, 'workflows', runId);

  const [audio, subtitle] = await Promise.all([
    stat(join(root, 'audio', NARRATION_FILE))
      .then((stats) => ({
        url: `/api/media/workflows/${runId}/audio/${NARRATION_FILE}?v=${String(stats.mtimeMs)}`,
        byteSize: stats.size,
      }))
      .catch(() => null),
    readSubtitle(root, runId),
  ]);

  return { ...run, audio, subtitle };
}

/** Cues shown in the panel. Beyond this it stops being something you read. */
const MAX_CUES = 200;

async function readSubtitle(root: string, runId: string) {
  try {
    const path = join(root, 'subtitle', SUBTITLE_FILE);
    const [text, stats] = await Promise.all([readFile(path, 'utf8'), stat(path)]);

    // SRT blocks are separated by a blank line: index, timing, then the lines.
    const cues = text
      .split(/\r?\n\r?\n/)
      .map((block) => block.split(/\r?\n/).filter((line) => line.trim() !== ''))
      .filter((lines) => lines.length >= 2)
      .slice(0, MAX_CUES)
      .map((lines, position) => ({
        index: Number(lines[0]) || position + 1,
        time: lines[1] ?? '',
        text: lines.slice(2).join(' '),
      }));

    return {
      url: `/api/media/workflows/${runId}/subtitle/${SUBTITLE_FILE}?v=${String(stats.mtimeMs)}`,
      byteSize: stats.size,
      cues,
    };
  } catch {
    return null;
  }
}

export async function resumeRun(runId: string): Promise<{ resumed: number; failed: number }> {
  return call<{ resumed: number; failed: number }>(`/api/runs/${runId}/resume`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export interface LogRow {
  at: string;
  level: string;
  source: string;
  message: string;
  correlationId: string | null;
  step: string | null;
}

export async function recentLogs(limit = 200): Promise<LogRow[]> {
  const { logs } = await call<{ logs: LogRow[] }>(`/api/logs?limit=${String(limit)}`);
  return logs;
}

export async function latestRunId(): Promise<string | null> {
  const runs = await listRuns();
  return runs[0]?.id ?? null;
}
