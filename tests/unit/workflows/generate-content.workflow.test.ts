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
import type { ContentRepository } from '../../../src/repositories/content.repository.js';
import type { TopicRepository } from '../../../src/repositories/topic.repository.js';
import type { WorkflowRepository } from '../../../src/repositories/workflow.repository.js';
import type { Agent } from '../../../src/types/agent.js';
import { NotImplementedError } from '../../../src/types/errors/not-implemented.error.js';
import { TopicStatus } from '../../../src/types/topic.js';
import { fail, ok } from '../../../src/types/result.js';
import {
  PIPELINE_STEPS,
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
  it('returns the whole pipeline for a run that has not started', () => {
    expect(resolvePendingSteps([])).toEqual(PIPELINE_STEPS);
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

    expect(pending).toEqual(PIPELINE_STEPS);
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
  } = {},
): GenerateContentWorkflow =>
  new GenerateContentWorkflow(
    createWorkflowRepository(transitions, statuses),
    asFake<TopicRepository>({ findById: () => Promise.resolve(topic) }),
    asFake<ContentRepository>({ findById: () => Promise.resolve(null) }),
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

  it('reports steps beyond rendering as not implemented', async () => {
    const workflow = createWorkflow([], []);

    const result = await workflow.execute({
      ...request,
      stopAfterStep: WorkflowStepName.QualityCheck,
    });

    expect(result.success).toBe(false);
  });
});
