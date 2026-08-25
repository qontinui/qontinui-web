import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SpawnModal } from "./SpawnModal";

/**
 * SpawnModal — device-roster legibility tests.
 *
 * Why these exist: the device dropdown rendered a single DISABLED
 * "No devices reporting" item for THREE different causes — a failed
 * `fleet/health` fetch, a non-200, and a genuine 200-with-empty-roster —
 * because the fetch's `.catch` only reached `console.warn`. All three
 * looked identical, and none of them offered any way forward, so an
 * operator whose roster was momentarily empty simply could not spawn.
 *
 * That last case is not hypothetical — it is the live production symptom
 * this change was written for. `list_live_devices_for_tenant` requires a
 * device to be BOTH bound to the reading principal's tenant (an INNER JOIN
 * on `coord.tenant_devices`) and inside the liveness window, and an operator
 * hitting `/admin/coord/spawn` got `{"devices": [], "count": 0}` with
 * healthy machines running.
 *
 * These tests deliberately do NOT encode WHY the roster was empty. An
 * earlier revision asserted a specific cause — a 120s reader vs a 600s
 * writer — which was subsequently falsified (a dedicated 30s device
 * heartbeat exists and was running). The surface's job is to survive an
 * empty roster whatever the reason, so that is all that is pinned here.
 *
 * So the assertions below pin two properties per state:
 *   1. the cause is NAMED (an operator can tell auth from liveness), and
 *   2. a manual device-id entry path EXISTS (the roster is a convenience,
 *      never the only way to name a `target_device_id`).
 *
 * The third describe below covers the UNANCHORED spawn added by plan
 * `2026-08-25-general-purpose-session-spawn-machine-account-prompt` Phase 1:
 * the modal now opens with no plan at all, and `canSubmit` requires only the
 * three fields coord actually rejects a body without. That relaxation is
 * exactly the kind of change that can silently take the device guard down
 * with it, so the guard's own case fills the OTHER requirements first —
 * otherwise "submit is disabled" is true for unrelated reasons and asserts
 * nothing.
 *
 * NOTE ON PROPS: `SpawnModalProps` requires `onClose`. `tsconfig.json`
 * EXCLUDES every `.test.tsx` file from the program, so nothing typechecks
 * this one — a wrong prop name is silently destructured away and every test
 * still passes while rendering a component shape that cannot exist in
 * production. Keep these props in sync with the real call site
 * (`app/(app)/admin/coord/spawn/page.tsx`) by hand.
 */

const DEVICE = "eb2155ed-4152-4a91-be82-5d4346f717fc";

function renderModal() {
  return render(
    <SpawnModal
      open
      onClose={() => {}}
      planSlug="2026-08-25-example-plan"
      initialPhase="1"
    />
  );
}

/** Satisfy everything `canSubmit` needs EXCEPT the device.
 *
 *  Without this, a "submit is disabled" assertion passes because the repos
 *  list is empty and the prompt is blank — it would stay green with the
 *  device guard deleted, which is the one thing it is meant to pin. */
async function fillNonDeviceRequirements(
  user: ReturnType<typeof userEvent.setup>
) {
  await user.click(screen.getByTestId("coord-spawn-repo-qontinui-web"));
  await user.type(screen.getByTestId("coord-spawn-initial-prompt"), "go");
}

function rosterOf(devices: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ devices, count: devices.length }),
  };
}

/** A well-formed `/operations/claude-accounts` envelope.
 *
 *  Both provisioning flags default to `true` — i.e. "coord answered, and its
 *  table and columns exist" — so an `accounts: []` built here is the
 *  GENUINELY-EMPTY state and not the unknown one. Every unknown case below
 *  overrides a flag explicitly rather than relying on an absence. */
function accountsOf(
  accounts: unknown[],
  overrides: Record<string, unknown> = {}
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      accounts,
      table_provisioned: true,
      columns_provisioned: true,
      ...overrides,
    }),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
/** What the (independent) `/claude-accounts` fetch answers.
 *
 *  The modal now makes TWO unrelated reads on open. Routing them by URL is
 *  what keeps each pre-existing case above about the DEVICE roster it was
 *  written for — `fetchMock.mockResolvedValue(...)` still drives the device
 *  read and the spawn POST exactly as it did, while the account read gets a
 *  sane default here instead of silently receiving a fleet-health body. */
