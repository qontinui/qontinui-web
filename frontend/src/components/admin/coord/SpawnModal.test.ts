/**
 * SpawnModal — `POST /agents/spawn` wire-contract tests.
 *
 * These pin the request body against coord's `SpawnRequest`
 * (`agents_spawn.rs:86-104`), which axum extracts with
 * `Json(req): Json<SpawnRequest>` — strict serde, so any shape mismatch is
 * a hard 422 before the handler runs.
 *
 * Why these exist: this surface had never successfully spawned an agent.
 * It sent `device_id`, a `Vec<String>` for `repos`, and a string
 * `plan_phase` — any one of which is fatal on its own. The failure stayed
 * invisible because `SpawnRequest` sets no `deny_unknown_fields`, so
 * `device_id` was silently IGNORED rather than rejected, leaving the
 * REQUIRED `target_device_id` simply absent.
 *
 * So the assertions below are deliberately weighted toward NEGATIVES —
 * "does not send the wrong key/shape" is what would have caught it, and a
 * prose comment saying "do not simplify this back" does not fail CI.
 */

import { describe, it, expect } from "vitest";
import { buildSpawnRequestBody, parsePlanPhase } from "./SpawnModal";

const base = {
  workUnitSlug: "2026-07-28-coord-post-plan-slug-surfaces-rename",
  phase: "Phase 4",
  deviceId: "00000000-0000-0000-0000-deadbeefcafe",
  repos: ["qontinui-web", "qontinui-coord"],
  intent: "spawn-from-plan",
  declaredOverlapPaths: ["backend/app/api/v1/endpoints/operations.py"],
  initialPrompt: "You are Stage 4a.",
};

describe("parsePlanPhase", () => {
  it("takes the leading integer out of the free-text phase", () => {
    expect(parsePlanPhase("Phase 4")).toBe(4);
    expect(parsePlanPhase("4")).toBe(4);
    expect(parsePlanPhase("Wave 12 — spawn UI")).toBe(12);
    expect(parsePlanPhase("3a")).toBe(3);
  });

  it("returns undefined when the phase carries no digits", () => {
    expect(parsePlanPhase("")).toBeUndefined();
    expect(parsePlanPhase("kickoff")).toBeUndefined();
  });

  it("rejects a value coord's u32 cannot represent", () => {
    // Sending this would 422 the whole spawn — the exact failure mode the
    // parsing exists to prevent — so it degrades to "no phase".
    expect(parsePlanPhase("4294967295")).toBe(4294967295);
    expect(parsePlanPhase("4294967296")).toBeUndefined();
    expect(parsePlanPhase("99999999999999999999")).toBeUndefined();
  });
});

describe("buildSpawnRequestBody", () => {
  it("matches coord's SpawnRequest shape when the spawn is anchored", () => {
    expect(buildSpawnRequestBody(base)).toEqual({
      work_unit_slug: "2026-07-28-coord-post-plan-slug-surfaces-rename",
      plan_phase: 4,
      target_device_id: "00000000-0000-0000-0000-deadbeefcafe",
      repos: [{ repo: "qontinui-web" }, { repo: "qontinui-coord" }],
      intent: "spawn-from-plan",
      declared_overlap_paths: ["backend/app/api/v1/endpoints/operations.py"],
      initial_prompt: "You are Stage 4a.",
    });
  });

  it("omits every anchor key when the spawn is unanchored", () => {
    // The "New session" entry point: a machine, a repo, a prompt — no plan.
    const body = buildSpawnRequestBody({
      deviceId: base.deviceId,
      repos: base.repos,
      initialPrompt: base.initialPrompt,
    });
    // ABSENT, not `""` / `[]`. Coord types all three `Option<…>`, so an
    // empty string deserializes as `Some("")`: `derive_intent` would then
    // synthesize the literal intent `"plan:"` and the empty slug would ride
    // `LaunchPayload` into the runner's session registration, putting a
    // phantom work-unit row on the plans page for a session with no plan.
    expect(body).not.toHaveProperty("work_unit_slug");
    expect(body).not.toHaveProperty("plan_phase");
    expect(body).not.toHaveProperty("intent");
    expect(body).not.toHaveProperty("declared_overlap_paths");
    // The three coord actually requires are still there and nothing else is.
    expect(body).toEqual({
      target_device_id: base.deviceId,
      repos: [{ repo: "qontinui-web" }, { repo: "qontinui-coord" }],
      initial_prompt: "You are Stage 4a.",
    });
  });

  it('omits — never sends `""` for — a whitespace-only slug or intent', () => {
    const body = buildSpawnRequestBody({
      ...base,
      workUnitSlug: "   ",
      intent: "\t\n ",
    });
    expect(body).not.toHaveProperty("work_unit_slug");
    expect(body).not.toHaveProperty("intent");
    // Guard the exact wrong value directly: a trimmed-to-empty string that
    // is still SENT is the phantom-plan bug, not a cosmetic one.
    expect(body.work_unit_slug).toBeUndefined();
    expect(body.intent).toBeUndefined();
  });

  it("omits declared_overlap_paths when no paths were declared", () => {
    const body = buildSpawnRequestBody({ ...base, declaredOverlapPaths: [] });
    // `[]` is a declaration of "I checked, there are none"; absence is
    // "I did not declare". Coord distinguishes them, so we must too.
    expect(body).not.toHaveProperty("declared_overlap_paths");
  });

  it("sends target_device_id, never the silently-ignored device_id", () => {
    const body = buildSpawnRequestBody(base);
    // The original bug: `device_id` is not declared on SpawnRequest and,
    // absent deny_unknown_fields, was dropped rather than rejected —
    // leaving the required field missing and 422ing every spawn.
    expect(body).not.toHaveProperty("device_id");
    expect(body.target_device_id).toBe(base.deviceId);
  });

  it("sends repos as AllocateRepoSpec objects, not bare strings", () => {
    const body = buildSpawnRequestBody(base);
    expect(body.repos).toEqual([
      { repo: "qontinui-web" },
      { repo: "qontinui-coord" },
    ]);
    // Guard the regression directly: a bare string array is the old shape.
    expect(body.repos).not.toEqual(base.repos);
  });

  it("sends plan_phase as a number", () => {
    expect(typeof buildSpawnRequestBody(base).plan_phase).toBe("number");
  });

  it("omits plan_phase entirely when the phase has no digits", () => {
    const body = buildSpawnRequestBody({ ...base, phase: "kickoff" });
    // Omitted, NOT null or "" — the field is Option<u32> with
    // serde(default), so absence is valid while a string is a 422.
    expect(body).not.toHaveProperty("plan_phase");
  });

  it("sends work_unit_slug and never the deprecated plan_slug alias", () => {
    const body = buildSpawnRequestBody(base);
    expect(body.work_unit_slug).toBe(base.workUnitSlug);
    // Coord reads the slug with `#[serde(alias = "plan_slug")]`. An alias
    // is the SAME field, so a body carrying BOTH keys fails with
    // `duplicate field` — sending exactly one is load-bearing, and stays
    // load-bearing until coord drops the alias in Stage 4b.
    expect(body).not.toHaveProperty("plan_slug");
  });

  it("trims the free-text fields", () => {
    const body = buildSpawnRequestBody({
      ...base,
      intent: "  spawn  ",
      initialPrompt: "  go  ",
    });
    expect(body.intent).toBe("spawn");
    expect(body.initial_prompt).toBe("go");
  });
});
