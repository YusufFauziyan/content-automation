/** Lifecycle of a topic candidate. */
export enum TopicStatus {
  /** Produced by the Topic Agent, not yet cleared by duplicate detection. */
  Candidate = 'CANDIDATE',
  /** Unique, and cleared for script generation. */
  Accepted = 'ACCEPTED',
  /** Rejected because an exact or semantically similar topic already exists. */
  RejectedDuplicate = 'REJECTED_DUPLICATE',
  /** Kept for history, excluded from future selection. */
  Archived = 'ARCHIVED',
}
