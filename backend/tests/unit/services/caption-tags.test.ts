import { describe, expect, it } from 'vitest';

import { captionWithTags } from '../../../src/services/playwright.service.js';

/** What the script agent really produces: between three and eight. */
const seven = ['science', 'tickle', 'brainfacts', 'funfacts', 'scienceforkids', 'didyouknow', 'learnontiktok'];

describe('captionWithTags', () => {
  it('carries only as many tags as the platform is given room for', () => {
    const caption = captionWithTags('Why does tickling work?', seven, 5);

    expect(caption.match(/#/gu)).toHaveLength(5);
    expect(caption).toContain('#science');
    expect(caption).not.toContain('#learnontiktok');
  });

  it('keeps the first ones, which are the ones closest to the subject', () => {
    // Not a random five: the writer puts the tags nearest the topic first, so
    // the front of an ordered list is a better set than a sample of it.
    expect(captionWithTags('', seven, 3)).toBe('#science #tickle #brainfacts');
  });

  it('does not let a repeat use up one of the places', () => {
    // De-duplicated before trimming. The other way round, a doubled tag would
    // silently cost a slot and the caption would carry four where five fit.
    const caption = captionWithTags('', ['a', 'a', 'b', 'c', 'd', 'e', 'f'], 5);

    expect(caption).toBe('#a #b #c #d #e');
  });

  it('adds the hash to tags written without one, and keeps those that have it', () => {
    expect(captionWithTags('', ['plain', '#already'], 5)).toBe('#plain #already');
  });

  it('leaves a caption alone when the platform wants no tags at all', () => {
    expect(captionWithTags('Just the words', seven, 0)).toBe('Just the words');
  });

  it('is happy with fewer tags than the limit', () => {
    expect(captionWithTags('Hook', ['one', 'two'], 5)).toBe('Hook #one #two');
  });
});