let accountsResponse: unknown;

beforeEach(() => {
  fetchMock = vi.fn();
  accountsResponse = accountsOf([]);
  vi.stubGlobal("fetch", (url: unknown, init?: unknown) =>
    String(url).includes("/claude-accounts")
      ? Promise.resolve(accountsResponse)
      : fetchMock(url, init)
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SpawnModal device roster", () => {
  it("renders the roster as a select when coord returns devices", async () => {
    fetchMock.mockResolvedValue(
      rosterOf([
        { device_id: DEVICE, hostname: "merytshost", state: "healthy" },
      ])
    );
    const user = userEvent.setup();

    renderModal();

    const trigger = await screen.findByTestId("coord-spawn-device-select");
    // A populated roster must NOT force the manual path on the operator.
    expect(screen.queryByTestId("coord-spawn-device-input")).toBeNull();
    expect(screen.queryByTestId("coord-spawn-device-notice")).toBeNull();

    // Radix mounts SelectItems only once the popover opens, so asserting on
    // the trigger alone would stay green even if `devices.map(...)` were
    // deleted. Open it and pin an actual option.
    await user.click(trigger);
    const option = await screen.findByRole("option", { name: /merytshost/ });
    expect(option.textContent).toContain("healthy");
  });

  it("names the liveness cause and offers manual entry on an empty roster", async () => {
    fetchMock.mockResolvedValue(rosterOf([]));

    renderModal();

    // The empty case must be a STATEMENT, not a blank control: a 200 with
    // no devices is a real answer about liveness, not a failure.
    const notice = await screen.findByTestId("coord-spawn-device-notice");
    expect(notice.textContent).toMatch(/0 live devices/i);
    expect(notice.textContent).toMatch(/heartbeat/i);
    // ...and it must leave a way to proceed.
    expect(screen.getByTestId("coord-spawn-device-input")).toBeTruthy();
  });

  it("does not offer a roster the operator cannot use", async () => {
    fetchMock.mockResolvedValue(rosterOf([]));

    renderModal();

    await screen.findByTestId("coord-spawn-device-input");
    // Switching back to a zero-item Select is the dead end this change
    // exists to remove — so the return trip must not be offered at all.
    expect(screen.queryByTestId("coord-spawn-device-toggle")).toBeNull();
  });

  it("surfaces the HTTP status on a non-200 rather than showing an empty roster", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    });

    renderModal();

    const notice = await screen.findByTestId("coord-spawn-device-notice");
    // 403 is an auth/proxy fault with a completely different fix from the
    // empty-roster case — the operator must be able to tell them apart.
    expect(notice.textContent).toMatch(/403/);
    expect(notice.textContent).not.toMatch(/0 live devices/i);
    // A fault is an error, not information, and is styled as one.
    expect(notice.className).toContain("text-destructive");
    expect(screen.getByTestId("coord-spawn-device-input")).toBeTruthy();
  });

  it("surfaces a transport failure and still offers manual entry", async () => {
    fetchMock.mockRejectedValue(new Error("NetworkError: failed to fetch"));

    renderModal();

    const notice = await screen.findByTestId("coord-spawn-device-notice");
    expect(notice.textContent).toMatch(/NetworkError/);
    expect(screen.getByTestId("coord-spawn-device-input")).toBeTruthy();
  });
});

