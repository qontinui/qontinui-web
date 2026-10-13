import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { fillMetadataSegment } from "next/dist/lib/metadata/get-metadata-route";
import { normalizeAppPath } from "next/dist/shared/lib/router/utils/app-paths";
import {
  CARD_ROUTE_FILE,
  cardRoutes,
  type CardRoute,
} from "@/test/social-card-routes";
import { isPublic, SOCIAL_CARD_PATHS } from "./public-routes";

const APP_DIR = join(__dirname, "..", "app");
const PAGE_FILE = /^page\.(?:tsx|ts|jsx|js|mdx)$/;

const segmentOf = (dir: string) =>
  `/${relative(APP_DIR, dir).split(sep).join("/")}`;

/** Every social-card route module under `src/app`. */
const socialCardModules = () => cardRoutes(APP_DIR);

/** The URL Next serves a card module at, named by Next's own function. */
function servedUrl({ segment, file }: CardRoute) {
  return fillMetadataSegment(segment, {}, file.replace(/\.\w+$/, ""));
}

/**
 * The pages a card describes: every page under its segment, except in a
 * subtree that ships its own card of the same kind (that card describes
 * those pages instead). Private `_folders` hold no routes.
 */
function describedPages(card: CardRoute): string[] {
  const pages: string[] = [];
  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    const ownCard = entries.some(
      (e) => e.isFile() && CARD_ROUTE_FILE.exec(e.name)?.[1] === card.kind
    );
    if (dir !== card.dir && ownCard) return;
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith("_")) {
        walk(join(dir, entry.name));
      } else if (entry.isFile() && PAGE_FILE.test(entry.name)) {
        pages.push(normalizeAppPath(`${segmentOf(dir)}/page`));
      }
    }
  };
  walk(card.dir);
  return pages;
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

  it("admits a card exactly when a page it describes is public", () => {
    // A link-preview crawler carries no auth cookie. A card describing a
    // public page must answer it, or that page's preview has no image; a card
    // describing only gated pages must stay gated.
    const cards = socialCardModules();
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const pages = describedPages(card);
      const url = servedUrl(card);
      expect(
        pages.length,
        `${card.segment}/${card.file} describes no page`
      ).toBeGreaterThan(0);
      expect(
        { card: url, public: isPublic(url) },
        `${card.segment}/${card.file} describes ${pages.length} page(s), public: ${pages.filter(isPublic).slice(0, 5).join(", ") || "none"}`
      ).toEqual({ card: url, public: pages.some(isPublic) });
    }
  });

  it("lists no card path that is not a served card describing a public page", () => {
    const served = socialCardModules()
      .filter((card) => describedPages(card).some(isPublic))
      .map(servedUrl)
      .sort();

    expect([...SOCIAL_CARD_PATHS].sort()).toEqual(served);
  });

  it.each([
    "/opengraph-image",
    "/twitter-image",
    "/opengraph-image-pwu6ef",
    "/twitter-image-pwu6ef",
  ])("treats %s as public", (path) => {
    expect(isPublic(path)).toBe(true);
  });

  it.each([
    "/opengraph-images",
    "/opengraph-image/extra",
    "/opengraph-image-pwu6ef/extra",
    "/opengraph-image-toolong7",
    "/opengraph-image-PWU6EF",
    "/opengraph-image2",
    "/build/opengraph-image",
    "/xopengraph-image",
    // The card an `(app)` route group would be served at, and a numbered
    // variant with a made-up group hash: neither is a served public card.
    "/opengraph-image-xg4ifa",
    "/twitter-image9-zzzzzz",
  ])("keeps %s gated", (path) => {
    expect(isPublic(path)).toBe(false);
  });
});
