import { describe, expect, it } from 'vitest';

import type { BrowserPublishConfig } from '../../../src/config/app.config.js';
import { YouTubePublishService } from '../../../src/services/youtube.service.js';
import { PublishSessionExpiredError } from '../../../src/types/errors/publish.error.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';

const mockConfig: BrowserPublishConfig = {
  headless: true,
  timeoutMs: 5000,
  loginTimeoutMs: 5000,
  maxHashtags: 5,
  loginUrl: 'https://studio.youtube.com',
  uploadUrl: 'https://studio.youtube.com/channel/test/videos/upload',
  profileBaseUrl: 'https://youtube.com',
  platform: 'YOUTUBE',
  madeForKids: false,
  retry: { maxRetries: 0, backoffMs: [] },
};

describe('YouTubePublishService', () => {
  it('throws PublishSessionExpiredError if storageState is invalid JSON', async () => {
    const service = new YouTubePublishService(mockConfig, new NoopLogger());

    await expect(
      service.publish({
        videoPath: '/tmp/test.mp4',
        coverPath: null,
        title: 'Test Video',
        description: 'Test Description',
        hashtags: ['test'],
        session: {
          storageState: 'invalid-json',
          handle: 'channel',
        },
      }),
    ).rejects.toThrow(PublishSessionExpiredError);
  });
});
