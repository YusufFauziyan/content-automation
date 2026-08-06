/**
 * What an image actually is, read from its own bytes.
 *
 * A generation service reports what it was *asked* for; the bytes report what
 * arrived. Those two disagree often enough — a router that ignores the
 * requested size, a model that answers JPEG to a PNG request — that trusting
 * the request would put wrong numbers in the database for the composer and the
 * quality check to rely on later.
 */
export interface ImageMetadata {
  readonly mimeType: string;
  /** File extension without the dot, e.g. `png`. */
  readonly extension: string;
  readonly width: number;
  readonly height: number;
}

/** Reads a big-endian unsigned 16-bit integer. */
const readUint16 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);

/** Reads a big-endian unsigned 32-bit integer. */
const readUint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) << 24) |
  ((bytes[offset + 1] ?? 0) << 16) |
  ((bytes[offset + 2] ?? 0) << 8) |
  ((bytes[offset + 3] ?? 0) >>> 0);

/** True when `bytes` starts with the given signature. */
const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  signature.every((value, index) => bytes[index] === value);

/** `\x89PNG\r\n\x1a\n`, then an IHDR chunk carrying the dimensions. */
const readPng = (bytes: Uint8Array): ImageMetadata | null => {
  if (!startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || bytes.length < 24) {
    return null;
  }

  return {
    mimeType: 'image/png',
    extension: 'png',
    width: readUint32(bytes, 16),
    height: readUint32(bytes, 20),
  };
};

/**
 * `\xFF\xD8`, then a chain of segments; the frame header holds the size.
 *
 * Walking the chain is necessary because JPEG puts EXIF, colour profiles and
 * comments of arbitrary length before the frame.
 */
const readJpeg = (bytes: Uint8Array): ImageMetadata | null => {
  if (!startsWith(bytes, [0xff, 0xd8])) {
    return null;
  }

  let offset = 2;

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1] ?? 0;
    // SOF0..SOF15, excluding the markers that are not frame headers.
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

    if (isFrameHeader) {
      return {
        mimeType: 'image/jpeg',
        extension: 'jpg',
        height: readUint16(bytes, offset + 5),
        width: readUint16(bytes, offset + 7),
      };
    }

    offset += 2 + readUint16(bytes, offset + 2);
  }

  return null;
};

/** `RIFF....WEBP`, then a VP8/VP8L/VP8X chunk. */
const readWebp = (bytes: Uint8Array): ImageMetadata | null => {
  const isRiff = startsWith(bytes, [0x52, 0x49, 0x46, 0x46]);
  const isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;

  if (!isRiff || !isWebp || bytes.length < 30) {
    return null;
  }

  const format = String.fromCharCode(...bytes.slice(12, 16));
  const base = { mimeType: 'image/webp', extension: 'webp' } as const;

  if (format === 'VP8X') {
    return {
      ...base,
      width: 1 + (((bytes[26] ?? 0) << 16) | ((bytes[25] ?? 0) << 8) | (bytes[24] ?? 0)),
      height: 1 + (((bytes[29] ?? 0) << 16) | ((bytes[28] ?? 0) << 8) | (bytes[27] ?? 0)),
    };
  }

  if (format === 'VP8 ') {
    return {
      ...base,
      width: readUint16(bytes, 27) & 0x3fff,
      height: readUint16(bytes, 29) & 0x3fff,
    };
  }

  return null;
};

const READERS = [readPng, readJpeg, readWebp] as const;

/**
 * Identifies an image from its bytes.
 *
 * @returns The real format and dimensions, or `null` when the bytes are not a
 *          recognisable image — which is itself worth knowing, because it means
 *          the generation service returned something unusable.
 */
export const describeImage = (bytes: Uint8Array): ImageMetadata | null => {
  for (const read of READERS) {
    const metadata = read(bytes);

    if (metadata !== null && metadata.width > 0 && metadata.height > 0) {
      return metadata;
    }
  }

  return null;
};
