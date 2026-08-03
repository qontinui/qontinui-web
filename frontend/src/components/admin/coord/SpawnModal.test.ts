/**
 * Wire-shape tests for `POST /agents/spawn`.
 *
 * These pin the body against coord's `SpawnRequest`
 * (`qontinui-coord/src/agents_spawn.rs:86-104`), which axum extracts with
 * `Json(req): Json<SpawnRequest>` — strict serde. A wrong key or a wrong type
 * is a hard 422 *before* any handler logic runs, so there is no partial
 * success and no server-side coercion to fall back on. That is exactly the
 * class of bug #908 fixed, and it had been shipping unnoticed because nothing
 * exercised the body.
 *
 * Plan `2026-07-28-coord-post-plan-slug-surfaces-rename`, Stage 4a follow-up.
 */

import { describe, it, expect } from "vitest";
import { buildSpawnRequestBody, parsePlanPhase } from "./SpawnModal";

const FORM = {
  workUnitSlug: "2026-07-28-some-unit",
  phase: "Phase 4",
  deviceId: "c79a07d5-7e40-49b4-87fa-554c749f9644",
  repos: ["qontinui-coord", "qontinui-web"],
  intent: "an intent",
  overlapPaths: ["qontinui-coord/src/lib.rs"],
  initialPrompt: "the first-tick prompt",
};

describe("parsePlanPhase", () => {
  it("takes the first run of digits out of free text", () => {
    expect(parsePlanPhase("Phase 4")).toBe(4);
    expect(parsePlanPhase("Wave 4 — spawn UI")).toBe(4);
    expect(parsePlanPhase("12")).toBe(12);
  });

  it("returns undefined when there is no number to send", () => {
    // Coord's field is Option<u32>: absent is legal, a string is not.
    expect(parsePlanPhase("kickoff")).toBeUndefined();
    expect(parsePlanPhase("")).toBeUndefined();
  });

  it("returns undefined for a value outside u32", () => {
    // Parses fine in JS, then 422s on coord — the reason the clamp exists.
    expect(parsePlanPhase("99999999999")).toBeUndefined();
  });
});

describe("buildSpawnRequestBody", () => {
  it("sends work_unit_slug", () => {
    expect(buildSpawnRequestBody(FORM).work_unit_slug).toBe(
      "2026-07-28-some-unit"
    );
  });

  it("omits the legacy plan_slug", () => {
    // Serde treats coord's `alias = "plan_slug"` as the SAME field, so a body
    // carrying both spellings is rejected with `duplicate field`. Assert the
    // absence directly rather than trusting the construction site. Stage 4b
    // drops the alias, after which sending `plan_slug` fails outright.
    expect(buildSpawnRequestBody(FORM)).not.toHaveProperty("plan_slug");
  });

  it("sends target_device_id, not device_id", () => {
    const b = buildSpawnRequestBody(FORM);
    // REQUIRED uuid::Uuid with no serde(default) — omitting it is a 422.
    expect(b.target_device_id).toBe("c79a07d5-7e40-49b4-87fa-554c749f9644");
    // Coord has no such field; it was silently dropped on every request.
    expect(b).not.toHaveProperty("device_id");
  });

  it("sends repos as AllocateRepoSpec objects with bare names", () => {
    // `Vec<AllocateRepoSpec>`, not `string[]`; and `agent_worktrees.repo` is
    // the bare name, not the `owner/name` slug `repo_branches.repo` uses.
    expect(buildSpawnRequestBody(FORM).repos).toEqual([
      { repo: "qontinui-coord" },
      { repo: "qontinui-web" },
    ]);
  });

  it("sends plan_phase as a number", () => {
    expect(buildSpawnRequestBody(FORM).plan_phase).toBe(4);
  });

  it("omits plan_phase when the phase carries no number", () => {
    expect(
      buildSpawnRequestBody({ ...FORM, phase: "kickoff" })
    ).not.toHaveProperty("plan_phase");
  });

  it("passes the remaining fields through unchanged", () => {
    const b = buildSpawnRequestBody(FORM);
    expect(b.intent).toBe("an intent");
    expect(b.initial_prompt).toBe("the first-tick prompt");
    expect(b.declared_overlap_paths).toEqual(["qontinui-coord/src/lib.rs"]);
  });
});
