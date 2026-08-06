import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { NextResponse } from 'next/server';

import { getRun } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';
import { readImageSize } from '@/lib/server/image-size';
import { MEDIA_ROOT } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

/** Accepts a still a person picked for a scene the generator could not fill. */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string; scene: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { runId, scene } = await ctx.params;
  const sceneNumber = Number(scene);

  try {
    const run = await getRun(runId);
    if (!run.scenes.some((planned) => planned.scene === sceneNumber)) {
      return NextResponse.json({ error: `This run has no scene ${scene}.` }, { status: 404 });
    }
  } catch (error) {
    return toReply(error);
  }

  const form = await req.formData();
  const file = form.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Attach an image file to upload.' }, { status: 400 });
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json(
      { error: `${file.type || 'That file'} is not an image. Use JPEG, PNG or WebP.` },
      { status: 415 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = readImageSize(bytes);

  if (!dimensions) {
    return NextResponse.json(
      { error: 'That file could not be read as an image. It may be truncated.' },
      { status: 422 },
    );
  }

  // Written where the backend expects a scene still, so a resumed run finds it.
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const fileName = `scene-${String(sceneNumber).padStart(3, '0')}.${extension}`;
  const directory = join(MEDIA_ROOT, 'workflows', runId, 'images');
  await mkdir(directory, { recursive: true });

  // Clear any other file for this scene first. A JPEG replaced by a PNG would
  // otherwise leave both on disk, and whichever the directory listing happened
  // to return first would win — so a replacement silently did nothing.
  const stem = `scene-${String(sceneNumber).padStart(3, '0')}.`;
  const existing = await readdir(directory).catch(() => [] as string[]);

  await Promise.all(
    existing
      .filter((name) => name.startsWith(stem))
      .map((name) => rm(join(directory, name), { force: true })),
  );

  await writeFile(join(directory, fileName), bytes);
  const written = await stat(join(directory, fileName));

  // Nothing is written to the database here. The file is the record until the
  // image step next runs, adopts it and records it as `manual` — which keeps a
  // single writer for `scene_images` and stops this app from inventing rows the
  // pipeline never made.
  return NextResponse.json({
    scene: {
      scene: sceneNumber,
      status: 'ok',
      source: 'manual',
      // The modified time is the cache key: the path never changes, so without
      // it the browser keeps showing the picture it already has.
      imageUrl: `/api/media/workflows/${runId}/images/${fileName}?v=${String(written.mtimeMs)}`,
      ...dimensions,
      byteSize: bytes.byteLength,
    },
  });
}