describe("SpawnModal manual device entry", () => {
  it("clears a half-typed device id when switching back to the roster", async () => {
    fetchMock.mockResolvedValue(
      rosterOf([
        { device_id: DEVICE, hostname: "merytshost", state: "healthy" },
      ])
    );
    const user = userEvent.setup();

    renderModal();
    await screen.findByTestId("coord-spawn-device-select");

    await user.click(screen.getByTestId("coord-spawn-device-toggle"));
    const input = (await screen.findByTestId(
      "coord-spawn-device-input"
    )) as HTMLInputElement;
    await user.type(input, "half-typed");

    // Back to the roster, then out again: the id must not survive as state
    // the visible control can no longer reach.
    await user.click(screen.getByTestId("coord-spawn-device-toggle"));
    await screen.findByTestId("coord-spawn-device-select");
    await user.click(screen.getByTestId("coord-spawn-device-toggle"));

    expect(
      (
        (await screen.findByTestId(
          "coord-spawn-device-input"
        )) as HTMLInputElement
      ).value
    ).toBe("");
  });

  it("flags a non-uuid before it costs a round trip to a 422", async () => {
    fetchMock.mockResolvedValue(rosterOf([]));
    const user = userEvent.setup();

    renderModal();
    const input = (await screen.findByTestId(
      "coord-spawn-device-input"
    )) as HTMLInputElement;
    // Everything else canSubmit wants, so the button below is about the
    // device id and nothing else.
    await fillNonDeviceRequirements(user);
    const submit = screen.getByTestId(
      "coord-spawn-submit"
    ) as HTMLButtonElement;

    await user.type(input, "not-a-uuid");
    expect(screen.getByTestId("coord-spawn-device-invalid")).toBeTruthy();
    expect(submit.disabled).toBe(true);

    // ...and the guard is the ONLY thing holding it: a valid id releases it.
    await user.clear(input);
    await user.type(input, DEVICE);
    expect(screen.queryByTestId("coord-spawn-device-invalid")).toBeNull();
    expect(submit.disabled).toBe(false);
  });

  it("accepts both uuid spellings coord's deserializer takes", async () => {
    fetchMock.mockResolvedValue(rosterOf([]));
    const user = userEvent.setup();

    renderModal();
    const input = (await screen.findByTestId(
      "coord-spawn-device-input"
    )) as HTMLInputElement;

    // Hyphenated.
    await user.type(input, DEVICE);
    expect(screen.queryByTestId("coord-spawn-device-invalid")).toBeNull();

    // Simple 32-hex — coord's Uuid deserializer accepts it, so a
    // hyphens-only guard would reject input coord would happily take.
    await user.clear(input);
    await user.type(input, DEVICE.replace(/-/g, ""));
    expect(screen.queryByTestId("coord-spawn-device-invalid")).toBeNull();
  });

  it("does not preserve surrounding whitespace while typing", async () => {
    fetchMock.mockResolvedValue(rosterOf([]));
    const user = userEvent.setup();

    renderModal();
    const input = (await screen.findByTestId(
      "coord-spawn-device-input"
    )) as HTMLInputElement;

    // The input is deliberately RAW — trimming on every keystroke moved the
    // caret and ate spaces mid-value while still letting a pasted internal
    // space through. Normalization happens at the wire boundary instead
    // (`buildSpawnRequestBody`), so the typed value round-trips untouched...
    await user.type(input, "  " + DEVICE);
    expect(input.value).toBe("  " + DEVICE);
    // ...and leading/trailing whitespace still validates, because the guard
    // tests the trimmed value.
    expect(screen.queryByTestId("coord-spawn-device-invalid")).toBeNull();
  });
});

