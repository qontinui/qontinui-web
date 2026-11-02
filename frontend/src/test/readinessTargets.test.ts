/**
 * The readiness loader loads a ready route's page module itself (plan
 * `2026-10-23-console-presentation-spaces` D3; `readinessTargets.ts`).
 *
 * The page check tells the page's own component from a stand-in by identity
 * with what the loader loaded. So the loader must load the module ITSELF —
 * `vi.importActual` — even when the proof mocks it: a plain `import()` would
 * hand back the proof's stand-in, and the stand-in would then count as the
 * page. This file mocks a page-shaped module the way a proof could mock its
 * page, and asks the loader for it.
 */

import { join, relative, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ProvidedReadiness } from "./readinessEvidence";
import { loadTargets } from "./readinessTargets";

vi.mock("./fixtures/readinessPage", () => ({
  default: function StandIn() {
    return null;
  },
}));

/** `src/`, resolved from this file. */
const SRC = join(__dirname, "..");
const ROUTE = "/admin/coord/devops";
const PAGE = join(__dirname, "fixtures", "readinessPage.tsx");
/** This file, `src/`-relative, as a ready route names its proof. */
const THIS_PROOF = relative(SRC, __filename).split(sep).join("/");

const provided = (
  pageFile: string | null,
  provenBy = THIS_PROOF
): ProvidedReadiness => ({
  srcDir: SRC,
  targets: [{ route: ROUTE, provenBy, pageFile }],
});

describe("loadTargets", () => {
  it("loads the page module itself, not the stand-in this file mocked into its place", async () => {
    const mocked = (await import("./fixtures/readinessPage")).default;
    const actual = (
      await vi.importActual<{ default: unknown }>("./fixtures/readinessPage")
    ).default;
    // Not vacuous: the mock is in place, and is not the module.
    expect(mocked).not.toBe(actual);
    expect(await loadTargets(provided(PAGE), __filename)).toEqual([
      { route: ROUTE, page: actual },
    ]);
  });

  it("fails the proof when a route's page module does not load", async () => {
    await expect(
      loadTargets(
        provided(join(__dirname, "fixtures", "nowhere.tsx")),
        __filename
      )
    ).rejects.toThrow(
      `presentation readiness: ${ROUTE}'s page module (${join(__dirname, "fixtures", "nowhere.tsx")}) failed to load, so this proof cannot render it`
    );
  });

  it("fails the proof when a route's page module has no default export", async () => {
    const noPage = join(__dirname, "fixtures", "readinessNoPage.ts");
    await expect(loadTargets(provided(noPage), __filename)).rejects.toThrow(
      `presentation readiness: ${ROUTE}'s page module (${noPage}) has no default export to render`
    );
  });

  it("loads nothing for a file that proves no ready route, or a route no page serves", async () => {
    expect(
      await loadTargets(
        provided(PAGE, "app/(app)/admin/coord/page.test.tsx"),
        __filename
      )
    ).toEqual([]);
    expect(await loadTargets(provided(null), __filename)).toEqual([]);
  });
});
