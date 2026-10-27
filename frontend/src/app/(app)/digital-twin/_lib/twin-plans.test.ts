/**
 * The Twin map's plan join (plan `2026-10-23-console-presentation-spaces`
 * Phase 5): a sub-space's plans are its manifest `plan` slug ∪ the work units
 * whose `metadata.area` it maps, and the read they come from is honest about
 * what it did not see.
 */

import { describe, expect, it } from "vitest";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import type { WalkOutcome } from "@/app/(app)/admin/coord/work-units/planWalk";
import { manifest } from "./resolve";
import {
  countByProgress,
  incompleteReason,
  indexWorkUnits,
  isAreaSpelling,
  planProgress,
  planReadOf,
  plansForSubspace,
  plansForSubspaces,
  presentedPlanStatus,
  workUnitArea,
  workUnitHref,
  workUnitRepos,
  type WorkUnitQueryState,
} from "./twin-plans";
import type { SubspaceManifestEntry } from "./types";

function unit(
  slug: string,
  status: string,
  metadata: Record<string, unknown> | null = null,
  authored = "2026-10-01"
): CoordPlanRow {
  return {
    slug,
    title: `Plan ${slug}`,
    status,
    authored_at: `${authored}T00:00:00Z`,
    metadata,
  };
}

function row(id: string): SubspaceManifestEntry {
  const entry = manifest.subspaces.find((s) => s.id === id);
  if (!entry) throw new Error(`no manifest row ${id}`);
  return entry;
}

const query = (over: Partial<WorkUnitQueryState> = {}): WorkUnitQueryState => ({
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  dataUpdatedAt: 0,
  errorUpdatedAt: 0,
  ...over,
});

describe("workUnitArea — coord's one steering key, matched as coord matches it", () => {
  it("reads a kebab-case metadata.area", () => {
    expect(
      workUnitArea(unit("a", "draft", { area: "coord-merge-train" }))
    ).toBe("coord-merge-train");
  });

  it("reads no area from a near-miss key, a spelling no filter matches, or a non-string", () => {
    for (const metadata of [
      null,
      {},
      { Area: "coord-merge-train" },
      { topic: "coord-merge-train" },
      { area: "Coord Merge Train" },
      { area: "coord_merge_train" },
      { area: "" },
      { area: 7 },
    ]) {
      expect(
        workUnitArea(unit("a", "draft", metadata)),
        JSON.stringify(metadata)
      ).toBe(null);
    }
  });

  it("spells areas the way coord's area filter does", () => {
    expect(isAreaSpelling("ui-bridge")).toBe(true);
    expect(isAreaSpelling("ci2-flake")).toBe(true);
    expect(isAreaSpelling("-leading")).toBe(false);
    expect(isAreaSpelling("trailing-")).toBe(false);
    expect(isAreaSpelling("double--dash")).toBe(false);
  });
});

describe("workUnitRepos — every repository a unit names, for redaction", () => {
  it("collects repo, repos and the plan document's repository, once each", () => {
    expect(
      workUnitRepos(
        unit("a", "draft", {
          repo: "qontinui-web",
          repos: ["qontinui-web", "qontinui-coord", 3],
          source_path: "qontinui-dev-notes/plans/a.md",
        })
      )
    ).toEqual(["qontinui-web", "qontinui-coord", "qontinui-dev-notes"]);
    expect(
      workUnitRepos(
        unit("a", "draft", { source_path: "qontinui-dev-notes\\plans\\a.md" })
      )
    ).toEqual(["qontinui-dev-notes"]);
  });

  it("names none for a unit with no metadata", () => {
    expect(workUnitRepos(unit("a", "draft"))).toEqual([]);
  });
});

