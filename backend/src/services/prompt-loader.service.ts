import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { MediaConfig } from '../config/app.config.js';
import {
  PromptNotFoundError,
  PromptPlaceholderMissingError,
} from '../types/errors/prompt.error.js';

/** Prompts the pipeline knows about. */
export enum PromptName {
  Topic = 'topic',
  /** Instruction that proposes several subjects to choose between. */
  TopicIdeas = 'topic-ideas',
  Script = 'script',
  Scene = 'scene',
  /** Instruction that produces the image briefs. */
  VisualPrompt = 'visual-prompt',
  /** Template that assembles one brief into the string an image model receives. */
  Image = 'image',
  /** Instruction that splits a script into narration blocks. */
  Narration = 'narration',
  Thumbnail = 'thumbnail',
  Voice = 'voice',
}

/**
 * Identifies one prompt file.
 *
 * Omitting `version` loads the base file (`topic.md`). Supplying one loads
 * `topic.v2.md`, which is how a prompt can be revised without invalidating the
 * runs that were produced with the previous wording.
 */
export interface PromptReference {
  readonly name: PromptName;
  readonly version?: number;
}

/** Values substituted into a template's `{{placeholders}}`. */
export type PromptVariables = Readonly<Record<string, string>>;

/**
 * Contract for loading prompt templates.
 *
 * External system: the filesystem.
 *
 * Prompts are never written inline in TypeScript (PROJECT_RULES.md "Prompt
 * Rules"): they are content, they change far more often than code, and they
 * must be reviewable on their own.
 */
export interface PromptLoader {
  /**
   * Loads a prompt and substitutes its placeholders.
   *
   * @throws {PromptNotFoundError} When the file does not exist.
   * @throws {PromptPlaceholderMissingError} When a placeholder has no value.
   */
  render(reference: PromptReference, variables: PromptVariables): Promise<string>;
}

/** Matches `{{ placeholder }}` with any surrounding whitespace. */
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/gu;

/** A line containing nothing but `---`, which ends the documentation block. */
const HEADER_SEPARATOR = /^\s*---\s*$/mu;

/**
 * Drops the documentation block every prompt file opens with.
 *
 * The header names the consuming agent and lists the placeholders, which is
 * useful to a reviewer and noise to a model. Stripping it here means a prompt
 * file can be documented without that documentation being sent anywhere.
 */
const stripHeader = (template: string): string => {
  const separator = HEADER_SEPARATOR.exec(template);

  if (separator?.index === undefined) {
    return template.trim();
  }

  return template.slice(separator.index + separator[0].length).trim();
};

/** Builds the file name for a reference, e.g. `topic.md` or `topic.v2.md`. */
const toFileName = (reference: PromptReference): string =>
  reference.version === undefined
    ? `${reference.name}.md`
    : `${reference.name}.v${String(reference.version)}.md`;

/**
 * Filesystem implementation of {@link PromptLoader}.
 *
 * Templates are cached after first read: prompt files do not change while the
 * process runs, and the topic loop can render the same template several times
 * per run.
 */
export class FilePromptLoader implements PromptLoader {
  private readonly cache = new Map<string, string>();

  constructor(private readonly mediaConfig: MediaConfig) {}

  public async render(reference: PromptReference, variables: PromptVariables): Promise<string> {
    const template = await this.load(reference);
    const missing: string[] = [];

    const rendered = template.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
      const value = variables[key];

      if (value === undefined) {
        missing.push(key);
        return '';
      }

      return value;
    });

    if (missing.length > 0) {
      throw new PromptPlaceholderMissingError(toFileName(reference), missing);
    }

    return rendered;
  }

  /** Reads a template, going to disk only once per file. */
  private async load(reference: PromptReference): Promise<string> {
    const fileName = toFileName(reference);
    const cached = this.cache.get(fileName);

    if (cached !== undefined) {
      return cached;
    }

    const path = join(this.mediaConfig.promptsDirectory, fileName);

    try {
      const contents = stripHeader(await readFile(path, 'utf8'));
      this.cache.set(fileName, contents);
      return contents;
    } catch {
      throw new PromptNotFoundError(path);
    }
  }
}
