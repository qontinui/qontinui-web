/**
 * Theme-token integrity guard.
 *
 * A Tailwind color utility that names a token the loaded theme does not
 * define emits NO rule at all — the element silently keeps whatever color it
 * inherited. There is no build error, no lint error, and nothing looks wrong
 * until someone reads a banner and finds the text the same color as its
 * fill.
 *
 * That is exactly how the red-main outage banner shipped unreadable: it used
 * `text-destructive-foreground`, but `globals.css` (the stylesheet every app
 * route loads) defines `--destructive` and NOT `--destructive-foreground`.
 * The app's design system deliberately dropped that token — shadcn's own
 * Badge/Button destructive variants hardcode `text-white` — so the class was
 * dead on arrival. The one place the token DID exist, the marketing theme,
 * had it set to the same value as `--destructive`: red on red.
 *
 * So this asserts the invariant rather than the incident: every
 * `{text,bg,border,ring}-<token>` class an app component uses must name a
 * color the app theme actually maps in its `@theme` block.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const GLOBALS_CSS = join(SRC, "app", "globals.css");

/** Color tokens the APP theme maps (`--color-<name>: …` inside `@theme`). */
function appThemeColorTokens(): Set<string> {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const theme = css.slice(css.indexOf("@theme"), css.indexOf("\n}", css.indexOf("@theme")));
  return new Set(
    [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1])
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Semantic tokens only. Tailwind's own palette (`red-500`, `white`, …) and
 * arbitrary/opacity syntax are not theme tokens and are always valid, so the
 * matcher is restricted to the shadcn-style `<name>-foreground` family plus
 * the bare semantic names — the ones that come from `@theme` and can go
 * missing.
 */
const SEMANTIC_CLASS =
  /\b(?:text|bg|border|ring|fill|stroke|from|to|via)-((?:[a-z]+-)*[a-z]+-foreground|destructive|primary|secondary|muted|accent|card|popover|sidebar)(?:\/\d+)?\b/g;

/**
 * Drop comments before scanning. Prose that NAMES a dead token (the comments
 * explaining this very bug) is not a usage of it. `(?<!:)` keeps `https://`
 * from being read as a line comment.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

describe("theme tokens", () => {
  const defined = appThemeColorTokens();

  it("globals.css maps the semantic colors its components rely on", () => {
    // Sanity check that the extraction works at all — if this regresses to an
    // empty set the whole suite would vacuously pass.
    expect(defined.has("destructive")).toBe(true);
    expect(defined.has("foreground")).toBe(true);
    expect(defined.size).toBeGreaterThan(10);
  });

  it("no app component uses a semantic color token the theme does not define", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      // The marketing route group loads its own theme (marketing.css), which
      // maps a different token set.
      if (file.includes("(marketing)")) continue;
      const text = stripComments(readFileSync(file, "utf8"));
      for (const [cls, token] of text.matchAll(SEMANTIC_CLASS)) {
        if (!defined.has(token)) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${cls}`);
        }
      }
    }
    // A dead token renders as "no rule emitted" — invisible text, not a
    // build error. Fix by using a token the theme defines (or `text-white`,
    // as the shadcn destructive variants do).
    expect(offenders).toEqual([]);
  });
});