describe("plansForSubspace", () => {
  const migrations = unit("2026-09-20-migration-drift", "in_progress", {
    area: "database-migrations",
  });
  const otherArea = unit("2026-09-21-unrelated", "in_progress", {
    area: "fleet-health",
  });

  it("resolves plans by area for a sub-space with no explicit plan slug", () => {
    const schema = row("schema");
    expect(schema.plan).toBeFalsy();
    expect(schema.areas).toContain("database-migrations");

    const { plans } = plansForSubspace(
      schema,
      indexWorkUnits([migrations, otherArea], true)
    );
    expect(plans.map((p) => p.slug)).toEqual([migrations.slug]);
    expect(plans[0]!.unit).toBe(migrations);
    expect(plans[0]!.via).toEqual([
      { kind: "area", area: "database-migrations" },
    ]);
  });

  it("resolves the explicit plan slug, with its live unit when one was read", () => {
    const flow = row("flow");
    const named = unit(flow.plan!, "in_progress", { area: "digital-twin" });
    const { plans } = plansForSubspace(flow, indexWorkUnits([named], true));
    expect(plans).toEqual([
      { slug: flow.plan, unit: named, via: [{ kind: "plan" }] },
    ]);
  });

  it("keeps an explicit slug that is not among the units read, with no unit", () => {
    const flow = row("flow");
    const { plans } = plansForSubspace(flow, indexWorkUnits([], true));
    expect(plans).toEqual([
      { slug: flow.plan, unit: null, via: [{ kind: "plan" }] },
    ]);
  });

  it("joins a unit named by slug AND carried by a mapped area once, with both reasons", () => {
    const entry = { plan: "2026-01-01-x", areas: ["ui-bridge"] };
    const both = unit("2026-01-01-x", "draft", { area: "ui-bridge" });
    const { plans } = plansForSubspace(entry, indexWorkUnits([both], true));
    expect(plans).toHaveLength(1);
    expect(plans[0]!.via).toEqual([
      { kind: "plan" },
      { kind: "area", area: "ui-bridge" },
    ]);
  });

  it("names a mapped area no unit carries as drift — on a complete read only", () => {
    const entry = { areas: ["database-migrations", "no-such-area"] };
    expect(
      plansForSubspace(entry, indexWorkUnits([migrations], true)).unmatchedAreas
    ).toEqual(["no-such-area"]);
    // A partial read cannot tell a missing area from an unread page.
    expect(
      plansForSubspace(entry, indexWorkUnits([migrations], false))
        .unmatchedAreas
    ).toBeNull();
  });

  it("indexes the first unit of a repeated slug", () => {
    const first = unit("dup", "draft", { area: "ui-bridge" });
    const second = unit("dup", "shipped", { area: "ui-bridge" });
    const index = indexWorkUnits([first, second], true);
    expect(index.bySlug.get("dup")).toBe(first);
    expect(index.byArea.get("ui-bridge")).toEqual([first]);
  });
});

describe("plansForSubspaces — an aspect's plans", () => {
  it("deduplicates across parts, names the parts each plan moves, and sorts by progress", () => {
    const train = unit("2026-09-01-train", "shipped", {
      area: "coord-merge-train",
    });
    const ci = unit(
      "2026-10-01-ci",
      "in_progress",
      { area: "coord-ci-twin" },
      "2026-10-01"
    );
    const blocked = unit("2026-08-01-blocked", "blocked", {
      area: "coord-merge-train",
    });
    const plans = plansForSubspaces(
      [row("merge_train"), row("train_activity"), row("ci")],
      indexWorkUnits([train, ci, blocked], true)
    );
    expect(plans.map((p) => p.slug)).toEqual([
      ci.slug,
      blocked.slug,
      train.slug,
    ]);
    expect(plans.find((p) => p.slug === train.slug)!.subspaces).toEqual([
      "merge_train",
      "train_activity",
    ]);
    expect(plans.find((p) => p.slug === ci.slug)!.subspaces).toEqual(["ci"]);
  });

  it("orders newest first within a progress class, then by slug", () => {
    const older = unit(
      "b-older",
      "in_progress",
      { area: "ui-bridge" },
      "2026-01-01"
    );
    const newer = unit(
      "a-newer",
      "in_progress",
      { area: "ui-bridge" },
      "2026-05-01"
    );
    const plans = plansForSubspaces(
      [row("dom")],
      indexWorkUnits([older, newer], true)
    );
    expect(plans.map((p) => p.slug)).toEqual(["a-newer", "b-older"]);
  });
});

