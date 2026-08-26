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
import {
  buildSpawnRequestBody,
  deriveAccountRoster,
  describeSelectionMode,
  filterAccountsForDevice,
  formatUtilization,
  parsePlanPhase,
} from "./SpawnModal";
import type { ClaudeAccountRow } from "./SpawnModal";

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

describe("buildSpawnRequestBody — the account pin", () => {
  it("omits `account` entirely when the operator left the machine to choose", () => {
    // The default. Coord types the field `Option<String>` with
    // `#[serde(default)]`, so ABSENCE is the "no pin" signal that leaves
    // today's `AccountSelectionMode` rotation completely unchanged.
    const body = buildSpawnRequestBody(base);
    expect(body).not.toHaveProperty("account");
    expect(body.account).toBeUndefined();
  });

  it('omits — never sends `""` for — a blank or whitespace-only account', () => {
    // Same hazard as `work_unit_slug`: `""` deserializes as `Some("")`, i.e.
    // a pin on an account no machine has, which the runner must then either
    // reject loudly or silently ignore. Neither is what "let the machine
    // choose" means, so the key does not go on the wire at all.
    for (const account of ["", "   ", "\t\n "]) {
      const body = buildSpawnRequestBody({ ...base, account });
      expect(body).not.toHaveProperty("account");
      expect(body.account).toBeUndefined();
    }
  });

  it("sends the trimmed config-dir basename when an account IS pinned", () => {
    const body = buildSpawnRequestBody({
      ...base,
      account: "  .claude-gmail ",
    });
    expect(body.account).toBe(".claude-gmail");
    // The label is the identity on the wire; a local path must never cross
    // it. This is a contract of the runner's ingest side, and the modal only
    // ever holds labels because that is all the read route serves.
    expect(String(body.account)).not.toContain("/");
    expect(String(body.account)).not.toContain("\\");
  });

  it("carries the account alongside — not instead of — the required fields", () => {
    expect(
      buildSpawnRequestBody({
        deviceId: base.deviceId,
        repos: base.repos,
        initialPrompt: base.initialPrompt,
        account: ".claude-work",
      })
    ).toEqual({
      target_device_id: base.deviceId,
      account: ".claude-work",
      repos: [{ repo: "qontinui-web" }, { repo: "qontinui-coord" }],
      initial_prompt: "You are Stage 4a.",
    });
  });
});

describe("filterAccountsForDevice", () => {
  const rows: ClaudeAccountRow[] = [
    { device_id: "EB2155ED-4152-4A91-BE82-5D4346F717FC", account_label: ".a" },
    { device_id: "00000000-0000-0000-0000-deadbeefcafe", account_label: ".b" },
  ];

  it("matches across both uuid spellings the device guard accepts", () => {
    // `UUID_RE` takes the simple 32-hex form as well as the hyphenated one,
    // so a raw string compare would filter a perfectly valid typed id down
    // to zero rows and render "this machine has no accounts" — a lie.
    expect(
      filterAccountsForDevice(rows, "eb2155ed-4152-4a91-be82-5d4346f717fc").map(
        (a) => a.account_label
      )
    ).toEqual([".a"]);
    expect(
      filterAccountsForDevice(rows, "eb2155ed41524a91be825d4346f717fc").map(
        (a) => a.account_label
      )
    ).toEqual([".a"]);
  });

  it("returns nothing for a blank device", () => {
    expect(filterAccountsForDevice(rows, "   ")).toEqual([]);
  });
});

