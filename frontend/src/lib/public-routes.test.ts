import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { fillMetadataSegment } from "next/dist/lib/metadata/get-metadata-route";
import { normalizeAppPath } from "next/dist/shared/lib/router/utils/app-paths";
import { isPublic } from "./public-routes";

const APP_DIR = join(__dirname, "..", "app");

/** A code-rendered social card: served at an extensionless URL. */
const CARD_FILE = /^(?:opengraph|twitter)-image\d?\.(?:tsx|ts|jsx|js)$/;

/** Every social-card route module under `src/app`, with its app-dir segment. */
function socialCardModules(): { segment: string; file: string }[] {
  const found: { segment: string; file: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (CARD_FILE.test(entry.name)) {
        const rel = relative(APP_DIR, dir).split(sep).join("/");
        found.push({ segment: `/${rel}`, file: entry.name });
      }
    }
  };
  walk(APP_DIR);
  return found;
}

/** The URL Next serves a card module at, named by Next's own function. */
function servedUrl({ segment, file }: { segment: string; file: string }) {
  return fillMetadataSegment(segment, {}, file.replace(/\.\w+$/, ""));
}

describe("isPublic — social-card routes", () => {
  it("finds the four cards this app ships, at the URLs Next serves them", () => {
    const urls = socialCardModules().map(servedUrl).sort();

    expect(urls).toEqual([
      "/opengraph-image",
      "/opengraph-image-pwu6ef",
      "/twitter-image",
      "/twitter-image-pwu6ef",
    ]);
  });

  it("makes every card exactly as reachable as the pages it describes", () => {
    // A link-preview crawler carries no auth cookie. A card under a public
    // tree must answer it, or the preview renders with no image.
    const cards = socialCardModules();
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const pagesPath = normalizeAppPath(card.segment) || "/";
      expect(
        { card: servedUrl(card), public: isPublic(servedUrl(card)) },
        `${card.segment}/${card.file}`
      ).toEqual({ card: servedUrl(card), public: isPublic(pagesPath) });
    }
  });

  it.each([
    "/opengraph-image",
    "/twitter-image",
    "/opengraph-image-pwu6ef",
    "/twitter-image-pwu6ef",
    "/opengraph-image2",
  ])("treats %s as public", (path) => {
    expect(isPublic(path)).toBe(true);
  });

  it.each([
    "/opengraph-images",
    "/opengraph-image/extra",
    "/opengraph-image-pwu6ef/extra",
    "/opengraph-image-toolong7",
    "/opengraph-image-PWU6EF",
    "/build/opengraph-image",
    "/xopengraph-image",
  ])("does not let the card pattern open %s", (path) => {
    expect(isPublic(path)).toBe(false);
  });
});
