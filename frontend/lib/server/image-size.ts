/**
 * Reads pixel dimensions straight out of an image's bytes.
 *
 * What a file claims in its name or content type is not evidence — a `.png`
 * holding JPEG data misleads every tool downstream, including the renderer.
 * The backend does the same thing for generated stills; this is the frontend's
 * copy for files it accepts before the pipeline has seen them.
 *
 * @returns The size, or null when the bytes are not a readable image.
 */
export function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG: IHDR always sits at byte 16.
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // JPEG: walk the segment markers to the first frame header.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1] ?? 0;
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }

  // WebP, extended form.
  if (bytes.length > 30 && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    if (String.fromCharCode(...bytes.slice(12, 16)) === 'VP8X') {
      const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
      const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
      return { width, height };
    }
  }

  return null;
}