describe("SpawnModal unanchored spawn", () => {
  it("submits with only a device, a repo and a prompt when no plan is seeded", async () => {
    fetchMock.mockResolvedValue(rosterOf([]));
    const user = userEvent.setup();

    // No `planSlug` at all — the "New session" entry point.
    render(<SpawnModal open onClose={() => {}} />);

    const input = await screen.findByTestId("coord-spawn-device-input");
    // A disabled, empty "Plan" field would be a lie about what this spawn
    // is; the modal names the state instead.
    expect(screen.queryByTestId("coord-spawn-plan-slug")).toBeNull();
    expect(screen.getByTestId("coord-spawn-unanchored-notice")).toBeTruthy();

    const submit = screen.getByTestId(
      "coord-spawn-submit"
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    await user.type(input, DEVICE);
    await fillNonDeviceRequirements(user);

    // The whole point of Phase 1: no plan slug, no phase and no intent were
    // typed, and the spawn is still submittable — those three are
    // `Option<..>` on coord's SpawnRequest, so requiring them was a
    // frontend invention.
    expect(submit.disabled).toBe(false);
  });

  it("still shows the plan field when a plan IS seeded", async () => {
    fetchMock.mockResolvedValue(rosterOf([]));

    renderModal();
    await screen.findByTestId("coord-spawn-device-input");

    // The relaxation must not have deleted the anchored shape.
    expect(
      (screen.getByTestId("coord-spawn-plan-slug") as HTMLInputElement).value
    ).toBe("2026-08-25-example-plan");
    expect(screen.queryByTestId("coord-spawn-unanchored-notice")).toBeNull();
  });
});

/**
 * Phase 2 (the roster is VISIBLE) and Phase 3 (the operator may PIN one),
 * from the same plan as the unanchored spawn above.
 *
 * The property under test throughout is the one the device roster already
 * had to learn: **an empty answer and an unreadable one must not render
 * identically.** "This machine has no Claude accounts" is a strictly worse
 * lie than "unknown" — it tells an operator a machine cannot run an agent
 * when it can — so `table_provisioned: false`, a null flag, a non-2xx and a
 * transport failure are each surfaced as UNKNOWN, with the cause named.
 *
 * Every case here drives the device through the MANUAL input (the account
 * roster is per-machine, so nothing renders until a valid device id exists),
 * which is also why the device roster is mocked empty: that auto-arms the
 * manual path.
 */

const ACCOUNTS = [
  {
    device_id: DEVICE,
    account_label: ".claude-gmail",
    weekly_utilization: 0.4,
    session_utilization: 0.12,
    exhausted: false,
    stale: false,
    error: false,
    is_active: true,
    account_selection_mode: "least_usage",
  },
  {
    device_id: DEVICE,
    account_label: ".claude-work",
    weekly_utilization: 0.98,
    session_utilization: null,
    exhausted: true,
    stale: false,
    error: false,
    is_active: false,
    account_selection_mode: "least_usage",
  },
];

/** Render with an empty device roster (so the manual input is armed) and
 *  type a valid device id, which is what makes the account section live. */
async function renderWithDevice(user: ReturnType<typeof userEvent.setup>) {
  fetchMock.mockResolvedValue(rosterOf([]));
  renderModal();
  const input = await screen.findByTestId("coord-spawn-device-input");
  await user.type(input, DEVICE);
  return input;
}

describe("SpawnModal Claude account roster", () => {
  it("lists the chosen machine's accounts, its mode, and which one is active", async () => {
    accountsResponse = accountsOf(ACCOUNTS);
    const user = userEvent.setup();

    await renderWithDevice(user);

    // Phase 2's whole deliverable: the implicit machine-global behaviour is
    // stated, not left for the operator to infer from a dropdown.
    const mode = await screen.findByTestId("coord-spawn-account-mode");
    expect(mode.textContent).toMatch(/least-usage rotation/i);
    expect(mode.textContent).not.toMatch(/unknown/i);

    const roster = screen.getByTestId("coord-spawn-account-roster");
    expect(roster).toBeTruthy();
    // No notice: a readable, non-empty roster is not an exception state.
    expect(screen.queryByTestId("coord-spawn-account-notice")).toBeNull();

    const gmail = screen.getByTestId("coord-spawn-account-row-.claude-gmail");
    expect(gmail.textContent).toMatch(/active now/i);
    expect(gmail.textContent).toMatch(/40%/);

    // ...and an account that will not serve is FLAGGED rather than quietly
    // offered as if it were interchangeable with the others.
    const work = screen.getByTestId("coord-spawn-account-row-.claude-work");
    expect(work.textContent).toMatch(/exhausted/i);
    expect(work.textContent).not.toMatch(/active now/i);

    // A local path must never reach this surface — identity on the wire is
    // the config-dir basename, deliberately.
    expect(roster.textContent).not.toMatch(/[A-Za-z]:\\|\/home\/|\/Users\//);
  });

  it("says a stale feed STOPPED rather than presenting its numbers as current", async () => {
    accountsResponse = accountsOf([
      { ...ACCOUNTS[0], stale: true, weekly_utilization: 0.4 },
    ]);
    const user = userEvent.setup();

    await renderWithDevice(user);

    const row = await screen.findByTestId(
      "coord-spawn-account-row-.claude-gmail"
    );
    expect(row.textContent).toMatch(/stale/i);
    // The number is still shown — it is the last known one — but the row
    // says so, which is the difference between a snapshot and a lie.
    expect(row.textContent).toMatch(/last-known/i);
    expect(row.textContent).toMatch(/40%/);
  });

  it("renders a genuinely empty roster as an ANSWER, not as a failure", async () => {
    // Coord answered, both flags true, zero rows: nothing has reported.
    accountsResponse = accountsOf([]);
    const user = userEvent.setup();

    await renderWithDevice(user);

    const notice = await screen.findByTestId("coord-spawn-account-notice");
    expect(notice.textContent).toMatch(/provisioned/i);
    expect(notice.textContent).toMatch(/no runner has reported/i);
    // Information, not an error — the two are styled differently on purpose.
    expect(notice.className).not.toContain("text-destructive");
    expect(screen.queryByTestId("coord-spawn-account-roster")).toBeNull();
  });

  it("tells an empty roster apart from an unprovisioned one, and calls the latter UNKNOWN", async () => {
    const user = userEvent.setup();

    accountsResponse = accountsOf([]);
    await renderWithDevice(user);
    const emptyText = (await screen.findByTestId("coord-spawn-account-notice"))
      .textContent;

    // Tear the first modal down completely before the second: comparing the
    // two strings is the whole assertion, so they must not coexist.
    cleanup();

    accountsResponse = accountsOf([], { table_provisioned: false });
    await renderWithDevice(userEvent.setup());
    const unknownNotice = await screen.findByTestId(
      "coord-spawn-account-notice"
    );

    // The load-bearing assertion: these two states DO NOT render the same
    // string. An unprovisioned table has observed nothing, so reporting it
    // as "no accounts" would state a fact nobody has.
    expect(unknownNotice.textContent).not.toBe(emptyText);
    expect(unknownNotice.textContent).toMatch(/claude_account_usage/);
    expect(unknownNotice.textContent).toMatch(/UNKNOWN/);
    expect(unknownNotice.textContent).not.toMatch(/least.usage/i);
  });

  it("treats a MISSING provisioning flag as unknown, never as provisioned", async () => {
    // Coord declining to say is not coord saying yes. Defaulting the flag to
    // `true` here would let an empty list read as "this machine has none".
    accountsResponse = {
      ok: true,
      status: 200,
      json: async () => ({ accounts: [] }),
    };
    const user = userEvent.setup();

    await renderWithDevice(user);

    const notice = await screen.findByTestId("coord-spawn-account-notice");
    expect(notice.textContent).toMatch(/did not report whether/i);
    expect(notice.textContent).toMatch(/UNKNOWN/);
    expect(notice.textContent).not.toMatch(/no runner has reported/i);
  });

  it("surfaces a non-2xx as a fault, distinct from both empty and unprovisioned", async () => {
    accountsResponse = { ok: false, status: 403, json: async () => ({}) };
    const user = userEvent.setup();

    await renderWithDevice(user);

    const notice = await screen.findByTestId("coord-spawn-account-notice");
    expect(notice.textContent).toMatch(/403/);
    expect(notice.textContent).toMatch(/UNKNOWN/);
    // A fault is an error and is styled as one; the empty case is not.
    expect(notice.className).toContain("text-destructive");
  });

  it("surfaces a transport failure the same way", async () => {
    accountsResponse = Promise.reject(
      new Error("NetworkError: failed to fetch")
    );
    const user = userEvent.setup();

    await renderWithDevice(user);

    const notice = await screen.findByTestId("coord-spawn-account-notice");
    expect(notice.textContent).toMatch(/NetworkError/);
    expect(notice.className).toContain("text-destructive");
  });

  it("reports an unreported selection mode as unknown, not as the least_usage default", async () => {
    // `least_usage` is the RUNNER's `#[default]`. Printing it from a null
    // column would state machine-global behaviour we never observed.
    accountsResponse = accountsOf(
      [{ ...ACCOUNTS[0], account_selection_mode: null, is_active: null }],
      { columns_provisioned: false }
    );
    const user = userEvent.setup();

    await renderWithDevice(user);

    const mode = await screen.findByTestId("coord-spawn-account-mode");
    expect(mode.textContent).toMatch(/unknown/i);
    expect(mode.textContent).toMatch(/not necessarily least-usage/i);

    // ...and the row says which account is active is unknown too, rather
    // than rendering a null `is_active` as "not active".
    const row = screen.getByTestId("coord-spawn-account-row-.claude-gmail");
    expect(row.textContent).toMatch(/active: unknown/i);
    expect(
      screen.getByTestId("coord-spawn-account-columns-notice").textContent
    ).toMatch(/predates/i);
  });

  it("says the roster is per-machine before a device is chosen", async () => {
    accountsResponse = accountsOf(ACCOUNTS);
    fetchMock.mockResolvedValue(rosterOf([]));

    renderModal();

    const notice = await screen.findByTestId("coord-spawn-account-notice");
    expect(notice.textContent).toMatch(/choose a device first/i);
    expect(screen.queryByTestId("coord-spawn-account-roster")).toBeNull();
  });
});

describe("SpawnModal account pin", () => {
  it("defaults to letting the machine choose and omits `account` from the body", async () => {
    accountsResponse = accountsOf(ACCOUNTS);
    const user = userEvent.setup();

    await renderWithDevice(user);
    await screen.findByTestId("coord-spawn-account-roster");
    expect(
      screen.getByTestId("coord-spawn-account-select").textContent
    ).toMatch(/let the machine choose/i);

    await fillNonDeviceRequirements(user);
    await user.click(screen.getByTestId("coord-spawn-submit"));

    const spawn = fetchMock.mock.calls.find(([url]: [unknown]) =>
      String(url).includes("/agents/spawn")
    );
    expect(spawn).toBeTruthy();
    const body = JSON.parse(String(spawn![1].body));
    // Absence IS the no-pin signal: coord types `account` as
    // `Option<String>` with `#[serde(default)]`, so omitting it leaves the
    // runner's own rotation exactly as it is today. `""` would be a pin on
    // an account no machine has.
    expect(body).not.toHaveProperty("account");
    expect(body.target_device_id).toBe(DEVICE);
  });

  it("sends the chosen account_label as `account` when the operator pins one", async () => {
    accountsResponse = accountsOf(ACCOUNTS);
    const user = userEvent.setup();

    await renderWithDevice(user);
    await screen.findByTestId("coord-spawn-account-roster");

    await user.click(screen.getByTestId("coord-spawn-account-select"));
    await user.click(
      await screen.findByRole("option", { name: /\.claude-gmail/ })
    );
    await fillNonDeviceRequirements(user);
    await user.click(screen.getByTestId("coord-spawn-submit"));

    const spawn = fetchMock.mock.calls.find(([url]: [unknown]) =>
      String(url).includes("/agents/spawn")
    );
    const body = JSON.parse(String(spawn![1].body));
    // The wire key is `account`, and its value is the config-dir BASENAME —
    // never a local path, which is a contract of the ingest side.
    expect(body.account).toBe(".claude-gmail");
  });

  it("warns rather than silently pinning an account that will not serve", async () => {
    accountsResponse = accountsOf(ACCOUNTS);
    const user = userEvent.setup();

    await renderWithDevice(user);
    await screen.findByTestId("coord-spawn-account-roster");
    expect(screen.queryByTestId("coord-spawn-account-pin-warning")).toBeNull();
    // Everything else `canSubmit` wants, so "still submittable" below is
    // about the flagged pin and nothing else.
    await fillNonDeviceRequirements(user);

    await user.click(screen.getByTestId("coord-spawn-account-select"));
    await user.click(
      await screen.findByRole("option", { name: /\.claude-work/ })
    );

    // Flagged, not disabled: `exhausted` is an observation from a feed that
    // can itself be out of date, so the operator is warned, not overruled.
    expect(
      screen.getByTestId("coord-spawn-account-pin-warning").textContent
    ).toMatch(/exhausted/i);
    expect(
      (screen.getByTestId("coord-spawn-submit") as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it("does not block a spawn when the roster is unreadable", async () => {
    // The roster is a CONVENIENCE, exactly as the device roster is. Losing
    // it costs the ability to pin, not the ability to spawn.
    accountsResponse = { ok: false, status: 500, json: async () => ({}) };
    const user = userEvent.setup();

    await renderWithDevice(user);
    await screen.findByTestId("coord-spawn-account-notice");
    await fillNonDeviceRequirements(user);

    expect(
      (screen.getByTestId("coord-spawn-submit") as HTMLButtonElement).disabled
    ).toBe(false);
    // ...and "let the machine choose" is not presented as an informed
    // default while the roster is unknown — the notice says it is unknown.
    expect(
      screen.getByTestId("coord-spawn-account-notice").textContent
    ).toMatch(/UNKNOWN/);
  });

  it("drops a pin when the operator switches machines", async () => {
    // An account label only means something on the machine that reported it.
    accountsResponse = accountsOf(ACCOUNTS);
    const user = userEvent.setup();

    const input = await renderWithDevice(user);
    await screen.findByTestId("coord-spawn-account-roster");
    await user.click(screen.getByTestId("coord-spawn-account-select"));
    await user.click(
      await screen.findByRole("option", { name: /\.claude-gmail/ })
    );
    expect(
      screen.getByTestId("coord-spawn-account-select").textContent
    ).toMatch(/\.claude-gmail/);

    await user.clear(input);
    await user.type(input, "00000000-0000-0000-0000-deadbeefcafe");

    expect(
      screen.getByTestId("coord-spawn-account-select").textContent
    ).toMatch(/let the machine choose/i);
  });
});

/**
 * Regressions found in pre-PR review of this very change. Each one is a
 * place where the surface stated something it had not observed — the exact
 * failure class the rest of this file exists to prevent — so each gets its
 * own case rather than a comment.
 */
describe("SpawnModal account roster — states that must not be invented", () => {
  it("renders a roster it actually read even when coord omits the provisioning flags", async () => {
    // A coord build predating its own read route's flags serves ROWS and no
    // flags. Gating "ready" on the flag discarded a roster we had in hand
    // and then told the operator it could not be read.
    accountsResponse = {
      ok: true,
      status: 200,
      json: async () => ({ accounts: ACCOUNTS }),
    };
    const user = userEvent.setup();

    await renderWithDevice(user);

    expect(
      await screen.findByTestId("coord-spawn-account-roster")
    ).toBeTruthy();
    expect(screen.queryByTestId("coord-spawn-account-notice")).toBeNull();
    expect(
      screen.getByTestId("coord-spawn-account-row-.claude-gmail")
    ).toBeTruthy();
    // ...and the pin is offered, because the accounts are right there.
    await user.click(screen.getByTestId("coord-spawn-account-select"));
    expect(
      await screen.findByRole("option", { name: /\.claude-gmail/ })
    ).toBeTruthy();
  });

  it("does not blame the machine for a mode it was never asked for", async () => {
    // On a 403 we never reached the machine, so "this machine has not
    // reported a selection mode" is a fabricated cause. It must name the
    // read failure instead — while still never saying least_usage.
    accountsResponse = { ok: false, status: 403, json: async () => ({}) };
    const user = userEvent.setup();

    await renderWithDevice(user);
    await screen.findByTestId("coord-spawn-account-notice");

    const mode = screen.getByTestId("coord-spawn-account-mode");
    expect(mode.textContent).toMatch(/could not be read/i);
    expect(mode.textContent).not.toMatch(/has not reported a selection mode/i);
    expect(mode.textContent).toMatch(/not necessarily least-usage/i);
  });

  it("does not describe a machine at all before one is chosen", async () => {
    accountsResponse = accountsOf(ACCOUNTS);
    fetchMock.mockResolvedValue(rosterOf([]));

    renderModal();
    await screen.findByTestId("coord-spawn-account-notice");

    const mode = screen.getByTestId("coord-spawn-account-mode");
    expect(mode.textContent).toMatch(/until a device is chosen/i);
    expect(mode.textContent).not.toMatch(/has not reported/i);
  });

  it("keeps the columns caveat off screen when there are no numbers to caveat", async () => {
    // "the usage numbers are real but …" is false when zero numbers are on
    // screen, so the notice is gated on a roster that actually rendered.
    accountsResponse = accountsOf([], { columns_provisioned: false });
    const user = userEvent.setup();

    await renderWithDevice(user);
    await screen.findByTestId("coord-spawn-account-notice");

    expect(
      screen.queryByTestId("coord-spawn-account-columns-notice")
    ).toBeNull();
  });

  it("marks a single null is_active row unknown even beside rows that report it", async () => {
    // `.some()` over the whole roster made a null `is_active` render
    // identically to `false` whenever ANY sibling row carried a boolean.
    accountsResponse = accountsOf([
      ACCOUNTS[0],
      { ...ACCOUNTS[1], is_active: null },
    ]);
    const user = userEvent.setup();

    await renderWithDevice(user);

    const orphan = await screen.findByTestId(
      "coord-spawn-account-row-.claude-work"
    );
    expect(orphan.textContent).toMatch(/active: unknown/i);
    // ...and the row that DID report is still shown as reporting.
    expect(
      screen.getByTestId("coord-spawn-account-row-.claude-gmail").textContent
    ).toMatch(/active now/i);
  });
});
