import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * Reads the files out of a ZIP archive.
 *
 * Written here rather than pulled in as a dependency: the format needed is two
 * record layouts and one call to `inflateRaw`, which Node already has. A
 * library would be more code to audit than this is to read.
 *
 * Only the two compression methods that exist in practice are supported —
 * stored and deflate. Anything else is skipped rather than guessed at, and the
 * caller sees a shorter list rather than corrupt bytes.
 */

/** End of central directory record. Marks where the file index lives. */
const EOCD_SIGNATURE = 0x06054b50;
/** One entry in that index. */
const CENTRAL_SIGNATURE = 0x02014b50;

const STORED = 0;
const DEFLATED = 8;

/** The EOCD sits at the end, after a comment of at most 64 KB. */
const MAX_COMMENT = 0xffff;

/** Refuses to expand more than this, so a zip bomb cannot exhaust memory. */
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_ENTRIES = 200;

export function readZip(archive: Uint8Array): ZipEntry[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const eocd = findEndRecord(view, archive.length);

  if (eocd === null) {
    throw new Error('That file is not a ZIP archive, or its index is damaged.');
  }

  const count = Math.min(view.getUint16(eocd + 10, true), MAX_ENTRIES);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  let expanded = 0;

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > archive.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) break;

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);

    const name = new TextDecoder().decode(archive.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    // Directories are entries too; they simply hold nothing.
    if (name.endsWith('/') || uncompressedSize === 0) continue;
    if (method !== STORED && method !== DEFLATED) continue;

    expanded += uncompressedSize;
    if (expanded > MAX_TOTAL_BYTES) {
      throw new Error('That archive expands to more than 200 MB.');
    }

    const data = readLocalData(archive, view, localOffset, compressedSize);
    if (data === null) continue;

    entries.push({
      name,
      bytes: method === DEFLATED ? new Uint8Array(inflateRawSync(data)) : data,
    });
  }

  return entries;
}

/**
 * The local header repeats the name and extra fields, and its own lengths are
 * the only reliable way to find where the compressed bytes begin — the central
 * directory's copies can differ.
 */
function readLocalData(
  archive: Uint8Array,
  view: DataView,
  localOffset: number,
  compressedSize: number,
): Uint8Array | null {
  if (localOffset + 30 > archive.length) return null;

  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLength + extraLength;

  if (start + compressedSize > archive.length) return null;

  return archive.subarray(start, start + compressedSize);
}

/** Scans backwards for the end record, past any trailing comment. */
function findEndRecord(view: DataView, length: number): number | null {
  const earliest = Math.max(0, length - MAX_COMMENT - 22);

  for (let offset = length - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }

  return null;
}

/** True when the bytes start with a ZIP local header or empty-archive marker. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
