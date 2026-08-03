/**
 * SpawnModal — `POST /agents/spawn` wire-contract tests.
 *
 * These pin the body against coord's `SpawnRequest` (`agents_spawn.rs`),
 * which is extracted with `Json(req): Json<SpawnRequest>` — strict serde,
 * so any shape mismatch is a hard 422 before the handler runs.
 *
 * This surface had never worked before plan
 * `2026-07-28-coord-post-plan-slug-surfaces-rename` Stage 4a: it sent
 * `device_id`, a `Vec<String>` for `repos`, and a string `plan_phase`. The
 * failure was invisible precisely because `SpawnRequest` sets no
 * `deny_unknown_fields` — `device_id` was ignored rather than rejected, so
 * the required `target_device_id` was simply missing. Hence the negative
 * assertions below: they are the ones that would have caught it.
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
  it("pulls the first integer out of the free-text phase", () => {
    expect(parsePlanPhase("Phase 4")).toBe(4);
    expect(parsePlanPhase("4")).toBe(4);
    expect(parsePlanPhase("Wave 12 — spawn UI")).toBe(12);
    expect(parsePlanPhase("3a")).toBe(3);
  });

  it("returns undefined when the phase carries no integer", () => {
    expect(parsePlanPhase("")).toBeUndefined();
    expect(parsePlanPhase("kickoff")).toBeUndefined();
  });

  it("rejects a number coord's u32 cannot represent", () => {
    // Sending this would 422 the whole spawn — the exact failure mode
    // this parsing exists to avoid — so it degrades to "no phase".
    expect(parsePlanPhase("4294967295")).toBe(4294967295);
    expect(parsePlanPhase("4294967296")).toBeUndefined();
    expect(parsePlanPhase("99999999999999999999")).toBeUndefined();
  });
});

describe("buildSpawnRequestBody", () => {
  it("matches coord's SpawnRequest shape", () => {
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

  it("sends target_device_id, never the ignored device_id key", () => {
    const body = buildSpawnRequestBody(base);
    // `device_id` is not declared on SpawnRequest and would be silently
    // dropped, leaving the required field absent — a 422 on every spawn.
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

  it("omits plan_phase entirely when the phase has no integer", () => {
    const body = buildSpawnRequestBody({ ...base, phase: "kickoff" });
    // Omitted, NOT null/"" — the field is Option<u32> with serde(default),
    // so absence is valid while a string is a 422.
    expect(body).not.toHaveProperty("plan_phase");
  });

  it("sends work_unit_slug and never the deprecated plan_slug alias", () => {
    const body = buildSpawnRequestBody(base);
    expect(body.work_unit_slug).toBe(base.workUnitSlug);
    // Coord reads the slug with `#[serde(alias = "plan_slug")]`. An alias is
    // the SAME field, so a body carrying BOTH keys fails with
    // `duplicate field` — sending exactly one is load-bearing.
    expect(body).not.toHaveProperty("plan_slug");
  });

  it("trims free-text fields", () => {
    const body = buildSpawnRequestBody({
      ...base,
      intent: "  spawn  ",
      initialPrompt: "  go  ",
    });
    expect(body.intent).toBe("spawn");
    expect(body.initial_prompt).toBe("go");
  });
});
