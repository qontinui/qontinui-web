/**
 * No spawns source mints its own attention colour (style guide §4.1: nothing
 * outside `console/statusRow` may mint a red or an amber). Every amber here is
 * `UNKNOWN_AMBER` or `WAITING_AMBER`, imported — `UnknownNote` for a sentence
 * about what the page could not read — so a hand-typed `text-amber-200` cannot
 * drift from the declared token unnoticed.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = __dirname;

/** Every non-test source file under the spawns route, recursively. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__fixtures__") continue;
      out.push(...sources(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

const ATTENTION_LITERAL = /\b(?:text|bg|border)-(?:amber|red|yellow)-\d/;

describe("spawns sources mint no attention colour of their own", () => {
  it("finds the sources it scans", () => {
    expect(sources(ROOT).length).toBeGreaterThan(10);
  });

  it("spells no amber, red or yellow utility class outside statusRow", () => {
    const offenders = sources(ROOT).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => ATTENTION_LITERAL.test(line))
        .map(({ n, line }) => `${relative(ROOT, file)}:${n}: ${line.trim()}`)
    );
    expect(offenders).toEqual([]);
  });
});