describe("deriveAccountRoster", () => {
  const ok = {
    loading: false,
    fault: null as string | null,
    tableProvisioned: true as boolean | null | undefined,
    deviceChosen: true,
    tenantRosterSize: 1,
    deviceAccounts: [
      { device_id: "d", account_label: ".claude-gmail" },
    ] as ClaudeAccountRow[],
  };

  it("is `ready` only when coord answered, said the table exists, and a device is picked", () => {
    const state = deriveAccountRoster(ok);
    expect(state.kind).toBe("ready");
    expect(state.kind === "ready" && state.accounts).toHaveLength(1);
  });

  it("reports a fetch failure as a FAULT, never as an empty roster", () => {
    const state = deriveAccountRoster({
      ...ok,
      fault: "claude-accounts returned HTTP 403.",
      deviceAccounts: [],
      tenantRosterSize: 0,
    });
    expect(state.kind).toBe("fault");
    expect(state.message).toMatch(/403/);
    // The distinguishing property: it must not claim there are no accounts.
    expect(state.message).toMatch(/UNKNOWN/i);
  });

  it("treats `table_provisioned: false` and a MISSING flag alike — both unknown", () => {
    for (const tableProvisioned of [false, null, undefined]) {
      const state = deriveAccountRoster({
        ...ok,
        tableProvisioned,
        deviceAccounts: [],
        tenantRosterSize: 0,
      });
      // Never `empty`: an unprovisioned or unreported table has observed
      // nothing, so calling it "no accounts" asserts a fact nobody has.
      expect(state.kind).toBe("unknown");
      expect(state.message).toMatch(/UNKNOWN|unknown/);
    }
    // ...and the two causes are still NAMED differently, because their fixes
    // are different (a coord migration vs. an unversioned coord read route).
    const noTable = deriveAccountRoster({
      ...ok,
      tableProvisioned: false,
      deviceAccounts: [],
      tenantRosterSize: 0,
    });
    const notSaid = deriveAccountRoster({
      ...ok,
      tableProvisioned: null,
      deviceAccounts: [],
      tenantRosterSize: 0,
    });
    expect(noTable.message).not.toBe(notSaid.message);
  });

  it("distinguishes a genuinely empty roster from an unreadable one", () => {
    const empty = deriveAccountRoster({
      ...ok,
      deviceAccounts: [],
      tenantRosterSize: 0,
    });
    expect(empty.kind).toBe("empty");
    expect(empty.message).toMatch(/provisioned/i);
    // "the tenant has rows, this device has none" is a different answer again.
    const otherDevice = deriveAccountRoster({
      ...ok,
      deviceAccounts: [],
      tenantRosterSize: 4,
    });
    expect(otherDevice.kind).toBe("empty");
    expect(otherDevice.message).not.toBe(empty.message);
    expect(otherDevice.message).toMatch(/this device/i);
  });

  it("keeps a roster it actually read even when the provisioning flag is absent", () => {
    // The flag is `#[serde(default)]`-shaped on coord's read route, so a
    // build predating it serves rows with NO flag. Gating `ready` on the
    // flag threw those rows away and then reported the roster as
    // unreadable — a state contradicted by the payload in hand.
    for (const tableProvisioned of [false, null, undefined]) {
      const state = deriveAccountRoster({ ...ok, tableProvisioned });
      expect(state.kind).toBe("ready");
      expect(state.kind === "ready" && state.accounts).toHaveLength(1);
    }
  });

  it("lets tenant-wide rows outrank a flag that denies the table exists", () => {
    // Rows cannot come from a table that is not there, so `false` here is
    // not a licence to report the per-device miss as unknown.
    const state = deriveAccountRoster({
      ...ok,
      tableProvisioned: false,
      tenantRosterSize: 4,
      deviceAccounts: [],
    });
    expect(state.kind).toBe("empty");
    expect(state.message).toMatch(/this device/i);
  });

  it("says a device has to be picked before a per-machine roster means anything", () => {
    const state = deriveAccountRoster({ ...ok, deviceChosen: false });
    expect(state.kind).toBe("no-device");
  });

  it("does not decide anything while the fetch is still in flight", () => {
    expect(deriveAccountRoster({ ...ok, loading: true }).kind).toBe("loading");
  });
});

