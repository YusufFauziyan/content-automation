import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { NextResponse } from 'next/server';

import { getRun } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { readImageSize } from '@/lib/server/image-size';
import { MEDIA_ROOT } from '@/lib/server/paths';
import { toReply } from '@/lib/server/reply';
import { looksLikeZip, readZip } from '@/lib/server/zip';

export const dynamic = 'force-dynamic';

/** Extensions written for each detected format. */
const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp' };

interface Candidate {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * Fills every empty scene from one upload.
 *
 * Takes loose image files or a `.zip` of them. Files are matched to scenes in
 * file-name order — first file to the lowest-numbered scene without an image —
 * which is what someone who exported a numbered batch expects. Sorting is
 * numeric, so `shot-3` comes before `shot-11`.
 *
 * Whether a file is an image is decided by its bytes, never by its name or the
 * content type the browser guessed: a `.png` holding JPEG data misleads every
 * tool downstream, including the renderer.
 */
export async function POST(request: Request, ctx: { params: Promise<{ runId: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { runId } = await ctx.params;

  let empty: number[];
  try {
    const run = await getRun(runId);
    empty = run.scenes.filter((scene) => scene.status !== 'ok').map((scene) => scene.scene);
  } catch (error) {
    return toReply(error);
  }

  if (empty.length === 0) {
    return NextResponse.json({ error: 'Every scene already has an image.' }, { status: 409 });
  }

  const form = await request.formData();
  const uploads = form.getAll('file').filter((entry): entry is File => entry instanceof File);

  if (uploads.length === 0) {
    return NextResponse.json({ error: 'Attach images or a .zip to upload.' }, { status: 400 });
  }

  const candidates: Candidate[] = [];

  for (const upload of uploads) {
    const bytes = new Uint8Array(await upload.arrayBuffer());

    if (looksLikeZip(bytes)) {
      try {
        for (const entry of readZip(bytes)) {
          // Archives from macOS carry a `__MACOSX` shadow of every file.
          if (entry.name.startsWith('__MACOSX/') || entry.name.split('/').pop()?.startsWith('.')) {
            continue;
          }
          candidates.push({ name: entry.name, bytes: entry.bytes });
        }
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'That archive could not be read.' },
          { status: 422 },
        );
      }
      continue;
    }

    candidates.push({ name: upload.name, bytes });
  }

  // Only things that really are images, in the order their names imply.
  const images = candidates
    .map((candidate) => ({ ...candidate, size: readImageSize(candidate.bytes) }))
    .filter((candidate) => candidate.size !== null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const rejected = candidates.length - images.length;

  if (images.length === 0) {
    return NextResponse.json(
      { error: 'None of those files are readable images.', rejected },
      { status: 422 },
    );
  }

  const directory = join(MEDIA_ROOT, 'workflows', runId, 'images');
  await mkdir(directory, { recursive: true });
  const present = await readdir(directory).catch(() => [] as string[]);

  const placed: { scene: number; name: string; width: number; height: number }[] = [];

  for (const [index, image] of images.entries()) {
    const scene = empty[index];
    if (scene === undefined) break;

    // One file per scene: a JPEG replaced by a PNG must not leave both behind,
    // or whichever the directory lists first wins and the upload looks ignored.
    const stem = `scene-${String(scene).padStart(3, '0')}.`;
    await Promise.all(
      present
        .filter((name) => name.startsWith(stem))
        .map((name) => rm(join(directory, name), { force: true })),
    );

    const mime = detectMime(image.bytes);
    const fileName = `${stem}${EXTENSION[mime] ?? 'jpg'}`;
    await writeFile(join(directory, fileName), image.bytes);

    placed.push({
      scene,
      name: image.name,
      width: image.size?.width ?? 0,
      height: image.size?.height ?? 0,
    });
  }

  const leftOver = Math.max(0, images.length - placed.length);

  return NextResponse.json({
    placed,
    filled: placed.length,
    remaining: Math.max(0, empty.length - placed.length),
    rejected,
    leftOver,
  });
}

/** Format read from the bytes, so the extension written is never a guess. */
function detectMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return 'image/jpeg';
}

/** Present so the route file has a stable shape; unused paths return 405. */
export function GET() {
  return NextResponse.json({ error: 'Use POST to upload.' }, { status: 405 });
}
