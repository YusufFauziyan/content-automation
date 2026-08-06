import { describe, expect, it } from 'vitest';

import type { WorkflowConfig } from '../../../src/config/app.config.js';
import type {
  ImageGenerationRequestDto,
  ImageGenerationResponseDto,
} from '../../../src/dto/image.dto.js';
import type { NarrationPlanDto, NarrationPlanRequestDto } from '../../../src/dto/narration.dto.js';
import type { RenderPlanDto, RenderPlanRequestDto } from '../../../src/dto/render-plan.dto.js';
import type { ScenePlanDto, ScenePlanRequestDto } from '../../../src/dto/scene.dto.js';
import type { VideoRenderRequestDto, VideoRenderResponseDto } from '../../../src/dto/video.dto.js';
import type {
  SubtitleGenerationResponseDto,
  SubtitleRequestDto,
} from '../../../src/dto/subtitle.dto.js';
import type { VoiceGenerationResponseDto, VoiceRequestDto } from '../../../src/dto/voice.dto.js';
import type { ScriptDto, ScriptRequestDto } from '../../../src/dto/script.dto.js';
import type { TopicDto, TopicRequestDto } from '../../../src/dto/topic.dto.js';
import type { PipelineRequestDto } from '../../../src/dto/workflow-context.dto.js';
import type { VisualPlanDto, VisualPlanRequestDto } from '../../../src/dto/visual-prompt.dto.js';
import type {
  WorkflowRunDto,
  WorkflowStepRunDto,
  WorkflowStepUpdateDto,
} from '../../../src/dto/workflow.dto.js';
import type { ContentDto } from '../../../src/dto/content.dto.js';
import type { ContentRepository } from '../../../src/repositories/content.repository.js';
import type { CredentialDto } from '../../../src/dto/credential.dto.js';
import type { AudioRepository } from '../../../src/repositories/audio.repository.js';
import type { UploadDto, UploadRequestDto } from '../../../src/dto/upload.dto.js';
import type { CredentialRepository } from '../../../src/repositories/credential.repository.js';
import type { ImageRepository, SceneImageDto } from '../../../src/repositories/image.repository.js';
import type { TopicRepository } from '../../../src/repositories/topic.repository.js';
import type { VideoRepository } from '../../../src/repositories/video.repository.js';
import type { WorkflowRepository } from '../../../src/repositories/workflow.repository.js';
import type { Agent } from '../../../src/types/agent.js';
import { NotImplementedError } from '../../../src/types/errors/not-implemented.error.js';
import { TopicStatus } from '../../../src/types/topic.js';
import { fail, ok } from '../../../src/types/result.js';
import {
  IMPLEMENTED_PIPELINE_STEPS,
  WorkflowStatus,
  WorkflowStepName,
  WorkflowStepStatus,
} from '../../../src/types/workflow.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { RetryExecutor } from '../../../src/utils/retry/retry-executor.js';
import {
  GenerateContentWorkflow,
  resolvePendingSteps,
} from '../../../src/workflows/generate-content.workflow.js';
import { asFake } from '../../support/fakes.js';

/** Builds a recorded step with only the fields the resume rule reads. */
const recordedStep = (step: WorkflowStepName, status: WorkflowStepStatus): WorkflowStepRunDto => ({
  id: `step-${step}`,
  workflowRunId: 'run-1',
  step,
  status,
  attempt: 1,
  durationMs: 10,
  startedAt: new Date(0),
  finishedAt: new Date(1),
  lastError: null,
});

