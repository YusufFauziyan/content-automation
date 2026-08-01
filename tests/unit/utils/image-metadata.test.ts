import { describe, expect, it } from 'vitest';

import { describeImage } from '../../../src/utils/image/image-metadata.js';

/** Minimal PNG: signature plus the IHDR chunk that carries the dimensions. */
const png = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);

  return bytes;
};

/**
 * Minimal JPEG: SOI, a padding segment, then a frame header.
 *
 * The padding segment is the point — a reader that assumes the frame comes
 * first would pass on a bare file and fail on every real one, which arrive with
 * EXIF and colour profiles in front.
 */
const jpeg = (width: number, height: number, paddingLength = 40): Uint8Array => {
  const padding = new Uint8Array(paddingLength);
  padding[0] = 0xff;
  padding[1] = 0xe0;
  padding[2] = 0x00;
  padding[3] = paddingLength - 2;

  const frame = new Uint8Array(11);
  frame[0] = 0xff;
  frame[1] = 0xc0;
  frame[2] = 0x00;
  frame[3] = 0x11;
  frame[4] = 0x08;
  const view = new DataView(frame.buffer);
  view.setUint16(5, height);
  view.setUint16(7, width);

  return new Uint8Array([0xff, 0xd8, ...padding, ...frame]);
};

describe('describeImage', () => {
  it('reads a PNG', () => {
    expect(describeImage(png(1024, 1792))).toEqual({
      mimeType: 'image/png',
      extension: 'png',
      width: 1024,
      height: 1792,
    });
  });

  it('reads a JPEG, walking past the segments in front of the frame', () => {
    expect(describeImage(jpeg(1024, 1024))).toEqual({
      mimeType: 'image/jpeg',
      extension: 'jpg',
      width: 1024,
      height: 1024,
    });
  });

  it('reads a JPEG whose preamble is long', () => {
    expect(describeImage(jpeg(720, 1280, 600))?.width).toBe(720);
  });

  it('reads a lossy WebP', () => {
    const bytes = new Uint8Array(40);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
    bytes.set([0x56, 0x50, 0x38, 0x20], 12);
    new DataView(bytes.buffer).setUint16(27, 640, false);
    new DataView(bytes.buffer).setUint16(29, 480, false);

    expect(describeImage(bytes)?.mimeType).toBe('image/webp');
  });

  it('does not mistake arbitrary bytes for an image', () => {
    expect(describeImage(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  });

  it('does not mistake text for an image', () => {
    expect(describeImage(new TextEncoder().encode('<!DOCTYPE html><html>'))).toBeNull();
  });

  it('rejects a truncated PNG rather than reporting zero dimensions', () => {
    expect(
      describeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBeNull();
  });
});
