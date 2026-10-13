/**
 * Social-card route discovery for tests, shared by `public-routes.test.ts`
 * (which cards are public) and `social-card.test.ts` (which carry the card's
 * current `card-inputs` digest), so the two suites can never disagree about
 * what a card route is.
 *
 * Next serves `opengraph-image` / `twitter-image` from a module in any page
 * extension (tsx, ts, jsx, js: `next.config.mjs` sets no `pageExtensions`),
 * optionally numbered (`opengraph-image2.tsx`), at an extensionless URL.
 */
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** A card route module's file name; group 1 is its kind. */
export const CARD_ROUTE_FILE =
  /^((?:opengraph|twitter)-image)\d?\.(?:tsx|ts|jsx|js)$/;

export interface CardRoute {
  /** The module, absolute. */
  path: string;
  /** Its directory, absolute. */
  dir: string;
  /** Its app-dir segment, e.g. `/` or `/(marketing)`. */
  segment: string;
  file: string;
  /** `opengraph-image` or `twitter-image`. */
  kind: string;
}

/** Every social-card route module under `appDir`, at any depth. */
export function cardRoutes(appDir: string): CardRoute[] {
  const found: CardRoute[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const kind = CARD_ROUTE_FILE.exec(entry.name)?.[1];
      if (entry.isDirectory()) walk(path);
      else if (kind) {
        const segment = `/${relative(appDir, dir).split(sep).join("/")}`;
        found.push({ path, dir, segment, file: entry.name, kind });
      }
    }
  };
  walk(appDir);
  return found;
}
