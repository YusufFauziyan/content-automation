import { join } from 'node:path';

/**
 * Where generated media lives.
 *
 * The backend owns this directory; the frontend only reads from it, and writes
 * into it in exactly one place — a manually supplied scene still, which has to
 * land where a resumed run will look for it.
 */
export const MEDIA_ROOT = process.env.YU_MEDIA_ROOT ?? join(process.cwd(), '..', 'backend', 'output');
