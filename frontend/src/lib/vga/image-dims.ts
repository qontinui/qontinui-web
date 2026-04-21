/**
 * Read PNG dimensions from a base64 payload by reading the IHDR chunk.
 *
 * The caller only passes the image's base64 (or a data URL); we need the
 * real width/height so `normX`/`normY` can be converted to pixels server-
 * side without round-tripping to the client.
 *
 * Supports PNG (IHDR at offset 16) and JPEG (SOF0/SOF2 markers). Returns
 * `null` for unsupported formats — callers should fall back to returning
 * normalized coords only.
 */

export interface ImageDims {
  width: number;
  height: number;
  format: "png" | "jpeg";
}

export function readImageDims(imageBase64: string): ImageDims | null {
  // Strip data URL prefix if present
  const commaIdx = imageBase64.indexOf(",");
  const raw = commaIdx >= 0 ? imageBase64.slice(commaIdx + 1) : imageBase64;

  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A, then IHDR at offset 16
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height, format: "png" };
  }

  // JPEG: FF D8, then walk markers until SOF0 (C0) / SOF2 (C2)
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === undefined) break;
      // SOFn markers: C0, C1, C2, C3 (baseline/progressive)
      if (marker >= 0xc0 && marker <= 0xc3) {
        const height = buf.readUInt16BE(i + 5);
        const width = buf.readUInt16BE(i + 7);
        return { width, height, format: "jpeg" };
      }
      // Skip segment: next 2 bytes = length (including length itself)
      const segLen = buf.readUInt16BE(i + 2);
      i += 2 + segLen;
    }
  }

  return null;
}