describe("describeSelectionMode", () => {
  it("names the mode the machine actually reported", () => {
    expect(
      describeSelectionMode(
        [
          {
            device_id: "d",
            account_label: ".a",
            account_selection_mode: "least_usage",
          },
        ],
        true
      )
    ).toEqual({ known: true, text: expect.stringMatching(/least-usage/i) });
    expect(
      describeSelectionMode(
        [
          {
            device_id: "d",
            account_label: ".a",
            account_selection_mode: "manual",
          },
        ],
        true
      ).text
    ).toMatch(/pinned in its own settings/i);
  });

  it("passes an unrecognised mode through rather than inventing a label", () => {
    expect(
      describeSelectionMode(
        [
          {
            device_id: "d",
            account_label: ".a",
            account_selection_mode: "round_robin",
          },
        ],
        true
      )
    ).toEqual({ known: true, text: "round_robin" });
  });

  it("reports a null mode as UNKNOWN and never as the least_usage default", () => {
    // `least_usage` is the runner's `#[default]`. Printing it here would
    // state a machine-global behaviour nobody observed — which is exactly
    // the failure this whole surface exists to avoid.
    for (const mode of [null, undefined, "", "   "]) {
      const described = describeSelectionMode(
        [
          {
            device_id: "d",
            account_label: ".a",
            account_selection_mode: mode,
          },
        ],
        true
      );
      expect(described.known).toBe(false);
      expect(described.text).toMatch(/unknown/i);
      expect(described.text).toMatch(/not necessarily least-usage/i);
    }
  });

  it("names the unprovisioned-columns cause when that is why the mode is missing", () => {
    const withColumns = describeSelectionMode([], true);
    const withoutColumns = describeSelectionMode([], false);
    expect(withColumns.known).toBe(false);
    expect(withoutColumns.known).toBe(false);
    expect(withoutColumns.text).toMatch(/predates the selection columns/i);
    expect(withoutColumns.text).not.toBe(withColumns.text);
  });
});

describe("describeSelectionMode — the cause has to be observed too", () => {
  it("does not blame the machine for a mode it was never asked for", () => {
    // With an empty array and no roster state, every one of these used to
    // render "this machine has not reported a selection mode" — a CAUSE
    // that is false when the read failed, is still in flight, or never
    // happened because no device was picked.
    const fault = describeSelectionMode([], true, "fault");
    const loading = describeSelectionMode([], true, "loading");
    const noDevice = describeSelectionMode([], true, "no-device");
    const unknown = describeSelectionMode([], true, "unknown");
    const ready = describeSelectionMode([], true, "ready");

    for (const d of [fault, loading, noDevice, unknown, ready]) {
      expect(d.known).toBe(false);
      expect(d.text).toMatch(/unknown/i);
    }
    expect(fault.text).toMatch(/could not be read/i);
    expect(loading.text).toMatch(/not been read yet/i);
    expect(noDevice.text).toMatch(/until a device is chosen/i);
    expect(ready.text).toMatch(/has not reported/i);
    // ...and each cause is a DIFFERENT string, which is the whole point.
    expect(
      new Set([
        fault.text,
        loading.text,
        noDevice.text,
        unknown.text,
        ready.text,
      ]).size
    ).toBe(5);
  });

  it("reports disagreeing rows as unknown instead of silently taking the first", () => {
    // The ingest upserts and never deletes, so rows of different vintages
    // can carry different modes. Picking one would resolve a contradiction
    // the data does not resolve.
    const described = describeSelectionMode(
      [
        {
          device_id: "d",
          account_label: ".a",
          account_selection_mode: "least_usage",
        },
        {
          device_id: "d",
          account_label: ".b",
          account_selection_mode: "manual",
        },
      ],
      true
    );
    expect(described.known).toBe(false);
    expect(described.text).toMatch(/disagree/i);
    expect(described.text).toMatch(/least_usage/);
    expect(described.text).toMatch(/manual/);
  });

  it("still names a mode when every row agrees", () => {
    expect(
      describeSelectionMode(
        [
          {
            device_id: "d",
            account_label: ".a",
            account_selection_mode: "manual",
          },
          {
            device_id: "d",
            account_label: ".b",
            account_selection_mode: "manual",
          },
        ],
        true
      ).known
    ).toBe(true);
  });
});

describe("formatUtilization", () => {
  it("renders a 0..1 fraction as a percentage", () => {
    expect(formatUtilization(0.4)).toBe("40%");
    expect(formatUtilization(0)).toBe("0%");
    expect(formatUtilization(1)).toBe("100%");
  });

  it("returns null — not 0% — when there is no number", () => {
    // A missing utilization is unknown. Rendering it as 0% would tell the
    // operator an account is completely fresh when nothing was measured.
    expect(formatUtilization(null)).toBeNull();
    expect(formatUtilization(undefined)).toBeNull();
    expect(formatUtilization(Number.NaN)).toBeNull();
  });
});