describe('resolvePendingSteps', () => {
  it('plans every implemented step for a run that has not started', () => {
    expect(resolvePendingSteps([])).toEqual(IMPLEMENTED_PIPELINE_STEPS);
  });

  it('steps over a stage that is declared but not built', () => {
    // QUALITY_CHECK sits between compose and upload in PIPELINE_STEPS and has
    // no agent. Planning it would fail the run on a stage nobody wrote, and
    // upload — which does exist — would never be reached.
    const pending = resolvePendingSteps([]);

    expect(pending).not.toContain(WorkflowStepName.QualityCheck);
    expect(pending).toContain(WorkflowStepName.Upload);
  });

  it('skips steps that already succeeded', () => {
    const pending = resolvePendingSteps([
      recordedStep(WorkflowStepName.Topic, WorkflowStepStatus.Succeeded),
      recordedStep(WorkflowStepName.Script, WorkflowStepStatus.Succeeded),
    ]);

    expect(pending).not.toContain(WorkflowStepName.Topic);
    expect(pending[0]).toBe(WorkflowStepName.Scene);
  });

  it('repeats a step that was interrupted while running', () => {
    const pending = resolvePendingSteps([
      recordedStep(WorkflowStepName.Topic, WorkflowStepStatus.Succeeded),
      recordedStep(WorkflowStepName.Script, WorkflowStepStatus.Running),
    ]);

    expect(pending[0]).toBe(WorkflowStepName.Script);
  });

  it('repeats a step that failed', () => {
    const pending = resolvePendingSteps([
      recordedStep(WorkflowStepName.Topic, WorkflowStepStatus.Failed),
    ]);

    expect(pending).toEqual(IMPLEMENTED_PIPELINE_STEPS);
  });

  it('stops planning after the requested step', () => {
    const pending = resolvePendingSteps([], WorkflowStepName.Scene);

    expect(pending).toEqual([
      WorkflowStepName.Topic,
      WorkflowStepName.Script,
      WorkflowStepName.Scene,
    ]);
  });

  it('plans visual briefs before images', () => {
    const pending = resolvePendingSteps([], WorkflowStepName.Image);

    expect(pending).toEqual([
      WorkflowStepName.Topic,
      WorkflowStepName.Script,
      WorkflowStepName.Scene,
      WorkflowStepName.VisualPlan,
      WorkflowStepName.Image,
    ]);
  });

  it('plans nothing when the requested step already succeeded', () => {
    const pending = resolvePendingSteps(
      [recordedStep(WorkflowStepName.Topic, WorkflowStepStatus.Succeeded)],
      WorkflowStepName.Topic,
    );

    expect(pending).toEqual([]);
  });
});

// --- Orchestration ----------------------------------------------------------

