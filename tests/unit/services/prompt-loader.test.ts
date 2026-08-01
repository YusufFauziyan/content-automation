import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { MediaConfig } from '../../../src/config/app.config.js';
import { FilePromptLoader, PromptName } from '../../../src/services/prompt-loader.service.js';
import {
  PromptNotFoundError,
  PromptPlaceholderMissingError,
} from '../../../src/types/errors/prompt.error.js';

/** Points at the real prompt directory: the files are part of the contract. */
const mediaConfig: MediaConfig = {
  outputDirectory: resolve('output'),
  promptsDirectory: resolve('src/prompts'),
};

const TOPIC_VARIABLES = {
  category: 'personal finance',
  language: 'en',
  audience: 'first-time investors',
  durationSeconds: '45',
  excludedTitles: '- something already covered',
};

describe('FilePromptLoader', () => {
  it('substitutes every placeholder in a prompt', async () => {
    const loader = new FilePromptLoader(mediaConfig);

    const rendered = await loader.render({ name: PromptName.Topic }, TOPIC_VARIABLES);

    expect(rendered).toContain('personal finance');
    expect(rendered).toContain('first-time investors');
    expect(rendered).not.toContain('{{');
  });

  it('reports which values were missing rather than sending a raw placeholder', async () => {
    const loader = new FilePromptLoader(mediaConfig);

    await expect(
      loader.render({ name: PromptName.Topic }, { category: 'x' }),
    ).rejects.toBeInstanceOf(PromptPlaceholderMissingError);
  });

  it('fails when the prompt file does not exist', async () => {
    const loader = new FilePromptLoader({
      ...mediaConfig,
      promptsDirectory: resolve('src/prompts/does-not-exist'),
    });

    await expect(loader.render({ name: PromptName.Topic }, TOPIC_VARIABLES)).rejects.toBeInstanceOf(
      PromptNotFoundError,
    );
  });

  it('resolves a versioned prompt to its own file', async () => {
    const loader = new FilePromptLoader(mediaConfig);

    // `topic.v9.md` does not exist, which proves the version reached the path.
    await expect(
      loader.render({ name: PromptName.Topic, version: 9 }, TOPIC_VARIABLES),
    ).rejects.toThrow(/topic\.v9\.md/u);
  });

  it('renders every prompt the text pipeline depends on', async () => {
    const loader = new FilePromptLoader(mediaConfig);

    const script = await loader.render(
      { name: PromptName.Script },
      {
        title: 'A title',
        description: 'A description',
        language: 'en',
        audience: 'everyone',
        durationSeconds: '45',
      },
    );
    const scene = await loader.render(
      { name: PromptName.Scene },
      { script: 'Narration.', language: 'en', durationSeconds: '45', visualStyle: 'cinematic' },
    );

    expect(script).not.toContain('{{');
    expect(scene).not.toContain('{{');
  });
});
