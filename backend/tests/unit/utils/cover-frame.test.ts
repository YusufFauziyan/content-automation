import { describe, expect, it } from 'vitest';

import { pickCoverImage, type CoverCandidate } from '../../../src/utils/video/cover-frame.js';

/** Five scenes of nine seconds each — a 45-second short. */
const scenes: CoverCandidate[] = Array.from({ length: 5 }, (_unused, index) => ({
  scene: index + 1,
  imagePath: `/runs/1/images/scene-00${String(index + 1)}.png`,
  startTime: index * 9,
  endTime: (index + 1) * 9,
}));

describe('pickCoverImage', () => {
  it('takes a still from past the opening, not the first frame', () => {
    // The first frame is what every platform grabs when nobody chooses, and in
    // this pipeline it is the opening shot with the first caption burned over
    // it, before the camera has begun to move.
    const chosen = pickCoverImage(scenes, 0.35);

    expect(chosen).toBe('/runs/1/images/scene-002.png');
    expect(chosen).not.toBe(scenes[0]?.imagePath);
  });

  it('follows the fraction it is given', () => {
    expect(pickCoverImage(scenes, 0)).toBe('/runs/1/images/scene-001.png');
    expect(pickCoverImage(scenes, 0.5)).toBe('/runs/1/images/scene-003.png');
    expect(pickCoverImage(scenes, 0.9)).toBe('/runs/1/images/scene-005.png');
  });

  it('lands on the last scene rather than nothing at the very end', () => {
    // A fraction of exactly 1 falls on the boundary no scene contains, and
    // returning null there would silently drop the cover.
    expect(pickCoverImage(scenes, 1)).toBe('/runs/1/images/scene-005.png');
  });

  it('clamps a fraction that makes no sense instead of falling off the plan', () => {
    expect(pickCoverImage(scenes, -2)).toBe('/runs/1/images/scene-001.png');
    expect(pickCoverImage(scenes, 9)).toBe('/runs/1/images/scene-005.png');
  });

  it('handles scenes of unequal length by time, not by count', () => {
    // Scene 1 runs long. A third of the way through by *time* is still scene 1,
    // which counting scenes would get wrong.
    const uneven: CoverCandidate[] = [
      { scene: 1, imagePath: 'a.png', startTime: 0, endTime: 30 },
      { scene: 2, imagePath: 'b.png', startTime: 30, endTime: 36 },
      { scene: 3, imagePath: 'c.png', startTime: 36, endTime: 45 },
    ];

    expect(pickCoverImage(uneven, 0.35)).toBe('a.png');
  });

  it('says nothing when there is nothing to choose from', () => {
    expect(pickCoverImage([], 0.35)).toBeNull();
  });
});
