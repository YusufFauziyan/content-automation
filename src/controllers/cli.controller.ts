import type { ContentConfig, ImageConfig } from '../config/app.config.js';
import type {
  GenerateContentResponseDto,
  PipelineRequestDto,
} from '../dto/workflow-context.dto.js';
import type { Logger } from '../types/logger.js';
import type { Result } from '../types/result.js';
import type { GenerateContentUseCase } from '../use-cases/generate-content.usecase.js';
import type { GenerateImageUseCase } from '../use-cases/generate-image.usecase.js';
import type { GenerateSceneUseCase } from '../use-cases/generate-scene.usecase.js';
import type { GenerateScriptUseCase } from '../use-cases/generate-script.usecase.js';
import type { GenerateTopicUseCase } from '../use-cases/generate-topic.usecase.js';
import type { GenerateVoiceUseCase } from '../use-cases/generate-voice.usecase.js';
import type { RenderVideoUseCase } from '../use-cases/render-video.usecase.js';
import type { ResumeInterruptedUseCase } from '../use-cases/resume-interrupted.usecase.js';

/** Process exit codes returned by {@link CliController.run}. */
export enum ExitCode {
  Success = 0,
  Failure = 1,
  UsageError = 2,
}

/** Commands the CLI accepts. */
const COMMANDS = [
  'generate',
  'topic',
  'script',
  'scene',
  'image',
  'voice',
  'render',
  'resume',
] as const;
type CommandName = (typeof COMMANDS)[number];

const DEFAULT_LANGUAGE = 'en';
const DEFAULT_CATEGORY = 'general knowledge';
const DEFAULT_AUDIENCE = 'a general audience';
const DEFAULT_VISUAL_STYLE = 'cinematic';
const DEFAULT_RESUME_LIMIT = 5;

const USAGE = [
  'Usage: yu-tomation <command> [options]',
  '',
  'Commands:',
  '  generate   Run the content pipeline as far as it is built',
  '  topic      Produce one unique topic and stop',
  '  script     Produce the script (generating the topic first if needed)',
  '  scene      Produce the scene plan (generating what precedes it if needed)',
  '  image      Produce one image per scene (generating what precedes them if needed)',
  '  voice      Produce narration.mp3 and subtitle.srt (generating what precedes them)',
  '  render     Produce final.mp4 (generating everything it needs first)',
  '  resume     Continue runs that were interrupted',
  '',
  'Options:',
  '  --category <text>         Thematic area for topic selection',
  '  --language <code>         Content language (default: en)',
  '  --audience <text>         Who the video is for',
  '  --duration <seconds>      Spoken length to write for',
  '  --style <text>            Visual style for the scene plan and the images',
  '  --aspect-ratio <w:h>      Aspect ratio the images are framed for',
  '  --correlation-id <uuid>   Continue one specific run',
  '  --limit <number>          Maximum runs to resume (resume only)',
].join('\n');

/** Parses `--key value` pairs. Flags without a value are ignored. */
const parseOptions = (argv: readonly string[]): Readonly<Record<string, string>> => {
  const options: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (flag === undefined || !flag.startsWith('--') || value === undefined) {
      continue;
    }

    options[flag.slice(2)] = value;
  }

  return options;
};

const isCommand = (value: string | undefined): value is CommandName =>
  value !== undefined && (COMMANDS as readonly string[]).includes(value);

