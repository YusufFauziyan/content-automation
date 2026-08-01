/** Everything the browser automation needs to publish one video. */
export interface PublishRequest {
  readonly videoPath: string;
  readonly caption: string;
  readonly hashtags: readonly string[];
}

/** What the platform reported once the upload finished. */
export interface PublishResult {
  readonly externalId: string;
  readonly externalUrl: string;
}

/**
 * Contract for browser-driven publishing.
 *
 * External system: Playwright driving the TikTok web application.
 *
 * The service performs the interaction. Deciding *whether* to publish, and
 * whether the published result is acceptable, belongs to the Upload and QA
 * agents.
 */
export interface PlaywrightService {
  /**
   * Publishes one video.
   *
   * @throws {ApplicationError} Marked retryable for navigation timeouts.
   */
  publish(request: PublishRequest): Promise<PublishResult>;

  /**
   * Confirms that a published video is reachable.
   *
   * Media may only be deleted after this returns `true`
   * (ARCHITECTURE.md "Temporary Media Lifecycle").
   */
  verify(externalUrl: string): Promise<boolean>;
}