describe("planProgress", () => {
  it("classes a live status by what it says about the work", () => {
    const cases: Array<[string, string]> = [
      ["in_progress", "in-flight"],
      ["partial", "in-flight"],
      ["blocked", "blocked"],
      ["draft", "queued"],
      ["vetted", "queued"],
      ["ready", "queued"],
      ["shipped", "done"],
      ["superseded", "done"],
      ["obsolete", "done"],
      // Free-text terminal spellings coord accepts and no tag names.
      ["done", "done"],
      ["landed", "done"],
      ["complete", "done"],
      ["", "unknown"],
      ["premise_falsified", "unknown"],
    ];
    for (const [status, progress] of cases) {
      expect(planProgress({ status }), status).toBe(progress);
    }
  });

  it("is unknown for a plan whose unit was not read — never queued", () => {
    expect(planProgress(null)).toBe("unknown");
  });

  it("counts every class, zeros included", () => {
    expect(
      countByProgress([
        { unit: unit("a", "in_progress") },
        { unit: unit("b", "shipped") },
        { unit: null },
      ])
    ).toEqual({ "in-flight": 1, blocked: 0, queued: 0, unknown: 1, done: 1 });
  });
});

describe("presentedPlanStatus — the words presentation mode may show", () => {
  it("keeps a recognised status's word and colour, and drops the free-text phase", () => {
    const row: CoordPlanRow = {
      slug: "a",
      status: "in_progress",
      current_phase: "2 — cut over for Partner A",
    };
    expect(presentedPlanStatus(row)).toEqual({
      kind: "active",
      label: "In progress",
      reason: undefined,
      attention: "none",
    });
  });

  it("says an unrecognised status by its progress class — never verbatim", () => {
    expect(presentedPlanStatus({ status: "waiting-on-partner-a" }).label).toBe(
      "Status unknown"
    );
    expect(presentedPlanStatus({ status: "" }).label).toBe("Status unknown");
    // A free-text terminal spelling coord accepts and no tag names.
    expect(presentedPlanStatus({ status: "landed" }).label).toBe(
      "Shipped or closed"
    );
    // The colour stays the console's reading of an unrecognised status.
    expect(presentedPlanStatus({ status: "waiting-on-partner-a" }).kind).toBe(
      "unknown"
    );
  });
});

describe("workUnitHref", () => {
  it("is the console's work-unit page, slug encoded", () => {
    expect(workUnitHref("2026-10-23-a")).toBe(
      "/admin/coord/work-units/2026-10-23-a"
    );
    expect(workUnitHref("a b/c")).toBe("/admin/coord/work-units/a%20b%2Fc");
  });
});