/** Reads a positive integer option, falling back when it is absent or unusable. */
const readPositiveInteger = (raw: string | undefined, fallback: number): number | null => {
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number(raw);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Command-line entry point.
 *
 * The controller translates process arguments into a use-case call and a
 * use-case result into an exit code. It holds no business logic, touches no
 * database and knows nothing about workflows or agents.
 */
export class CliController {
  constructor(
    private readonly generateContentUseCase: GenerateContentUseCase,
    private readonly generateTopicUseCase: GenerateTopicUseCase,
    private readonly generateScriptUseCase: GenerateScriptUseCase,
    private readonly generateSceneUseCase: GenerateSceneUseCase,
    private readonly generateImageUseCase: GenerateImageUseCase,
    private readonly generateVoiceUseCase: GenerateVoiceUseCase,
    private readonly renderVideoUseCase: RenderVideoUseCase,
    private readonly resumeInterruptedUseCase: ResumeInterruptedUseCase,
    private readonly contentConfig: ContentConfig,
    private readonly imageConfig: ImageConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Executes one command.
   *
   * @param argv Arguments without the node executable and script path.
   * @returns The exit code the process should terminate with.
   */
  public async run(argv: readonly string[]): Promise<ExitCode> {
    const logger = this.logger.child({ source: CliController.name });
    const [command, ...rest] = argv;

    if (!isCommand(command)) {
      logger.warn('Unknown command', { command: command ?? null, usage: USAGE });
      return ExitCode.UsageError;
    }

    const options = parseOptions(rest);
    const durationSeconds = readPositiveInteger(
      options['duration'],
      this.contentConfig.scriptTargetDurationSeconds,
    );

    if (durationSeconds === null) {
      logger.warn('Invalid --duration', { value: options['duration'] ?? null, usage: USAGE });
      return ExitCode.UsageError;
    }

    const request: PipelineRequestDto = {
      category: options['category'] ?? DEFAULT_CATEGORY,
      language: options['language'] ?? DEFAULT_LANGUAGE,
      audience: options['audience'] ?? DEFAULT_AUDIENCE,
      durationSeconds,
      visualStyle: options['style'] ?? DEFAULT_VISUAL_STYLE,
      aspectRatio: options['aspect-ratio'] ?? this.imageConfig.aspectRatio,
      ...(options['correlation-id'] === undefined
        ? {}
        : { resumeCorrelationId: options['correlation-id'] }),
    };

    if (command === 'resume') {
      return this.runResume(request, options['limit'], logger);
    }

    return this.runPipeline(command, request, logger);
  }

  /** Dispatches one of the generation commands and reports what it produced. */
  private async runPipeline(
    command: Exclude<CommandName, 'resume'>,
    request: PipelineRequestDto,
    logger: Logger,
  ): Promise<ExitCode> {
    const result = await this.invoke(command, request);

    if (!result.success) {
      logger.error(`${command} failed`, result.error);
      return ExitCode.Failure;
    }

    logger.info(`${command} finished`, this.describe(result.data));

    return ExitCode.Success;
  }

  /** Maps a command onto its use-case. */
  private invoke(
    command: Exclude<CommandName, 'resume'>,
    request: PipelineRequestDto,
  ): Promise<Result<GenerateContentResponseDto>> {
    switch (command) {
      case 'topic':
        return this.generateTopicUseCase.execute(request);
      case 'script':
        return this.generateScriptUseCase.execute(request);
      case 'scene':
        return this.generateSceneUseCase.execute(request);
      case 'image':
        return this.generateImageUseCase.execute(request);
      case 'voice':
        return this.generateVoiceUseCase.execute(request);
      case 'render':
        return this.renderVideoUseCase.execute(request);
      case 'generate':
        return this.generateContentUseCase.execute(request);
    }
  }

  /** Summarises a response for the log without dumping the whole script. */
  private describe(response: GenerateContentResponseDto): Record<string, unknown> {
    return {
      correlationId: response.correlationId,
      status: response.status,
      topicTitle: response.topic?.title ?? null,
      contentId: response.script?.contentId ?? null,
      sceneCount: response.scenePlan?.scenes.length ?? 0,
      imageCount: response.images?.images.length ?? 0,
      imagesDirectory: response.images?.imagesDirectory ?? null,
      narrationBlocks: response.narrationPlan?.blocks.length ?? 0,
      audioFile: response.voice?.audio.relativePath ?? null,
      subtitleFile: response.subtitle?.subtitle.relativePath ?? null,
      subtitleCues: response.subtitle?.subtitle.cueCount ?? 0,
      videoFile: response.video?.video.relativePath ?? null,
      videoDurationMs: response.video?.video.durationMs ?? 0,
      videoResolution:
        response.video === null
          ? null
          : `${String(response.video.video.width)}x${String(response.video.video.height)}`,
    };
  }

  /** Runs the recovery sweep. */
  private async runResume(
    request: PipelineRequestDto,
    rawLimit: string | undefined,
    logger: Logger,
  ): Promise<ExitCode> {
    const limit = readPositiveInteger(rawLimit, DEFAULT_RESUME_LIMIT);

    if (limit === null) {
      logger.warn('Invalid --limit', { value: rawLimit ?? null, usage: USAGE });
      return ExitCode.UsageError;
    }

    const summary = await this.resumeInterruptedUseCase.execute({ defaults: request, limit });

    logger.info('resume finished', { ...summary });

    return summary.failed === 0 ? ExitCode.Success : ExitCode.Failure;
  }
}
