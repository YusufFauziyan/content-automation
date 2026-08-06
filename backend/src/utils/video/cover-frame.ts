/** The part of a plan needed to choose a cover. */
export interface CoverCandidate {
  readonly scene: number;
  readonly imagePath: string;
  readonly startTime: number;
  readonly endTime: number;
}

/**
 * Chooses which still becomes the video's cover.
 *
 * A still, not a frame of the render — which is the whole point. Every frame of
 * the finished video carries a burned-in subtitle across it, and the first one
 * carries the opening caption over a shot the camera has not begun to move
 * across yet. That is what the platforms grab when nobody chooses, and it is
 * why the automatic cover looks like a mistake.
 *
 * The stills are the same images the video is built from, at full resolution,
 * with no caption, no motion blur and no compression. One of them is simply a
 * better picture than anything that can be cut out of the result.
 *
 * Which one is a judgement, so it is expressed as a fraction of the way
 * through: far enough in to be past the hook, early enough to still be the
 * subject rather than the sign-off. The scene playing at that moment wins.
 *
 * @param scenes The plan's scenes, in order.
 * @param fraction How far through the video to look, 0–1.
 * @returns The still to use, or null when there are no scenes.
 */
export const pickCoverImage = (
  scenes: readonly CoverCandidate[],
  fraction: number,
): string | null => {
  if (scenes.length === 0) return null;

  const last = scenes[scenes.length - 1];

  if (last === undefined) return null;

  // Clamped rather than trusted: a fraction outside 0–1 would fall off the end
  // of the timeline and quietly select nothing.
  const at = Math.min(Math.max(fraction, 0), 1) * last.endTime;
  const playing = scenes.find((scene) => at >= scene.startTime && at < scene.endTime);

  // Landing exactly on the end — fraction 1, or a plan whose last scene has no
  // duration — finds nothing above. The final scene is the honest answer.
  return (playing ?? last).imagePath;
};
