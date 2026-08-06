/** What the caller asks for when it wants subjects to choose between. */
export interface TopicIdeaRequestDto {
  /** Identity of the request, carried into every log record. */
  readonly correlationId: string;
  readonly language: string;
  /** How many to propose. */
  readonly count: number;
  /** Spoken length each idea has to fit into. */
  readonly durationSeconds: number;
  /** Titles already in the library, so the same ground is not suggested twice. */
  readonly excludedTitles: readonly string[];
  /**
   * The corner of knowledge to search in, e.g. `how the human body works`.
   *
   * Asked without one, a model returns the same handful of crowd-pleasers
   * however many times it is asked — cats landing on their feet, honey never
   * spoiling. Naming an area is what makes the second ask reach somewhere the
   * first could not.
   */
  readonly angle: string;
}

/**
 * One proposal.
 *
 * Nothing here is persisted. An idea becomes a topic only when somebody picks
 * it and starts a run, which is what keeps the library a record of work done
 * rather than of work considered.
 */
export interface TopicIdeaDto {
  readonly title: string;
  /** Why someone would stop scrolling for it. */
  readonly hook: string;
  /** The surprising part, in one sentence. */
  readonly why: string;
}
