import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { colors } from "@qontinui/design-tokens";
import { cardRoutes } from "@/test/social-card-routes";
import {
  renderSocialCard,
  SOCIAL_CARD_CONTENT_TYPE,
  SOCIAL_CARD_INPUT_FILES,
  SOCIAL_CARD_SIZE,
} from "./social-card";

const FRONTEND = join(__dirname, "..", "..", "..");
const APP_DIR = join(FRONTEND, "src", "app");
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
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

/** The card routes under `appDir` whose `card-inputs` line is not `digest`. */
function staleCardRoutes(appDir: string, digest: string) {
  return cardRoutes(appDir)
    .map(({ path }) => ({
      route: relative(appDir, path),
      cardInputs: CARD_INPUTS_LINE.exec(readFileSync(path, "utf8"))?.[1],
    }))
    .filter(({ cardInputs }) => cardInputs !== digest)
    .sort((a, b) => a.route.localeCompare(b.route));
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
    expect(cardRoutes(APP_DIR).length).toBeGreaterThan(0);
    expect(
      staleCardRoutes(APP_DIR, digest),
      `set each listed route's \`// card-inputs:\` line to ${digest}`
    ).toEqual([]);
  });

  // Next serves a card from a .tsx, .ts, .jsx or .js module alike, so a card
  // in any of them must be held to the digest.
  it("holds a card route in every extension Next serves to the digest", () => {
    const app = mkdtempSync(join(tmpdir(), "card-routes-"));
    try {
      const card = (rel: string, digest: string) => {
        mkdirSync(join(app, rel, ".."), { recursive: true });
        writeFileSync(join(app, rel), `// card-inputs: ${digest}\n`);
      };
      card("opengraph-image.tsx", "aaaaaaaaaaaaaaaa");
      card("(marketing)/twitter-image.ts", "0000000000000000");
      card("a/opengraph-image2.jsx", "0000000000000000");
      card("b/twitter-image.js", "aaaaaaaaaaaaaaaa");
      card("c/opengraph-image.md", "0000000000000000"); // not a route module

      expect(staleCardRoutes(app, "aaaaaaaaaaaaaaaa")).toEqual([
        {
          route: join("(marketing)", "twitter-image.ts"),
          cardInputs: "0000000000000000",
        },
        {
          route: join("a", "opengraph-image2.jsx"),
          cardInputs: "0000000000000000",
        },
      ]);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });
});
