import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import type { ReadableOptions } from 'node:stream';

import { NextResponse } from 'next/server';

import { requireApiSession } from '@/lib/server/guard';
import { MEDIA_ROOT } from '@/lib/server/paths';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.srt': 'text/plain; charset=utf-8',
};

/** Serves generated media, with range support so the video player can seek. */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { path } = await ctx.params;
  const relative = normalize(path.join('/'));

  // Anything that climbs out of the media root is refused outright.
  if (relative.startsWith('..') || relative.includes('\0')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const file = join(MEDIA_ROOT, relative);
  if (!file.startsWith(normalize(MEDIA_ROOT))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.get('range');

  if (range) {
    const [startRaw, endRaw] = range.replace('bytes=', '').split('-');
    const start = Number(startRaw) || 0;
    const end = endRaw ? Number(endRaw) : size - 1;

    return new NextResponse(toWeb(file, { start, end }), {
      status: 206,
      headers: {
        'content-type': type,
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
      },
    });
  }

  return new NextResponse(toWeb(file), {
    headers: {
      'content-type': type,
      'content-length': String(size),
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    },
  });
}

function toWeb(file: string, options?: ReadableOptions & { start?: number; end?: number }) {
  return createReadStream(file, options) as unknown as ReadableStream;
}
