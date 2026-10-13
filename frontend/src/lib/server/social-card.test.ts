import { describe, expect, it } from "vitest";
import {
  renderSocialCard,
  SOCIAL_CARD_CONTENT_TYPE,
  SOCIAL_CARD_SIZE,
} from "./social-card";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from the PNG's IHDR chunk: what the file really is. */
function pngDimensions(bytes: Uint8Array) {
  expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(new TextDecoder().decode(bytes.subarray(12, 16))).toBe("IHDR");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("renderSocialCard", () => {
  // The defect this card replaces: a 152×177 logo declared as 512×512. The
  // size the routes declare in og:image:width/height must be the size the
  // bytes actually have.
  it("renders a PNG whose real dimensions are the declared size", async () => {
    const res = await renderSocialCard();
    const bytes = new Uint8Array(await res.arrayBuffer());

    expect(res.headers.get("content-type")).toBe(SOCIAL_CARD_CONTENT_TYPE);
    expect(pngDimensions(bytes)).toEqual({ ...SOCIAL_CARD_SIZE });
  });
});