const topic: TopicDto = {
  id: 'topic-1',
  title: 'A topic',
  normalizedTitle: 'a topic',
  description: null,
  language: 'en',
  category: 'general',
  audience: 'everyone',
  status: TopicStatus.Accepted,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const script: ScriptDto = {
  contentId: 'content-1',
  topicId: topic.id,
  title: 'A title',
  hook: 'A hook.',
  script: 'A hook. And the rest.',
  caption: 'A caption',
  hashtags: ['one'],
  thumbnailPrompt: 'A thumbnail',
  language: 'en',
  durationSeconds: 45,
};

const scenePlan: ScenePlanDto = {
  contentId: 'content-1',
  scenes: [],
  totalDurationSeconds: 45,
};

const visualPlan: VisualPlanDto = {
  contentId: 'content-1',
  prompts: [],
};

const images: ImageGenerationResponseDto = {
  contentId: 'content-1',
  workflowId: 'run-1',
  imagesDirectory: '/tmp/out/workflows/run-1/images',
  images: [],
  totalDurationMs: 5,
};

const narrationPlan: NarrationPlanDto = {
  contentId: 'content-1',
  blocks: [],
  totalDurationSeconds: 45,
};

/** The plan as the Voice Agent hands it back: block lengths now measured. */
const measuredNarrationPlan: NarrationPlanDto = {
  contentId: 'content-1',
  blocks: [],
  totalDurationSeconds: 43.7,
};

const voice = {
  contentId: 'content-1',
  workflowId: 'run-1',
  audioDirectory: '/tmp/out/workflows/run-1/audio',
  audio: { fileName: 'narration.mp3' },
  plan: measuredNarrationPlan,
} as unknown as VoiceGenerationResponseDto;

const subtitle = {
  contentId: 'content-1',
  workflowId: 'run-1',
  subtitleDirectory: '/tmp/out/workflows/run-1/subtitle',
  subtitle: { fileName: 'subtitle.srt', cueCount: 2 },
  cues: [],
} as unknown as SubtitleGenerationResponseDto;

const renderPlan = {
  contentId: 'content-1',
  workflowId: 'run-1',
  width: 1080,
  height: 1920,
  fps: 30,
  totalDuration: 21.6,
  scenes: [],
} as unknown as RenderPlanDto;

const video = {
  contentId: 'content-1',
  workflowId: 'run-1',
  videoDirectory: '/tmp/out/workflows/run-1/video',
  video: { fileName: 'final.mp4', durationMs: 21600, width: 1080, height: 1920 },
} as unknown as VideoRenderResponseDto;

const request: PipelineRequestDto = {
  category: 'general',
  language: 'en',
  audience: 'everyone',
  durationSeconds: 45,
  visualStyle: 'cinematic',
  aspectRatio: '4:7',
};
const retryConfig: WorkflowConfig = { maxRetries: 0, backoffMs: [1] };

/** Records every step transition so ordering can be asserted. */
interface RecordedTransition {
  readonly step: WorkflowStepName;
  readonly status: WorkflowStepStatus;
}

const createWorkflowRepository = (
  transitions: RecordedTransition[],
  statuses: WorkflowStatus[],
): WorkflowRepository =>
  asFake<WorkflowRepository>({
    createRun: ({ correlationId }) =>
      Promise.resolve(
        asFake<WorkflowRunDto>({
          id: 'run-1',
          correlationId,
          status: WorkflowStatus.Pending,
          topicId: null,
          contentId: null,
        }),
      ),
    findSteps: () => Promise.resolve([]),
    updateRun: (_id, input) => {
      if (input.status !== undefined) {
        statuses.push(input.status);
      }
      return Promise.resolve(asFake<WorkflowRunDto>({ id: 'run-1' }));
    },
    recordStep: (_runId, step, input: WorkflowStepUpdateDto) => {
      transitions.push({ step, status: input.status });
      return Promise.resolve(asFake<WorkflowStepRunDto>({ id: 'step' }));
    },
  });

const succeedingAgent = <TIn, TOut>(name: string, output: TOut): Agent<TIn, TOut> => ({
  name,
  execute: () => Promise.resolve(ok(output)),
});

/** An agent that succeeds and records what it was asked to do. */
const recordingAgent = <TIn, TOut>(name: string, output: TOut, seen: TIn[]): Agent<TIn, TOut> => ({
  name,
  execute: (input) => {
    seen.push(input);
    return Promise.resolve(ok(output));
  },
});

const createWorkflow = (
  transitions: RecordedTransition[],
  statuses: WorkflowStatus[],
  overrides: {
    readonly scriptAgent?: Agent<ScriptRequestDto, ScriptDto>;
    readonly subtitleAgent?: Agent<SubtitleRequestDto, SubtitleGenerationResponseDto>;
    readonly uploadAgent?: Agent<UploadRequestDto, UploadDto> | null;
    readonly account?: CredentialDto | null;
  } = {},
): GenerateContentWorkflow =>
  new GenerateContentWorkflow(
    createWorkflowRepository(transitions, statuses),
    asFake<TopicRepository>({ findById: () => Promise.resolve(topic) }),
    asFake<ContentRepository>({ findById: () => Promise.resolve(null) }),
    asFake<ImageRepository>({ findByContentId: () => Promise.resolve([]) }),
    asFake<AudioRepository>({ findByContentId: () => Promise.resolve([]) }),
    { outputDirectory: '/tmp/out', promptsDirectory: '/tmp/prompts' },
    succeedingAgent<TopicRequestDto, TopicDto>('TopicAgent', topic),
    overrides.scriptAgent ?? succeedingAgent<ScriptRequestDto, ScriptDto>('ScriptAgent', script),
    succeedingAgent<ScenePlanRequestDto, ScenePlanDto>('SceneAgent', scenePlan),
    succeedingAgent<VisualPlanRequestDto, VisualPlanDto>('VisualPlannerAgent', visualPlan),
    succeedingAgent<ImageGenerationRequestDto, ImageGenerationResponseDto>('ImageAgent', images),
    succeedingAgent<NarrationPlanRequestDto, NarrationPlanDto>(
      'NarrationPlannerAgent',
      narrationPlan,
    ),
    succeedingAgent<VoiceRequestDto, VoiceGenerationResponseDto>('VoiceAgent', voice),
    overrides.subtitleAgent ??
      succeedingAgent<SubtitleRequestDto, SubtitleGenerationResponseDto>('SubtitleAgent', subtitle),
    succeedingAgent<RenderPlanRequestDto, RenderPlanDto>('TimelineBuilderAgent', renderPlan),
    succeedingAgent<VideoRenderRequestDto, VideoRenderResponseDto>('FfmpegComposerAgent', video),
    // No uploader and no connected account by default: the upload step is
    // skipped, which is what every test that does not name publishing expects.
    overrides.uploadAgent ?? null,
    asFake<CredentialRepository>({
      findUsable: () => Promise.resolve(overrides.account ?? null),
    }),
    asFake<VideoRepository>({ findByContentId: () => Promise.resolve([]) }),
    new RetryExecutor(retryConfig, new NoopLogger()),
    new NoopLogger(),
  );

describe('GenerateContentWorkflow', () => {
  it('subtitles against the plan the voice step measured, not the planner estimate', async () => {
    // The planner predicts block lengths from a words-per-minute rate; the
    // Voice Agent replaces them with what the speech engine really produced.
    // Timing captions off the estimate is what put them seconds out of sync.
    const seen: SubtitleRequestDto[] = [];
    const workflow = createWorkflow([], [], {
      subtitleAgent: recordingAgent<SubtitleRequestDto, SubtitleGenerationResponseDto>(
        'SubtitleAgent',
        subtitle,
        seen,
      ),
    });

    await workflow.execute({ ...request, stopAfterStep: WorkflowStepName.Subtitle });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.plan).toBe(measuredNarrationPlan);
  });

  it('runs topic, script and scene in order and returns what they produced', async () => {
    const transitions: RecordedTransition[] = [];
    const workflow = createWorkflow(transitions, []);

    const result = await workflow.execute({ ...request, stopAfterStep: WorkflowStepName.Scene });

    expect(result.success).toBe(true);
    expect(transitions.filter((entry) => entry.status === WorkflowStepStatus.Succeeded)).toEqual([
      { step: WorkflowStepName.Topic, status: WorkflowStepStatus.Succeeded },
      { step: WorkflowStepName.Script, status: WorkflowStepStatus.Succeeded },
      { step: WorkflowStepName.Scene, status: WorkflowStepStatus.Succeeded },
    ]);
    expect(result.success ? result.data.topic?.id : null).toBe('topic-1');
    expect(result.success ? result.data.script?.contentId : null).toBe('content-1');
    expect(result.success ? result.data.scenePlan : null).not.toBeNull();
  });

  it('records a checkpoint after every completed step', async () => {
    const statuses: WorkflowStatus[] = [];
    const workflow = createWorkflow([], statuses);

    await workflow.execute({ ...request, stopAfterStep: WorkflowStepName.Scene });

    expect(statuses).toContain(WorkflowStatus.TopicCreated);
    expect(statuses).toContain(WorkflowStatus.ScriptCreated);
    expect(statuses).toContain(WorkflowStatus.SceneCreated);
  });

  it('stops at the requested step without touching the ones after it', async () => {
    const transitions: RecordedTransition[] = [];
    const workflow = createWorkflow(transitions, []);

    await workflow.execute({ ...request, stopAfterStep: WorkflowStepName.Topic });

    expect(transitions.map((entry) => entry.step)).toEqual([
      WorkflowStepName.Topic,
      WorkflowStepName.Topic,
    ]);
  });

  it('marks the run failed and stops when a step fails', async () => {
    const transitions: RecordedTransition[] = [];
    const statuses: WorkflowStatus[] = [];
    const workflow = createWorkflow(transitions, statuses, {
      scriptAgent: {
        name: 'ScriptAgent',
        execute: () => Promise.resolve(fail(new NotImplementedError('ScriptAgent'))),
      },
    });

    const result = await workflow.execute({ ...request, stopAfterStep: WorkflowStepName.Scene });

    expect(result.success).toBe(false);
    expect(statuses.at(-1)).toBe(WorkflowStatus.Failed);
    expect(transitions.map((entry) => entry.step)).not.toContain(WorkflowStepName.Scene);
  });

  it('plans the visuals and then generates the images', async () => {
    const transitions: RecordedTransition[] = [];
    const workflow = createWorkflow(transitions, []);

    const result = await workflow.execute({ ...request, stopAfterStep: WorkflowStepName.Image });

    expect(result.success).toBe(true);
    expect(
      transitions
        .filter((entry) => entry.status === WorkflowStepStatus.Succeeded)
        .map((entry) => entry.step),
    ).toEqual([
      WorkflowStepName.Topic,
      WorkflowStepName.Script,
      WorkflowStepName.Scene,
      WorkflowStepName.VisualPlan,
      WorkflowStepName.Image,
    ]);
    expect(result.success ? result.data.images?.imagesDirectory : null).toBe(
      '/tmp/out/workflows/run-1/images',
    );
  });

  it('checkpoints the run as IMAGES_CREATED once the images exist', async () => {
    const statuses: WorkflowStatus[] = [];
    const workflow = createWorkflow([], statuses);

    await workflow.execute({ ...request, stopAfterStep: WorkflowStepName.Image });

    expect(statuses).toContain(WorkflowStatus.ImagesCreated);
  });

  it('plans the narration, speaks it, then writes the subtitles', async () => {
    const transitions: RecordedTransition[] = [];
    const workflow = createWorkflow(transitions, []);

    const result = await workflow.execute({ ...request, stopAfterStep: WorkflowStepName.Subtitle });

    expect(result.success).toBe(true);
    expect(
      transitions
        .filter((entry) => entry.status === WorkflowStepStatus.Succeeded)
        .map((entry) => entry.step),
    ).toEqual([
      WorkflowStepName.Topic,
      WorkflowStepName.Script,
      WorkflowStepName.Scene,
      WorkflowStepName.VisualPlan,
      WorkflowStepName.Image,
      WorkflowStepName.NarrationPlan,
      WorkflowStepName.Voice,
      WorkflowStepName.Subtitle,
    ]);
    expect(result.success ? result.data.voice?.audio.fileName : null).toBe('narration.mp3');
    expect(result.success ? result.data.subtitle?.subtitle.fileName : null).toBe('subtitle.srt');
  });

  it('checkpoints the run as SUBTITLE_CREATED once the captions exist', async () => {
    const statuses: WorkflowStatus[] = [];
    const workflow = createWorkflow([], statuses);

    await workflow.execute({ ...request, stopAfterStep: WorkflowStepName.Subtitle });

    expect(statuses).toContain(WorkflowStatus.VoiceCreated);
    expect(statuses).toContain(WorkflowStatus.SubtitleCreated);
  });

  it('builds the render plan, then renders it', async () => {
    const transitions: RecordedTransition[] = [];
    const workflow = createWorkflow(transitions, []);

    const result = await workflow.execute({ ...request, stopAfterStep: WorkflowStepName.Compose });

    expect(result.success).toBe(true);
    expect(
      transitions
        .filter((entry) => entry.status === WorkflowStepStatus.Succeeded)
        .map((entry) => entry.step)
        .slice(-2),
    ).toEqual([WorkflowStepName.RenderPlan, WorkflowStepName.Compose]);
    expect(result.success ? result.data.video?.video.fileName : null).toBe('final.mp4');
  });

  it('checkpoints the run as VIDEO_CREATED once the video exists', async () => {
    const statuses: WorkflowStatus[] = [];
    const workflow = createWorkflow([], statuses);

    await workflow.execute({ ...request, stopAfterStep: WorkflowStepName.Compose });

    expect(statuses).toContain(WorkflowStatus.VideoCreated);
  });

  it('finishes rather than failing when a requested step is not built', async () => {
    // Asking to stop at QUALITY_CHECK plans everything up to it, and there is
    // nothing there to run. That is a finished run, not a failed one.
    const workflow = createWorkflow([], []);

    const result = await workflow.execute({
      ...request,
      stopAfterStep: WorkflowStepName.QualityCheck,
    });

    expect(result.success).toBe(true);
  });
});