describe("planReadOf — the read, honest about what it did not see", () => {
  const rows = [unit("a", "in_progress", { area: "ui-bridge" })];
  const complete: WalkOutcome = {
    kind: "complete",
    rows,
    bodySignal: null,
    pages: 1,
  };
  const OPERATOR = { presenting: false };
  const PRESENTING = { presenting: true };
  /** A failed read whose body names a host an evaluator must not see. */
  const LEAKY = new Error(
    "GET /api/v1/operations/plans failed: 502 - upstream https://coord.internal.acme-corp.example:8443 refused the connection"
  );
  const partial: WalkOutcome = {
    kind: "partial",
    rows,
    bodySignal: null,
    pages: 3,
    reason: "error",
    error: "coord.internal.acme-corp.example refused the connection",
  };

  it("is loading before anything answered, and an error with its reason when nothing did", () => {
    expect(planReadOf(query({ isLoading: true }), OPERATOR)).toEqual({
      kind: "loading",
    });
    const read = planReadOf(
      query({ isError: true, error: LEAKY, errorUpdatedAt: 5 }),
      OPERATOR
    );
    expect(read.kind).toBe("error");
    if (read.kind !== "error") return;
    expect(read.reason).not.toBe("");
    expect(read.at).toBe(5);
  });

  it("is UNKNOWN, never still reading, while react-query holds the read with nothing answered", () => {
    // Pending and not fetching (this browser offline): no answer, no
    // failure, no read in flight — "Reading…" would never resolve.
    const held = {
      kind: "error",
      reason:
        "no read of coord's work-unit list has answered, and none is in flight",
      at: null,
    };
    expect(planReadOf(query(), OPERATOR)).toEqual(held);
    // No upstream text is quoted, so presenting words it the same.
    expect(planReadOf(query(), PRESENTING)).toEqual(held);
  });

  it("is ready and complete over a walk that reached the end", () => {
    const read = planReadOf(
      query({ data: complete, dataUpdatedAt: 42 }),
      OPERATOR
    );
    expect(read.kind).toBe("ready");
    if (read.kind !== "ready") return;
    expect(read.index.complete).toBe(true);
    expect(read.incomplete).toBeNull();
    expect(read.units).toBe(1);
    expect(read.asOf).toBe(42);
    expect(read.refreshError).toBeNull();
  });

  it("says why a partial or truncated read is not the whole list", () => {
    const read = planReadOf(query({ data: partial }), OPERATOR);
    expect(read.kind === "ready" && read.index.complete).toBe(false);
    // The operator reads the failing page's own sentence.
    expect(read.kind === "ready" && read.incomplete).toBe(
      "coord's work-unit list stopped answering after 3 pages: coord.internal.acme-corp.example refused the connection"
    );
    expect(
      incompleteReason({ ...partial, reason: "page_cap" }, OPERATOR)
    ).toMatch(/bound/);
    expect(
      incompleteReason({ ...partial, reason: "stalled" }, OPERATOR)
    ).toMatch(/repeated/);

    const truncated: WalkOutcome = {
      kind: "single_page",
      rows,
      bodySignal: null,
      order: "authored_desc",
      truncated: true,
      legacyCoord: true,
      total: null,
    };
    expect(incompleteReason(truncated, OPERATOR)).toMatch(/one full page/);
    expect(
      incompleteReason({ ...truncated, truncated: false }, OPERATOR)
    ).toBeNull();
  });

  it("keeps the last good read beside a failed refresh, and says so", () => {
    const read = planReadOf(
      query({
        data: complete,
        isError: true,
        error: new Error("network down"),
      }),
      OPERATOR
    );
    expect(read.kind === "ready" && read.refreshError).toBe("network down");
  });

  it("has no as-of when the query never stamped one", () => {
    const read = planReadOf(
      query({ data: complete, dataUpdatedAt: 0 }),
      OPERATOR
    );
    expect(read.kind === "ready" && read.asOf).toBeNull();
  });

  describe("while presenting, a failure says its HTTP status — never its text", () => {
    it("words a failed read as a fixed phrase and its status", () => {
      const read = planReadOf(
        query({ isError: true, error: LEAKY, errorUpdatedAt: 5 }),
        PRESENTING
      );
      expect(read).toEqual({
        kind: "error",
        reason: "coord's work-unit list answered HTTP 502",
        at: 5,
      });
      const noStatus = planReadOf(
        query({
          isError: true,
          error: new TypeError(
            "coord.internal.acme-corp.example: ECONNREFUSED"
          ),
        }),
        PRESENTING
      );
      expect(noStatus.kind === "error" && noStatus.reason).toBe(
        "coord's work-unit list gave no readable answer"
      );
    });

    it("drops the failing page's sentence from a partial walk's reason", () => {
      const read = planReadOf(query({ data: partial }), PRESENTING);
      expect(read.kind === "ready" && read.incomplete).toBe(
        "coord's work-unit list stopped answering after 3 pages"
      );
      // The reasons that are fixed words already read the same in both modes.
      expect(
        incompleteReason({ ...partial, reason: "page_cap" }, PRESENTING)
      ).toBe(incompleteReason({ ...partial, reason: "page_cap" }, OPERATOR));
    });

    it("words a failed refresh the same way", () => {
      const read = planReadOf(
        query({ data: complete, isError: true, error: LEAKY }),
        PRESENTING
      );
      expect(read.kind === "ready" && read.refreshError).toBe(
        "coord's work-unit list answered HTTP 502"
      );
    });
  });
});

describe("the manifest's areas (manifest 2.2.0)", () => {
  const withAreas = manifest.subspaces.filter((s) => s.areas !== undefined);

  it("declares the version that introduced areas", () => {
    const [major, minor] = manifest.version.split(".").map(Number);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(major! > 2 || (major === 2 && minor! >= 2)).toBe(true);
  });

  it("maps areas on far more rows than the eight that name a plan", () => {
    const named = manifest.subspaces.filter((s) => s.plan).length;
    expect(named).toBe(8);
    expect(withAreas.length).toBeGreaterThanOrEqual(30);
    const covered = manifest.subspaces.filter((s) => s.plan || s.areas).length;
    expect(covered).toBeGreaterThan(named * 4);
  });

  it("spells every area as coord's filter matches it, sorted and once per row", () => {
    for (const s of withAreas) {
      const areas = s.areas!;
      expect(areas.length, s.id).toBeGreaterThan(0);
      for (const area of areas)
        expect(isAreaSpelling(area), `${s.id}: ${area}`).toBe(true);
      expect(new Set(areas).size, s.id).toBe(areas.length);
      expect([...areas].sort(), s.id).toEqual([...areas]);
    }
  });
});
