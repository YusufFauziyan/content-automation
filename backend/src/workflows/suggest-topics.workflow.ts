import type { TopicIdeaDto, TopicIdeaRequestDto } from '../dto/topic-idea.dto.js';
import type { TopicRepository } from '../repositories/topic.repository.js';
import type { Agent } from '../types/agent.js';
import type { Logger } from '../types/logger.js';
import type { Result } from '../types/result.js';

/**
 * Titles shown to the model so it does not propose what already exists.
 *
 * Generous, because this list is the only memory the model has: a subject that
 * falls off the end is one it may cheerfully suggest again, and the Topic Agent
 * then spends a rejection discovering what this could have prevented.
 */
const EXCLUSION_LIST_SIZE = 120;

/**
 * Corners of knowledge to search in, one per ask.
 *
 * Without an area a model returns the same handful of favourites however often
 * it is asked, so a schedule that keeps running eventually collides with its own
 * library and stalls. Naming a different area each time is what makes the supply
 * of subjects effectively endless: the space is wide, and each ask searches a
 * different part of it.
 *
 * They are broad on purpose. A narrow area runs dry; "how everyday objects
 * work" does not.
 */
export const ANGLES: readonly string[] = [
  'how the human body works',
  'animals and how they survive',
  'weather, oceans and the sky',
  'space and the things in it',
  'how everyday objects are made',
  'food, cooking and why it behaves that way',
  'light, sound and how we sense them',
  'plants, fungi and things that grow',
  'materials and why they behave as they do',
  'machines and how they actually work',
  'history of inventions people take for granted',
  'the planet beneath us — rocks, quakes and ice',
  'numbers, patterns and odd coincidences',
  'language and how people communicate',
  'the very small: cells, atoms and microbes',
  'transport: how things move people around',
];

/**
 * Produces a short list of subjects to choose between.
 *
 * A single step, so this is thin — but it is where the exclusion list is
 * assembled, and that is a rule about the library rather than about asking a
 * model. Keeping it here leaves the agent with one job and lets a second caller
 * get the same behaviour without repeating it.
 *
 * Nothing is written. These are suggestions, and four of five will be thrown
 * away.
 */
export class SuggestTopicsWorkflow {
  constructor(
    private readonly topicIdeasAgent: Agent<TopicIdeaRequestDto, readonly TopicIdeaDto[]>,
    private readonly topicRepository: TopicRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * @param request.alsoExclude Titles refused earlier in this attempt. Asking
   *                            again without them produces the same
   *                            crowd-pleasers a second time — the model has no
   *                            memory between calls, so the caller supplies it.
   */
  public async suggest(request: {
    correlationId: string;
    language: string;
    count: number;
    durationSeconds: number;
    alsoExclude?: readonly string[];
    /** Area to search in. One is chosen at random when the caller has no view. */
    angle?: string;
  }): Promise<Result<readonly TopicIdeaDto[]>> {
    const stored = await this.topicRepository.findRecentTitles(null, EXCLUSION_LIST_SIZE);
    const excludedTitles = [...stored, ...(request.alsoExclude ?? [])];

    this.logger.debug('Suggesting topics', {
      source: SuggestTopicsWorkflow.name,
      correlationId: request.correlationId,
      excluded: excludedTitles.length,
    });

    const angle =
      request.angle ??
      ANGLES[Math.floor(Math.random() * ANGLES.length)] ??
      'interesting knowledge';

    return this.topicIdeasAgent.execute({ ...request, excludedTitles, angle });
  }
}