describe('GenerateContentWorkflow restoring a resumed run', () => {
  it('rebuilds the image list from scene_images when the image step is skipped', async () => {
    // A resume that skips IMAGE still has to hand the renderer a list of
    // stills. Before this, every resumed run failed at RENDER_PLAN with
    // "needs the scenes, images, narration, audio and subtitles".
    const seen: RenderPlanRequestDto[] = [];

    const workflow = new GenerateContentWorkflow(
      // Every step up to and including IMAGE already succeeded, so the resume
      // skips them — which is exactly the situation the restore has to cover.
      asFake<WorkflowRepository>({
        findRunByCorrelationId: () =>
          Promise.resolve(
            asFake<WorkflowRunDto>({
              id: 'run-1',
              correlationId: 'run-1',
              status: WorkflowStatus.Failed,
              contentId: 'content-1',
              topicId: 'topic-1',
            }),
          ),
        findSteps: () =>
          Promise.resolve(
            [
              WorkflowStepName.Topic,
              WorkflowStepName.Script,
              WorkflowStepName.Scene,
              WorkflowStepName.VisualPlan,
              WorkflowStepName.Image,
            ].map((step) => recordedStep(step, WorkflowStepStatus.Succeeded)),
          ),
        updateRun: () => Promise.resolve(asFake<WorkflowRunDto>({ id: 'run-1' })),
        recordStep: () => Promise.resolve(asFake<WorkflowStepRunDto>({ id: 'step' })),
      }),
      asFake<TopicRepository>({ findById: () => Promise.resolve(topic) }),
      asFake<ContentRepository>({
        findById: () =>
          Promise.resolve(
            asFake<ContentDto>({
              id: 'content-1',
              title: 'A title',
              scenes: [],
              visualPrompts: [],
              narrationBlocks: [],
            }),
          ),
      }),
      asFake<ImageRepository>({
        findByContentId: () =>
          Promise.resolve([
            asFake<SceneImageDto>({
              sceneNumber: 1,
              fileName: 'scene-001.jpg',
              relativePath: 'images/scene-001.jpg',
              byteSize: 1234,
              width: 768,
              height: 1376,
              generationDurationMs: 0,
              combo: 'manual',
            }),
          ]),
      }),
      asFake<AudioRepository>({ findByContentId: () => Promise.resolve([]) }),
      { outputDirectory: '/tmp/out', promptsDirectory: '/tmp/prompts' },
      succeedingAgent<TopicRequestDto, TopicDto>('TopicAgent', topic),
      succeedingAgent<ScriptRequestDto, ScriptDto>('ScriptAgent', script),
      succeedingAgent<ScenePlanRequestDto, ScenePlanDto>('SceneAgent', scenePlan),
      succeedingAgent<VisualPlanRequestDto, VisualPlanDto>('VisualPlannerAgent', visualPlan),
      succeedingAgent<ImageGenerationRequestDto, ImageGenerationResponseDto>('ImageAgent', images),
      succeedingAgent<NarrationPlanRequestDto, NarrationPlanDto>('NarrationPlannerAgent', narrationPlan),
      succeedingAgent<VoiceRequestDto, VoiceGenerationResponseDto>('VoiceAgent', voice),
      succeedingAgent<SubtitleRequestDto, SubtitleGenerationResponseDto>('SubtitleAgent', subtitle),
      recordingAgent<RenderPlanRequestDto, RenderPlanDto>('TimelineBuilderAgent', renderPlan, seen),
      succeedingAgent<VideoRenderRequestDto, VideoRenderResponseDto>('FfmpegComposerAgent', video),
      null,
      asFake<CredentialRepository>({ findUsable: () => Promise.resolve(null) }),
      asFake<VideoRepository>({ findByContentId: () => Promise.resolve([]) }),
      new RetryExecutor(retryConfig, new NoopLogger()),
      new NoopLogger(),
    );

    await workflow.execute({
      ...request,
      resumeCorrelationId: 'run-1',
      stopAfterStep: WorkflowStepName.RenderPlan,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.images).toHaveLength(1);
    expect(seen[0]?.images[0]?.absolutePath).toBe('/tmp/out/workflows/run-1/images/scene-001.jpg');
    expect(seen[0]?.images[0]?.combo).toBe('manual');
  });
});

describe('resolvePendingSteps and cheap recomputation', () => {
  it('re-runs the subtitle and render plan even when they already succeeded', () => {
    // Both are pure computation with nothing persisted to restore them from, so
    // skipping them leaves the next step holding a null.
    const pending = resolvePendingSteps(
      [
        WorkflowStepName.Topic,
        WorkflowStepName.Script,
        WorkflowStepName.Scene,
        WorkflowStepName.VisualPlan,
        WorkflowStepName.Image,
        WorkflowStepName.NarrationPlan,
        WorkflowStepName.Voice,
        WorkflowStepName.Subtitle,
        WorkflowStepName.RenderPlan,
      ].map((step) => recordedStep(step, WorkflowStepStatus.Succeeded)),
    );

    expect(pending).toContain(WorkflowStepName.Subtitle);
    expect(pending).toContain(WorkflowStepName.RenderPlan);
    expect(pending).toContain(WorkflowStepName.Compose);
  });

  it('still skips the expensive steps that did succeed', () => {
    const pending = resolvePendingSteps(
      [WorkflowStepName.Topic, WorkflowStepName.Image, WorkflowStepName.Voice].map((step) =>
        recordedStep(step, WorkflowStepStatus.Succeeded),
      ),
    );

    expect(pending).not.toContain(WorkflowStepName.Topic);
    expect(pending).not.toContain(WorkflowStepName.Image);
    expect(pending).not.toContain(WorkflowStepName.Voice);
  });
});

describe('GenerateContentWorkflow publishing', () => {
  const upload = asFake<UploadDto>({
    id: 'upload-1',
    externalUrl: 'https://www.tiktok.com/@yu.tomation/video/7123',
  });

  it('skips publishing when no account is enabled, and still finishes', async () => {
    // A run with nowhere to publish has produced everything it was asked for.
    // Failing it would turn a working pipeline into a red dashboard for a
    // reason nobody chose.
    const transitions: { step: WorkflowStepName; status: WorkflowStepStatus }[] = [];
    const workflow = createWorkflow(transitions, []);

    const result = await workflow.execute(request);

    expect(result.success).toBe(true);
    expect(transitions).toContainEqual({
      step: WorkflowStepName.Upload,
      status: WorkflowStepStatus.Skipped,
    });
    expect(transitions).not.toContainEqual({
      step: WorkflowStepName.Upload,
      status: WorkflowStepStatus.Running,
    });
  });

  it('publishes when an account is enabled, and reports where it went', async () => {
    const transitions: { step: WorkflowStepName; status: WorkflowStepStatus }[] = [];
    const workflow = createWorkflow(transitions, [], {
      uploadAgent: succeedingAgent<UploadRequestDto, UploadDto>('BrowserUploadAgent', upload),
      account: asFake<CredentialDto>({ id: 'credential-1', label: '@yu.tomation' }),
    });

    const result = await workflow.execute(request);

    expect(result.success).toBe(true);
    expect(result.success ? result.data.uploadUrl : null).toBe(
      'https://www.tiktok.com/@yu.tomation/video/7123',
    );
    expect(transitions).toContainEqual({
      step: WorkflowStepName.Upload,
      status: WorkflowStepStatus.Succeeded,
    });
  });

  it('hands the uploader the rendered file and the script title', async () => {
    const seen: UploadRequestDto[] = [];
    const workflow = createWorkflow([], [], {
      uploadAgent: recordingAgent<UploadRequestDto, UploadDto>(
        'BrowserUploadAgent',
        upload,
        seen,
      ),
      account: asFake<CredentialDto>({ id: 'credential-1' }),
    });

    await workflow.execute(request);

    expect(seen[0]?.video).toBe(video.video);
    expect(seen[0]?.title).toBe(script.title);
    // The description is the written caption, not the title again — that was
    // the whole of YouTube's description before.
    expect(seen[0]?.description).toContain(script.caption);
  });
});

describe('GenerateContentWorkflow restoring the narration', () => {
  /** A run where everything up to and including COMPOSE already succeeded. */
  const finishedThrough = (step: WorkflowStepName): WorkflowStepRunDto[] =>
    IMPLEMENTED_PIPELINE_STEPS.slice(0, IMPLEMENTED_PIPELINE_STEPS.indexOf(step) + 1).map((name) =>
      recordedStep(name, WorkflowStepStatus.Succeeded),
    );

  const resumedWorkflow = (
    audios: readonly unknown[],
    seen: RenderPlanRequestDto[],
  ): GenerateContentWorkflow =>
    new GenerateContentWorkflow(
      asFake<WorkflowRepository>({
        findRunByCorrelationId: () =>
          Promise.resolve(
            asFake<WorkflowRunDto>({
              id: 'run-1',
              correlationId: 'run-1',
              status: WorkflowStatus.Failed,
              contentId: 'content-1',
              topicId: 'topic-1',
            }),
          ),
        findSteps: () => Promise.resolve(finishedThrough(WorkflowStepName.Voice)),
        updateRun: () => Promise.resolve(asFake<WorkflowRunDto>({ id: 'run-1' })),
        recordStep: () => Promise.resolve(asFake<WorkflowStepRunDto>({ id: 'step' })),
      }),
      asFake<TopicRepository>({ findById: () => Promise.resolve(topic) }),
      asFake<ContentRepository>({
        findById: () =>
          Promise.resolve(
            asFake<ContentDto>({
              id: 'content-1',
              title: 'A title',
              scenes: [],
              visualPrompts: [],
              narrationBlocks: [],
            }),
          ),
      }),
      asFake<ImageRepository>({
        findByContentId: () =>
          Promise.resolve([
            asFake<SceneImageDto>({
              sceneNumber: 1,
              fileName: 'scene-001.jpg',
              relativePath: 'images/scene-001.jpg',
              byteSize: 1234,
              width: 768,
              height: 1376,
              generationDurationMs: 0,
              combo: 'manual',
            }),
          ]),
      }),
      asFake<AudioRepository>({
        findByContentId: () => Promise.resolve(audios as never),
      }),
      { outputDirectory: '/tmp/out', promptsDirectory: '/tmp/prompts' },
      succeedingAgent<TopicRequestDto, TopicDto>('TopicAgent', topic),
      succeedingAgent<ScriptRequestDto, ScriptDto>('ScriptAgent', script),
      succeedingAgent<ScenePlanRequestDto, ScenePlanDto>('SceneAgent', scenePlan),
      succeedingAgent<VisualPlanRequestDto, VisualPlanDto>('VisualPlannerAgent', visualPlan),
      succeedingAgent<ImageGenerationRequestDto, ImageGenerationResponseDto>('ImageAgent', images),
      succeedingAgent<NarrationPlanRequestDto, NarrationPlanDto>(
        'NarrationPlannerAgent',
        narrationPlan,
      ),
      succeedingAgent<VoiceRequestDto, VoiceGenerationResponseDto>('VoiceAgent', voice),
      succeedingAgent<SubtitleRequestDto, SubtitleGenerationResponseDto>('SubtitleAgent', subtitle),
      recordingAgent<RenderPlanRequestDto, RenderPlanDto>('TimelineBuilderAgent', renderPlan, seen),
      succeedingAgent<VideoRenderRequestDto, VideoRenderResponseDto>('FfmpegComposerAgent', video),
      null,
      asFake<CredentialRepository>({ findUsable: () => Promise.resolve(null) }),
      asFake<VideoRepository>({ findByContentId: () => Promise.resolve([]) }),
      new RetryExecutor(retryConfig, new NoopLogger()),
      new NoopLogger(),
    );

  it('rebuilds the narration from narration_audios so the timeline can be built', async () => {
    // RENDER_PLAN is always recomputed on a resume, but VOICE is skipped
    // because it succeeded. Without the restore, nothing put the audio back and
    // every resumed run stopped at the timeline builder with "needs the scenes,
    // images, narration, audio and subtitles" — with the video already made.
    const seen: RenderPlanRequestDto[] = [];
    const workflow = resumedWorkflow(
      [
        {
          fileName: 'narration.mp3',
          relativePath: 'audio/narration.mp3',
          byteSize: 512_000,
          mimeType: 'audio/mpeg',
          durationMs: 44_000,
          voice: 'en',
          model: 'google-tts/en',
          speed: 1,
          generationDurationMs: 9_000,
        },
      ],
      seen,
    );

    const result = await workflow.execute({ ...request, resumeCorrelationId: 'run-1' });

    expect(result.success).toBe(true);
    expect(seen[0]?.voice.audio.absolutePath).toBe('/tmp/out/workflows/run-1/audio/narration.mp3');
    expect(seen[0]?.voice.audio.durationSeconds).toBe(44);
  });

  it('still refuses when there is no narration to restore', async () => {
    // Not a silent skip: the renderer would produce a silent video, which is
    // worse than a run that says what is missing.
    const workflow = resumedWorkflow([], []);

    const result = await workflow.execute({ ...request, resumeCorrelationId: 'run-1' });

    expect(result.success).toBe(false);
  });
});
