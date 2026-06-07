/**
 * pageMap.test.ts
 *
 * Regression tests for the co-pilot planner<->executor page-id grounding.
 *
 * Live prod E2E ("go to the workflows page"): the runner planner emitted
 * `target: "page-gui-automation"` — a RUNNER `page-…`-prefixed id leaked from
 * the runner's hardcoded fallback page list — even though the web advertised
 * its own un-prefixed id `gui-automation`. The executor's `pageIdToUrl` only
 * knew web ids, so it dead-ended with `unknown page id "page-gui-automation"`
 * and the page never navigated.
 *
 * These tests pin two contracts:
 *   1. `copilotPages` (the list sent to the planner as `pages`) is reliably
 *      NON-EMPTY and includes the workflow page(s) with resolvable web ids — so
 *      the runner grounds on web ids instead of falling back to runner ids.
 *   2. `pageIdToUrl` resolves both the real web id AND a leaked runner id (via
 *      the prefix-strip + alias fallback), so a stray `page-…` id still
 *      navigates instead of failing.
 */

import { describe, expect, it } from "vitest";
import { copilotPages, pageMap, pageIdToUrl } from "./pageMap";

describe("copilotPages (the planner's `pages` list)", () => {
  it("is non-empty so the runner planner grounds on web ids (never falls back)", () => {
    // An empty list is exactly what makes the runner planner use its hardcoded
    // `page-…` fallback ids — the root cause of the live failure.
    expect(copilotPages.length).toBeGreaterThan(0);
  });

  it("every page carries a non-empty id and description", () => {
    for (const page of copilotPages) {
      expect(typeof page.id).toBe("string");
      expect(page.id.length).toBeGreaterThan(0);
      expect(typeof page.description).toBe("string");
      expect(page.description.length).toBeGreaterThan(0);
    }
  });

  it("every advertised page id resolves to a route (planner ids are resolvable by construction)", () => {
    for (const page of copilotPages) {
      expect(pageIdToUrl(page.id)).toBeDefined();
    }
  });

  it("includes a workflows page (the live-E2E target)", () => {
    const ids = copilotPages.map((p) => p.id);
    // `gui-automation` (Execute / "Run and schedule workflows", /execute) is the
    // page the planner targeted for "go to the workflows page".
    expect(ids).toContain("gui-automation");
    // `unified-workflow-builder` is the authoring surface labelled "Workflows"
    // (/build/workflows).
    expect(ids).toContain("unified-workflow-builder");
  });
});

describe("copilotPages — Workflows/Execute disambiguation (planner routing)", () => {
  function descFor(id: string): string {
    const page = copilotPages.find((p) => p.id === id);
    expect(page, `expected a copilot page with id "${id}"`).toBeDefined();
    return page!.description;
  }

  it("describes the workflow-builder page (/build/workflows) as the 'workflows page'", () => {
    // This is the page users (and the planner) mean by "the workflows page".
    // Its description must say so unambiguously so "go to the workflows page"
    // routes here, not to /execute.
    const desc = descFor("unified-workflow-builder").toLowerCase();
    expect(desc).toContain("workflows page");
    expect(pageIdToUrl("unified-workflow-builder")).toBe("/build/workflows");
  });

  it("describes the execute page (/execute) as Execute / run & schedule — NOT 'the workflows page'", () => {
    const desc = descFor("gui-automation").toLowerCase();
    expect(desc).toContain("execute");
    // It runs workflows but must NOT be advertised as "the workflows page" — that
    // is exactly the ambiguity that mis-routed "go to the workflows page".
    expect(desc).not.toContain("workflows page");
    expect(pageIdToUrl("gui-automation")).toBe("/execute");
  });
});

describe("pageIdToUrl — web ids (happy path)", () => {
  it("resolves the workflow-run page id to its route", () => {
    expect(pageIdToUrl("gui-automation")).toBe("/execute");
  });

  it("resolves the workflow-builder page id to /build/workflows", () => {
    expect(pageIdToUrl("unified-workflow-builder")).toBe("/build/workflows");
  });

  it("returns undefined for a genuinely unknown id", () => {
    expect(pageIdToUrl("totally-not-a-page")).toBeUndefined();
  });
});

describe("pageIdToUrl — runner-id leakage fallback", () => {
  it("resolves the leaked runner id `page-gui-automation` to the workflow route", () => {
    // This is the exact id from the live failure. It must resolve (via alias /
    // prefix-strip) to the same route as the web id `gui-automation`.
    expect(pageIdToUrl("page-gui-automation")).toBe("/execute");
    expect(pageIdToUrl("page-gui-automation")).toBe(pageIdToUrl("gui-automation"));
  });

  it("resolves a `page-`-prefixed web id via prefix-strip", () => {
    // `page-library` -> strip -> `library` -> /library.
    expect(pageIdToUrl("page-library")).toBe(pageIdToUrl("library"));
    expect(pageIdToUrl("page-library")).toBeDefined();
  });

  it("resolves the workflow-builder runner id to /build/workflows", () => {
    expect(pageIdToUrl("page-unified-workflow-builder")).toBe("/build/workflows");
  });

  it("resolves an explicit alias whose runner name differs from the web id", () => {
    // `page-memory-search` (runner) -> `memory` (web).
    expect(pageIdToUrl("page-memory-search")).toBe(pageIdToUrl("memory"));
    expect(pageIdToUrl("page-memory-search")).toBeDefined();
  });

  it("resolves a runner settings sub-page to the web settings route", () => {
    expect(pageIdToUrl("page-settings-ai")).toBe(pageIdToUrl("settings"));
    expect(pageIdToUrl("page-settings-ai")).toBeDefined();
  });

  it("still returns undefined for a `page-`-prefixed id with no web equivalent", () => {
    expect(pageIdToUrl("page-this-does-not-exist")).toBeUndefined();
  });
});

describe("pageMap invariants", () => {
  it("never advertises the co-pilot's own route as a target", () => {
    expect(Object.values(pageMap)).not.toContain("/co-pilot");
  });
});
