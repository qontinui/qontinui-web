import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { colors } from "@qontinui/design-tokens";
import {
  renderSocialCard,
  SOCIAL_CARD_CONTENT_TYPE,
  SOCIAL_CARD_INPUT_FILES,
  SOCIAL_CARD_SIZE,
} from "./social-card";

const FRONTEND = join(__dirname, "..", "..", "..");
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CARD_ROUTE = /^(?:opengraph|twitter)-image\d?\.tsx$/;
const CARD_INPUTS_LINE = /^\/\/ card-inputs: (\w+)\r?$/m;

/** Width and height from the PNG's IHDR chunk: what the file really is. */
function pngDimensions(bytes: Uint8Array) {
  expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(new TextDecoder().decode(bytes.subarray(12, 16))).toBe("IHDR");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** What the card is drawn from; a change to any of it changes the card. */
function cardInputsDigest(): string {
  const hash = createHash("sha256");
  const source = readFileSync(join(__dirname, "social-card.tsx"), "utf8");
  // Whitespace runs collapse: a reformat is not a new look (and CRLF is LF).
  hash.update(source.replace(/\s+/g, " "));
  for (const file of SOCIAL_CARD_INPUT_FILES) {
    hash.update(readFileSync(join(FRONTEND, file)));
  }
  hash.update(JSON.stringify(colors));
  return hash.digest("hex").slice(0, 16);
}

/** Every card route file under `src/app`. */
function cardRoutes(dir = join(FRONTEND, "src", "app")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return cardRoutes(full);
    return CARD_ROUTE.test(entry.name) ? [full] : [];
  });
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

  // Next names a card route `…?<hash of the route file's source>`. A new
  // look must therefore change every route file, or previews cached by URL
  // keep the old card. See "Cache-busting" in social-card.tsx.
  it("names every card route after the card's current inputs", () => {
    const digest = cardInputsDigest();
    const routes = cardRoutes();
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const line = CARD_INPUTS_LINE.exec(readFileSync(route, "utf8"))?.[1];
      expect(
        { route: relative(FRONTEND, route), cardInputs: line },
        `set the route's \`// card-inputs:\` line to ${digest}`
      ).toEqual({ route: relative(FRONTEND, route), cardInputs: digest });
    }
  });
});
