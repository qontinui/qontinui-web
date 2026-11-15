/**
 * "Remove from this tenant…" on the Roles panel (plan
 * `2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console`
 * Phase 3), end to end against a mocked transport: the dialog's warnings per
 * GitHub-listing arm and heartbeat, the typed phrase, the last-CI-host
 * warning, and every shape of answer — total, partial, failed, the 401 abort,
 * the home-tenant pointer (D4) and a second removal after a first.
 *
 * `DestructiveButton` is replaced by a plain button: jsdom cannot produce a
 * trusted click, and its synthetic-click guard is covered by
 * `components/ui/destructive-button.test.tsx`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), toastMock) }));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));

import {
  CI_HOST_LABEL,
  DEV_A,
  DEV_CI,
  HOST_A,
  HOST_B,
  rolesMachine,
} from "@/test/devopsPresentationFixture";
import { absoluteTime } from "@/components/console";
import { parseDispatchRoles, type RoleMachine } from "./fleetDispatchRoles";
import { FleetRolesSection } from "./FleetRolesSection";
import {
  ALIVE_TEXT,
  LAST_CI_HOST_TEXT,
  MAYBE_LAST_CI_HOST_TEXT,
  MAY_HAVE_APPLIED_TEXT,
  STILL_LISTED_HOME_TENANT_TEXT as STILL_LISTED_NOTE,
  LIVENESS_UNKNOWN_TEXT,
  LISTING_NOT_SERVED,
  STILL_LISTED_TEXT,
  confirmPhraseFor,
  isLastCiHost,
  removalRows,
  combineSummaries,
  summarizeUnbind,
} from "./removeMachineFromTenant";

/** A second registration of the same CI host, on another repository. */
const DEV_CI_2 = "c3c3c3c3-0000-4000-8000-0000000000c2";
/** Another CI host's registration. */
const DEV_CI_OTHER = "e5e5e5e5-0000-4000-8000-00000000000e";
const SEEN_CI = "2026-11-11T08:00:00Z";
const SEEN_CI_2 = "2026-11-12T09:30:00Z";

function json(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

type Listing = "listed" | "not_listed" | "unknown";

function ciHost(
  over: Record<string, unknown> = {},
  listing: Listing | null = "not_listed"
) {
  return {
    ...rolesMachine("", CI_HOST_LABEL),
    kind: "ci_host",
    machine_key: `host:${CI_HOST_LABEL}`,
    device_id: null,
    ci_host_name: CI_HOST_LABEL,
    role: null,
    heartbeat_fresh: false,
    device_ids: [DEV_CI, DEV_CI_2],
    last_seen_at: SEEN_CI_2,
    device_listings:
      listing === null
        ? undefined
        : [
            {
              device_id: DEV_CI,
              scope: "acme-partner/secret-repo",
              last_seen_at: SEEN_CI,
              registrar_listing: listing,
              registrar_listing_detail:
                listing === "unknown"
                  ? "no stored listing for the scope"
                  : null,
            },
            {
              device_id: DEV_CI_2,
              scope: "acme-partner/other-repo",
              last_seen_at: SEEN_CI_2,
              registrar_listing: listing,
              registrar_listing_detail: null,
            },
          ],
    ...over,
  };
}

const workstation = (over: Record<string, unknown> = {}) =>
  rolesMachine(DEV_A, HOST_A, {
    device_ids: [DEV_A],
    heartbeat_fresh: true,
    last_seen_at: "2026-11-15T09:00:00Z",
    ...over,
  });

let machines: Record<string, unknown>[];
let posts: string[][];
let postAnswers: Array<ReturnType<typeof json> | Error>;
let gets: number;
/** Extra fields on the roster body (e.g. `roster_truncated: true`). */
let rosterExtras: Record<string, unknown>;
/** Fail every roster read from now on (the post-removal re-read). */
let failReads: boolean;
/** Answer the next POST only when this is resolved. */
let holdPost: Promise<void> | null;
/** Answer roster reads only when this is resolved. */
let holdReads: Promise<void> | null;

function serve() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/fleet/devices/unbind")) {
      posts.push(
        (JSON.parse(String(init.body)) as { device_ids: string[] }).device_ids
      );
      if (holdPost) await holdPost;
      const next = postAnswers.shift();
      if (next instanceof Error) throw next;
      return next ?? json(500, { detail: "unexpected" });
    }
    gets += 1;
    if (holdReads) await holdReads;
    if (failReads) return json(500, { detail: "roster read failed" });
    return json(200, {
      state: "known",
      roles_table: "present",
      roster_truncated: false,
      older_machines_omitted: 0,
      unidentifiable_ci_runner_rows: 0,
      machines,
      ...rosterExtras,
    });
  });
}

const unbound = (id: string, pointer: boolean | null = false) => ({
  device_id: id,
  outcome: "unbound",
  status: 200,
  error: null,
  still_member_via_pointer: pointer,
});
const absent = (id: string) => ({
  device_id: id,
  outcome: "already_absent",
  status: 404,
  error: { error: "binding_not_found" },
  still_member_via_pointer: null,
});
const failed = (id: string) => ({
  device_id: id,
  outcome: "failed",
  status: 503,
  error: {
    error: "tenant_devices_absent",
    detail: "coord.tenant_devices is not provisioned",
  },
  still_member_via_pointer: null,
});
/** The refused id, as the route's abort body carries it. */
const refusedRow = (id: string) => ({
  device_id: id,
  outcome: "failed",
  status: 403,
  error: { error: "operator_principal_required" },
  still_member_via_pointer: null,
});
/** A later id an auth abort never sent. */
const abortedRow = (id: string) => ({
  device_id: id,
  outcome: "not_attempted",
  status: null,
  error: {
    error: "not_attempted",
    detail: "the batch was aborted by a caller refusal",
  },
  still_member_via_pointer: null,
});
const answer = (results: Record<string, unknown>[]) =>
  json(200, {
    results,
    unbound: results.filter((r) => r.outcome === "unbound").length,
    already_absent: results.filter((r) => r.outcome === "already_absent")
      .length,
    failed: results.filter((r) => r.outcome === "failed").length,
  });

beforeEach(() => {
  machines = [ciHost(), workstation()];
  posts = [];
  postAnswers = [];
  gets = 0;
  rosterExtras = {};
  failReads = false;
  holdPost = null;
  holdReads = null;
  fetchMock.mockReset();
  toastMock.success.mockReset();
  toastMock.warning.mockReset();
  toastMock.error.mockReset();
  toastMock.info.mockReset();
  serve();
});

/** Expand a machine's row and open its removal dialog. */
async function openRemoval(name: string) {
  fireEvent.click(await screen.findByText(name));
  fireEvent.click(screen.getByTestId("fleet-roles-remove-open"));
  return screen.getByTestId("fleet-roles-remove-dialog");
}

const confirmButton = () =>
  screen.getByTestId("fleet-roles-remove-dialog-confirm") as HTMLButtonElement;

function readMachine(raw: Record<string, unknown>): RoleMachine {
  const read = parseDispatchRoles({ state: "known", machines: [raw] });
  if (read.state !== "known") throw new Error("expected a known read");
  return read.machines[0]!;
}

describe("parseDispatchRoles — device rows and their GitHub listings", () => {
  it("reads device_ids, last_seen_at and each registration's listing", () => {
    const m = readMachine(ciHost());
    expect(m.deviceIds).toEqual([DEV_CI, DEV_CI_2]);
    expect(m.lastSeenAt).toBe(SEEN_CI_2);
    expect(m.deviceListings).toEqual([
      {
        deviceId: DEV_CI,
        scope: "acme-partner/secret-repo",
        lastSeenAt: SEEN_CI,
        registrarListing: "not_listed",
        detail: null,
      },
      {
        deviceId: DEV_CI_2,
        scope: "acme-partner/other-repo",
        lastSeenAt: SEEN_CI_2,
        registrarListing: "not_listed",
        detail: null,
      },
    ]);
  });

  it("an absent device_listings (an older coord) reads UNKNOWN for every row, never listed", () => {
    const m = readMachine(ciHost({}, null));
    expect(m.deviceListings).toBeNull();
    expect(
      removalRows(m).map((r) => [
        r.deviceId,
        r.listing?.registrarListing,
        r.listing?.detail,
      ])
    ).toEqual([
      [DEV_CI, "unknown", LISTING_NOT_SERVED],
      [DEV_CI_2, "unknown", LISTING_NOT_SERVED],
    ]);
  });

  it("a listing value this build does not know is unknown", () => {
    const raw = ciHost();
    (raw.device_listings as Record<string, unknown>[])[0]!.registrar_listing =
      "listed_maybe";
    expect(readMachine(raw).deviceListings![0]!.registrarListing).toBe(
      "unknown"
    );
  });

  it("an unregistered machine has no rows to remove, whatever device_ids says", () => {
    const m = readMachine(
      ciHost({ registration: "assigned_not_registered", device_ids: [DEV_CI] })
    );
    expect(m.deviceIds).toEqual([]);
  });

  it("a workstation with no device_ids served keeps its own device id, and no listings", () => {
    const raw = workstation({ device_listings: [] });
    delete (raw as Record<string, unknown>).device_ids;
    const m = readMachine(raw);
    expect(m.deviceIds).toEqual([DEV_A]);
    expect(m.deviceListings).toBeNull();
  });
});

describe("removal rules", () => {
  it.each([
    [true, HOST_A],
    [null, HOST_A],
    [false, undefined],
  ])("heartbeat_fresh %j asks for the phrase %j", (fresh, phrase) => {
    expect(
      confirmPhraseFor(readMachine(workstation({ heartbeat_fresh: fresh })))
    ).toBe(phrase);
  });

  it("the last CI host is the one whose rows cover every CI-host row", () => {
    const only = readMachine(ciHost());
    const complete = { rosterTruncated: false, omitted: 0, unidentifiable: 0 };
    // Another CI-host row whose device rows coord did not list: never "yes".
    const unlisted = readMachine(
      ciHost({
        machine_key: "host:unlisted-ci",
        ci_host_name: "unlisted-ci",
        name: "unlisted-ci",
        device_ids: [],
      })
    );
    expect(isLastCiHost([only], only, complete)).toBe("yes");
    // Over a cut, gappy or unreported roster read it is only "maybe".
    for (const roster of [
      { rosterTruncated: true, omitted: 0, unidentifiable: 0 },
      { rosterTruncated: false, omitted: 2, unidentifiable: 0 },
      // Not reported is not zero.
      { rosterTruncated: false, omitted: null, unidentifiable: 0 },
      { rosterTruncated: false, omitted: 0, unidentifiable: null },
      // An unnamed CI registration may be another CI host.
      { rosterTruncated: false, omitted: 0, unidentifiable: 2 },
      { rosterTruncated: null, omitted: null, unidentifiable: null },
    ]) {
      expect(isLastCiHost([only], only, roster)).toBe("maybe");
    }
    const other = readMachine(
      ciHost({
        machine_key: "host:other-ci",
        ci_host_name: "other-ci",
        name: "other-ci",
        device_ids: [DEV_CI_OTHER],
      })
    );
    expect(isLastCiHost([only, other], only, complete)).toBe("no");
    expect(isLastCiHost([only, unlisted], only, complete)).toBe("maybe");
    // An assigned-but-unregistered host holds no binding: it does not count.
    const unregistered = readMachine(
      ciHost({
        machine_key: "host:planned-ci",
        ci_host_name: "planned-ci",
        name: "planned-ci",
        registration: "assigned_not_registered",
        device_ids: [],
      })
    );
    expect(isLastCiHost([only, unregistered], only, complete)).toBe("yes");
    const ws = readMachine(workstation());
    expect(isLastCiHost([ws], ws, complete)).toBe("no");
  });

  it("an answer that omits a sent id reports it unreported, not removed", () => {
    const s = summarizeUnbind([DEV_CI, DEV_CI_2], {
      results: [unbound(DEV_CI)],
      unbound: 1,
      already_absent: 0,
      failed: 0,
    } as never);
    expect(s.sentence).toBe(
      "1 of 2 bindings confirmed removed; 1 not reported by the route."
    );
    expect(s.allSettled).toBe(false);
  });
});

describe("the dialog, per GitHub listing and heartbeat", () => {
  const LISTINGS: Listing[] = ["listed", "not_listed", "unknown"];
  const HEARTBEATS: Array<boolean | null> = [true, false, null];
  const cases = LISTINGS.flatMap((l) => HEARTBEATS.map((h) => [l, h] as const));

  it.each(cases)("listing %s, heartbeat_fresh %j", async (listing, fresh) => {
    machines = [ciHost({ heartbeat_fresh: fresh }, listing)];
    render(<FleetRolesSection />);
    const dialog = await openRemoval(CI_HOST_LABEL);

    const rows = within(dialog).getAllByTestId("fleet-roles-remove-row");
    expect(rows.map((r) => r.getAttribute("data-listing"))).toEqual([
      listing,
      listing,
    ]);
    const listingWords = within(dialog)
      .getAllByTestId("fleet-roles-remove-row-listing")
      .map((e) => e.textContent);
    expect(listingWords[0]).toBe(
      {
        listed: "GitHub still lists this runner",
        not_listed: "GitHub no longer lists this runner",
        unknown:
          "Unknown whether GitHub still lists this runner — no stored listing for the scope",
      }[listing]
    );

    const warning = within(dialog).queryByTestId(
      "fleet-roles-remove-still-listed"
    );
    if (listing === "listed")
      expect(warning?.textContent).toBe(STILL_LISTED_TEXT);
    else expect(warning).toBeNull();

    const liveness = within(dialog).queryByTestId(
      "fleet-roles-remove-liveness"
    );
    const phrase = within(dialog).queryByTestId(
      "fleet-roles-remove-dialog-phrase-input"
    );
    if (fresh === false) {
      expect(liveness).toBeNull();
      expect(phrase).toBeNull();
      expect(confirmButton().disabled).toBe(false);
    } else {
      expect(liveness?.textContent).toBe(
        fresh ? ALIVE_TEXT : LIVENESS_UNKNOWN_TEXT
      );
      expect(phrase).not.toBeNull();
      expect(confirmButton().disabled).toBe(true);
    }
  });

  it("names each row with its own age, the full stamp in its title", async () => {
    render(<FleetRolesSection />);
    const dialog = await openRemoval(CI_HOST_LABEL);
    const seen = within(dialog).getAllByTestId("fleet-roles-remove-row-seen");
    expect(seen.map((s) => s.getAttribute("title"))).toEqual([
      absoluteTime(SEEN_CI),
      absoluteTime(SEEN_CI_2),
    ]);
    expect(seen[0]!.textContent).toMatch(/ago$/);
    expect(dialog.textContent).toContain(DEV_CI);
    expect(dialog.textContent).toContain(DEV_CI_2);
  });

  it("the typed phrase enables the confirm only when it is the machine's name", async () => {
    machines = [workstation()];
    render(<FleetRolesSection />);
    const dialog = await openRemoval(HOST_A);
    const input = within(dialog).getByTestId(
      "fleet-roles-remove-dialog-phrase-input"
    );
    fireEvent.change(input, { target: { value: HOST_A.slice(0, -1) } });
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(input, { target: { value: HOST_A } });
    expect(confirmButton().disabled).toBe(false);
  });

  it("warns when this is the tenant's last CI host, and not when another remains", async () => {
    const view = render(<FleetRolesSection />);
    let dialog = await openRemoval(CI_HOST_LABEL);
    expect(
      within(dialog).getByTestId("fleet-roles-remove-last-ci-host").textContent
    ).toBe(LAST_CI_HOST_TEXT);
    view.unmount();

    machines = [
      ciHost(),
      ciHost({
        machine_key: "host:other-ci",
        ci_host_name: "other-ci",
        name: "other-ci",
        device_ids: [DEV_CI_OTHER],
        device_listings: [],
      }),
    ];
    render(<FleetRolesSection />);
    dialog = await openRemoval(CI_HOST_LABEL);
    expect(
      within(dialog).queryByTestId("fleet-roles-remove-last-ci-host")
    ).toBeNull();
  });

  it("over a truncated roster read it says the host MAY be the last", async () => {
    rosterExtras = { roster_truncated: true };
    render(<FleetRolesSection />);
    const dialog = await openRemoval(CI_HOST_LABEL);
    const warning = within(dialog).getByTestId(
      "fleet-roles-remove-last-ci-host"
    );
    expect(warning.getAttribute("data-last-ci-host")).toBe("maybe");
    expect(warning.textContent).toBe(MAYBE_LAST_CI_HOST_TEXT);
  });

  it("a workstation row links its owner's full deregistration on /runners", async () => {
    machines = [workstation({ heartbeat_fresh: false })];
    render(<FleetRolesSection />);
    const dialog = await openRemoval(HOST_A);
    const line = within(dialog).getByTestId("fleet-roles-remove-workstation");
    expect(line.textContent).toContain("done by its owner on /runners");
    expect(within(line).getByRole("link").getAttribute("href")).toBe(
      "/runners"
    );
    expect(
      within(dialog).queryByTestId("fleet-roles-remove-row-listing")
    ).toBeNull();
  });

  it("hides the action for a machine with no device rows", async () => {
    machines = [
      ciHost({ device_ids: [] }),
      rolesMachine("", HOST_B, {
        kind: "ci_host",
        machine_key: `host:${HOST_B}`,
        device_id: null,
        ci_host_name: HOST_B,
        registration: "assigned_not_registered",
      }),
    ];
    render(<FleetRolesSection />);
    for (const name of [CI_HOST_LABEL, HOST_B]) {
      fireEvent.click(await screen.findByText(name));
      // The row's other operator actions are mounted; the removal is not.
      expect(screen.getAllByTestId("fleet-roles-set-bench").length).toBe(1);
      expect(screen.queryByTestId("fleet-roles-remove-open")).toBeNull();
      fireEvent.click(screen.getByText(name));
    }
  });

  it("the open control carries its UI Bridge id and names its effect", async () => {
    render(<FleetRolesSection />);
    fireEvent.click(await screen.findByText(CI_HOST_LABEL));
    const open = screen.getByTestId("fleet-roles-remove-open");
    expect(open.getAttribute("data-ui-bridge-id")).toBe(
      `fleet-roles-remove:host:${CI_HOST_LABEL}`
    );
    expect(open.getAttribute("title")).toBe(
      "Opens a confirmation; removes this tenant's binding of 2 devices."
    );
    expect(open.getAttribute("aria-label")).toBe(
      `Remove from this tenant… (${CI_HOST_LABEL})`
    );
    // The live region is mounted before there is anything to say.
    expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe("");
    expect(
      screen.getByTestId("fleet-roles-remove-ack").getAttribute("role")
    ).toBe("status");
  });
});

describe("the answer", () => {
  it("a total removal toasts, closes the dialog, acknowledges in the row and re-reads", async () => {
    postAnswers = [answer([unbound(DEV_CI), unbound(DEV_CI_2)])];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    const before = gets;
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-roles-remove-dialog")).toBeNull()
    );
    expect(posts).toEqual([[DEV_CI, DEV_CI_2]]);
    expect(toastMock.success).toHaveBeenCalledWith(
      `${CI_HOST_LABEL}: 2 of 2 bindings removed.`
    );
    expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe(
      "2 of 2 bindings removed."
    );
    await waitFor(() => expect(gets).toBeGreaterThan(before));
  });

  it("a partial removal says partial, keeps the dialog open with coord's refusal, and never toasts", async () => {
    postAnswers = [answer([unbound(DEV_CI), failed(DEV_CI_2)])];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(result.textContent).toContain("1 of 2 bindings removed; 1 failed.");
    const outcomes = within(result)
      .getAllByTestId("fleet-roles-remove-outcome-row")
      .map((r) => r.getAttribute("data-outcome"));
    expect(outcomes).toEqual(["removed", "failed"]);
    expect(
      within(result).getByTestId("fleet-roles-remove-row-error").textContent
    ).toContain("coord.tenant_devices is not provisioned");
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(screen.getByTestId("fleet-roles-remove-dialog")).toBeTruthy();
  });

  it("a failed removal keeps every failure visible", async () => {
    postAnswers = [answer([failed(DEV_CI), failed(DEV_CI_2)])];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(result.textContent).toContain("0 of 2 bindings removed; 2 failed.");
    expect(
      within(result).getAllByTestId("fleet-roles-remove-row-error")
    ).toHaveLength(2);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("a 401 aborts the batch and says nothing was removed", async () => {
    postAnswers = [json(401, { detail: "Not authenticated" })];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(result.getAttribute("data-refused")).toBe("auth");
    expect(
      within(result).getByTestId("fleet-roles-remove-refusal").textContent
    ).toContain(
      "This console refused the removal (HTTP 401): not authenticated — sign in again. Nothing was removed."
    );
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("a 403 after the first id reads the refused id and keeps the rows already answered", async () => {
    // The route's real abort body (`coord_refused_caller`).
    postAnswers = [
      json(403, {
        detail: {
          error: "coord_refused_caller",
          coord_status: 401,
          coord_error: { error: "operator_principal_required" },
          refused_device_id: DEV_CI_2,
          results: [unbound(DEV_CI), refusedRow(DEV_CI_2)],
          unbound: 1,
          already_absent: 0,
          unknown: 0,
          failed: 1,
          not_attempted: 0,
        },
      }),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(result.getAttribute("data-refused")).toBe("auth");
    expect(result.textContent).toContain(
      "The batch stopped there; 1 binding was already removed."
    );
    expect(result.textContent).toContain(
      "1 of 2 bindings removed; 1 refused (auth)."
    );
    expect(
      within(result)
        .getAllByTestId("fleet-roles-remove-outcome-row")
        .map((r) => r.getAttribute("data-outcome"))
    ).toEqual(["removed", "refused_auth"]);
    expect(result.textContent).not.toContain("not reported");
    // Its rows say exactly what happened: no "may have been removed".
    expect(
      screen.queryByTestId("fleet-roles-remove-may-have-applied")
    ).toBeNull();
  });

  it("a 403 on the first id says nothing was removed and names the ids never sent", async () => {
    postAnswers = [
      json(403, {
        detail: {
          error: "coord_refused_caller",
          coord_error: { error: "operator_principal_required" },
          refused_device_id: DEV_CI,
          results: [refusedRow(DEV_CI), abortedRow(DEV_CI_2)],
          unbound: 0,
          already_absent: 0,
          unknown: 0,
          failed: 1,
          not_attempted: 1,
        },
      }),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(
      within(result).getByTestId("fleet-roles-remove-refusal").textContent
    ).toContain("Nothing was removed.");
    expect(result.textContent).toContain(
      "0 of 2 bindings removed; 1 refused (auth); 1 not attempted (aborted by an auth refusal)."
    );
    expect(
      within(result)
        .getAllByTestId("fleet-roles-remove-outcome-row")
        .map((r) => r.getAttribute("data-outcome"))
    ).toEqual(["refused_auth", "not_attempted"]);
    expect(
      screen.queryByTestId("fleet-roles-remove-may-have-applied")
    ).toBeNull();
  });

  it("still_member_via_pointer true is still listed, never removed", async () => {
    machines = [workstation({ heartbeat_fresh: false })];
    postAnswers = [answer([unbound(DEV_A, true)])];
    render(<FleetRolesSection />);
    await openRemoval(HOST_A);
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe(
        "1 of 1 binding removed; 1 still listed through its home tenant, which only its owner can change on /runners."
      )
    );
    // Not a clean removal: a warning, never a success toast.
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.warning).toHaveBeenCalledWith(
      `${HOST_A}: 1 of 1 binding removed; 1 still listed through its home tenant, which only its owner can change on /runners.`
    );
  });

  it("still_member_via_pointer null says coord did not report it", async () => {
    machines = [workstation({ heartbeat_fresh: false })];
    postAnswers = [answer([unbound(DEV_A, null)])];
    render(<FleetRolesSection />);
    await openRemoval(HOST_A);
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe(
        // The re-read still lists it: the note follows, naming no cause.
        `1 of 1 binding removed; 1 may still be listed through its home tenant (coord did not report). ${STILL_LISTED_NOTE}`
      )
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
  });

  it("a second removal after a first reads already absent", async () => {
    machines = [workstation({ heartbeat_fresh: false })];
    postAnswers = [answer([unbound(DEV_A)]), answer([absent(DEV_A)])];
    render(<FleetRolesSection />);
    await openRemoval(HOST_A);
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-roles-remove-dialog")).toBeNull()
    );
    // The roster still lists it (e.g. a poll that has not caught up).
    fireEvent.click(screen.getByTestId("fleet-roles-remove-open"));
    // The previous answer is not shown in the reopened dialog.
    expect(screen.queryByTestId("fleet-roles-remove-result")).toBeNull();
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe(
        `Nothing to remove; 1 already absent. ${STILL_LISTED_NOTE}`
      )
    );
    expect(posts).toEqual([[DEV_A], [DEV_A]]);
    // Nothing removed, yet the re-read still lists it: a warning, naming the
    // home tenant — never a calm info.
    expect(toastMock.warning).toHaveBeenCalledWith(
      `${HOST_A}: Nothing to remove; 1 already absent. ${STILL_LISTED_NOTE}`
    );
    expect(toastMock.info).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it("the acknowledgement survives a re-read that fails after the removal", async () => {
    postAnswers = [answer([unbound(DEV_CI), failed(DEV_CI_2)])];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    failReads = true;
    fireEvent.click(confirmButton());
    // The roster turns UNKNOWN, so the row is gone ...
    await screen.findByTestId("fleet-roles-unknown");
    expect(screen.queryByTestId("fleet-roles-row")).toBeNull();
    // ... and the outcome is still on screen, outside it.
    expect(
      screen.getByTestId("fleet-roles-remove-ack-detached").textContent
    ).toBe(
      `Remove from this tenant — ${CI_HOST_LABEL}: 1 of 2 bindings removed; 1 failed.`
    );
    expect(
      screen.getByTestId("fleet-roles-remove-result").textContent
    ).toContain("1 of 2 bindings removed; 1 failed.");
  });

  it("the acknowledgement survives the re-read dropping the machine", async () => {
    postAnswers = [answer([unbound(DEV_CI), unbound(DEV_CI_2)])];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    machines = [workstation()];
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.queryByText(CI_HOST_LABEL)).toBeNull());
    expect(
      screen.getByTestId("fleet-roles-remove-ack-detached").textContent
    ).toBe(
      `Remove from this tenant — ${CI_HOST_LABEL}: 2 of 2 bindings removed.`
    );
  });

  it("a retry after a partial answer sends only the ids not confirmed removed", async () => {
    postAnswers = [
      answer([unbound(DEV_CI), failed(DEV_CI_2)]),
      answer([unbound(DEV_CI_2)]),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    await screen.findByTestId("fleet-roles-remove-result");
    expect(confirmButton().textContent).toBe(
      "Retry the 1 device row not confirmed removed"
    );
    expect(
      screen.getByTestId("fleet-roles-remove-retry-scope").textContent
    ).toBe("A retry sends only the 1 device row not confirmed removed.");
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-roles-remove-dialog")).toBeNull()
    );
    expect(posts).toEqual([[DEV_CI, DEV_CI_2], [DEV_CI_2]]);
    expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe(
      // The whole machine: the first attempt's row and the retry's.
      "2 of 2 bindings removed."
    );
  });

  it("two confirms while the first is in flight send one request", async () => {
    let release: () => void = () => {};
    holdPost = new Promise<void>((r) => {
      release = r;
    });
    postAnswers = [answer([unbound(DEV_CI), unbound(DEV_CI_2)])];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts).toHaveLength(1));
    // Cancel cannot close a dialog whose removal is in flight: it says so by
    // being disabled.
    expect(
      (
        screen.getByTestId(
          "fleet-roles-remove-dialog-cancel"
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(confirmButton().disabled).toBe(true);
    release();
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-roles-remove-dialog")).toBeNull()
    );
    expect(posts).toHaveLength(1);
  });

  it("a 502 says some bindings may have been removed", async () => {
    postAnswers = [json(502, { detail: "bad gateway" })];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(
      within(result).getByTestId("fleet-roles-remove-may-have-applied")
        .textContent
    ).toBe(MAY_HAVE_APPLIED_TEXT);
    expect(toastMock.success).not.toHaveBeenCalled();
    // Nothing is known per id, so a retry sends both again.
    expect(confirmButton().textContent).toBe(
      "Retry the 2 device rows not confirmed removed"
    );
  });

  it("a dropped connection says some bindings may have been removed", async () => {
    postAnswers = [new TypeError("Failed to fetch")];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(
      within(result).getByTestId("fleet-roles-remove-refusal").textContent
    ).toContain(
      "The request failed before an answer arrived (Failed to fetch)."
    );
    expect(
      within(result).getByTestId("fleet-roles-remove-may-have-applied")
        .textContent
    ).toBe(MAY_HAVE_APPLIED_TEXT);
  });

  it("a lost coord answer reads 'may have been removed', never removed or failed, and is retried", async () => {
    // The route's `unknown` tally is left out: the per-id rows decide.
    postAnswers = [
      answer([
        unbound(DEV_CI),
        {
          device_id: DEV_CI_2,
          outcome: "unknown",
          status: null,
          error: { error: "coord_answer_lost", detail: "timed out" },
          still_member_via_pointer: null,
        },
      ]),
      answer([unbound(DEV_CI_2)]),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(result.textContent).toContain(
      "1 of 2 bindings confirmed removed; 1 may have been removed (coord's answer was lost; reload to check)."
    );
    const rows = within(result).getAllByTestId(
      "fleet-roles-remove-outcome-row"
    );
    expect(rows.map((r) => r.getAttribute("data-outcome"))).toEqual([
      "removed",
      "answer_lost",
    ]);
    expect(rows[1]!.textContent).toBe(
      `${DEV_CI_2}: may have been removed — coord's answer was lost; reload to check`
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual([DEV_CI_2]);
  });

  it("an id the batch's deadline never reached reads 'not attempted (time limit)' and is retried", async () => {
    postAnswers = [
      json(200, {
        results: [
          unbound(DEV_CI),
          {
            device_id: DEV_CI_2,
            outcome: "not_attempted",
            status: null,
            error: null,
            still_member_via_pointer: null,
          },
        ],
        unbound: 1,
        already_absent: 0,
        failed: 0,
        unknown: 0,
        not_attempted: 1,
      }),
      answer([unbound(DEV_CI_2)]),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(result.textContent).toContain(
      "1 of 2 bindings removed; 1 not attempted (time limit) — retry."
    );
    const rows = within(result).getAllByTestId(
      "fleet-roles-remove-outcome-row"
    );
    expect(rows[1]!.textContent).toBe(
      `${DEV_CI_2}: not attempted (time limit) — retry`
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(confirmButton().textContent).toBe(
      "Retry the 1 device row not confirmed removed"
    );
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-roles-remove-dialog")).toBeNull()
    );
    expect(posts).toEqual([[DEV_CI, DEV_CI_2], [DEV_CI_2]]);
  });

  it("the confirm stays disabled until the post-removal re-read settles", async () => {
    postAnswers = [
      answer([unbound(DEV_CI), failed(DEV_CI_2)]),
      answer([unbound(DEV_CI_2)]),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    let release: () => void = () => {};
    holdReads = new Promise<void>((r) => {
      release = r;
    });
    fireEvent.click(confirmButton());
    // The answer is on screen while the re-read is still out ...
    await screen.findByTestId("fleet-roles-remove-result");
    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(confirmButton());
    expect(posts).toHaveLength(1);
    // ... and the retry is offered only once it lands.
    holdReads = null;
    release();
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    expect(confirmButton().textContent).toBe(
      "Retry the 1 device row not confirmed removed"
    );
    expect(posts).toHaveLength(1);
  });

  it("a collapsed row's outcome is shown at the section", async () => {
    postAnswers = [answer([unbound(DEV_CI), unbound(DEV_CI_2)])];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe(
        "2 of 2 bindings removed."
      )
    );
    // Shown in the row, so not repeated at the section.
    expect(screen.queryByTestId("fleet-roles-remove-ack-detached")).toBeNull();
    fireEvent.click(screen.getByText(CI_HOST_LABEL));
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-roles-remove-ack")).toBeNull()
    );
    expect(
      screen.getByTestId("fleet-roles-remove-ack-detached").textContent
    ).toBe(
      `Remove from this tenant — ${CI_HOST_LABEL}: 2 of 2 bindings removed.`
    );
  });

  it("an auth abort with a lost answer says some may have been removed", async () => {
    postAnswers = [
      json(403, {
        detail: {
          error: "coord_refused_caller",
          coord_error: { error: "operator_principal_required" },
          refused_device_id: DEV_CI_2,
          results: [
            {
              device_id: DEV_CI,
              outcome: "unknown",
              status: 504,
              error: { error: "coord_answer_lost", detail: "timed out" },
              still_member_via_pointer: null,
            },
            refusedRow(DEV_CI_2),
          ],
          unbound: 0,
          already_absent: 0,
          unknown: 1,
          failed: 1,
          not_attempted: 0,
        },
      }),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(
      within(result).getByTestId("fleet-roles-remove-refusal").textContent
    ).toContain(
      "The batch stopped there; some bindings may have been removed."
    );
    // Said once, in the refusal: no second "may have been removed" line.
    expect(
      within(result).queryByTestId("fleet-roles-remove-may-have-applied")
    ).toBeNull();
    expect(
      within(result)
        .getAllByTestId("fleet-roles-remove-outcome-row")
        .map((r) => r.getAttribute("data-outcome"))
    ).toEqual(["answer_lost", "refused_auth"]);
  });

  it("a route-level 503 says some bindings may have been removed", async () => {
    postAnswers = [json(503, { detail: "service unavailable" })];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(
      within(result).getByTestId("fleet-roles-remove-may-have-applied")
        .textContent
    ).toBe(MAY_HAVE_APPLIED_TEXT);
  });

  it("sends the removal exactly once: no retry of a 429 or a 5xx", async () => {
    postAnswers = [answer([unbound(DEV_CI), unbound(DEV_CI_2)])];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts).toHaveLength(1));
    const call = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST"
    );
    expect(call?.[1]).toMatchObject({ maxRetries: 0, idempotent: false });
  });

  it("a retry never sends another machine's ids", async () => {
    machines = [ciHost(), workstation({ heartbeat_fresh: false })];
    postAnswers = [
      answer([unbound(DEV_CI), failed(DEV_CI_2)]),
      answer([unbound(DEV_A)]),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    await screen.findByTestId("fleet-roles-remove-result");
    expect(confirmButton().textContent).toBe(
      "Retry the 1 device row not confirmed removed"
    );
    fireEvent.click(screen.getByTestId("fleet-roles-remove-dialog-cancel"));
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-roles-remove-dialog")).toBeNull()
    );
    // Another machine's dialog sends that machine's ids, not the retry's.
    fireEvent.click(screen.getByText(HOST_A));
    fireEvent.click(screen.getByTestId("fleet-roles-remove-open"));
    expect(confirmButton().textContent).toBe("Remove from this tenant");
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual([DEV_A]);
  });

  it("quotes coord's own status from coord_status", async () => {
    postAnswers = [
      json(403, {
        detail: {
          error: "coord_refused_caller",
          coord_status: 401,
          coord_error: { error: "unauthenticated" },
          refused_device_id: DEV_CI,
          results: [refusedRow(DEV_CI), abortedRow(DEV_CI_2)],
        },
      }),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(
      within(result).getByTestId("fleet-roles-remove-refusal").textContent
    ).toContain(
      "Coord refused the removal (coord HTTP 401): not authenticated — sign in again. Nothing was removed."
    );
  });

  it("an error whose rows leave nothing unsettled closes as settled, with no retry", async () => {
    postAnswers = [
      json(500, {
        detail: { results: [unbound(DEV_CI), absent(DEV_CI_2)] },
      }),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-roles-remove-dialog")).toBeNull()
    );
    // Still listed after the re-read, with an already-absent row: the note
    // and a warning, not a success.
    expect(toastMock.warning).toHaveBeenCalledWith(
      `${CI_HOST_LABEL}: 1 of 2 bindings removed; 1 already absent. ${STILL_LISTED_NOTE}`
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe(
      `1 of 2 bindings removed; 1 already absent. ${STILL_LISTED_NOTE}`
    );
  });

  it("says 'no tenant selected' for the web gate's tenant_not_resolved", async () => {
    postAnswers = [json(403, { detail: "tenant_not_resolved" })];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(
      within(result).getByTestId("fleet-roles-remove-refusal").textContent
    ).toContain(
      "This console refused the removal (HTTP 403): no coord tenant is selected or resolved for your account — pick a tenant and retry. Nothing was removed."
    );
  });

  it("says 'only an operator' for a 403 that is not about authentication", async () => {
    postAnswers = [json(403, { detail: "not_coord_tenant_admin" })];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(
      within(result).getByTestId("fleet-roles-remove-refusal").textContent
    ).toContain(
      "This console refused the removal (HTTP 403): only an operator of this tenant may remove a machine from it. Nothing was removed."
    );
  });

  it("sends more than 64 device rows in sequential batches and merges the answers", async () => {
    const ids = Array.from(
      { length: 65 },
      (_, i) => `d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`
    );
    machines = [ciHost({ device_ids: ids, device_listings: [] })];
    postAnswers = [
      answer(ids.slice(0, 64).map((id) => unbound(id))),
      answer(ids.slice(64).map((id) => unbound(id))),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-roles-remove-dialog")).toBeNull()
    );
    expect(posts.map((p) => p.length)).toEqual([64, 1]);
    expect(posts.flat()).toEqual(ids);
    expect(toastMock.success).toHaveBeenCalledWith(
      `${CI_HOST_LABEL}: 65 of 65 bindings removed.`
    );
  });

  it("an auth abort in the first batch never sends the next one", async () => {
    const ids = Array.from(
      { length: 65 },
      (_, i) => `d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`
    );
    machines = [ciHost({ device_ids: ids, device_listings: [] })];
    postAnswers = [
      json(403, {
        detail: {
          error: "coord_refused_caller",
          coord_status: 403,
          coord_error: { error: "operator_principal_required" },
          refused_device_id: ids[0],
          results: [
            refusedRow(ids[0]!),
            ...ids.slice(1, 64).map((id) => abortedRow(id)),
          ],
        },
      }),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(posts).toHaveLength(1);
    // The route's rows say "not attempted"; the unsent 65th "not sent".
    expect(result.textContent).toContain(
      "0 of 65 bindings removed; 1 refused (auth); 63 not attempted (aborted by an auth refusal); 1 not sent (an earlier batch was refused)."
    );
  });

  it("a 502 on the first of two batches leaves the second 'not sent', never 'may have been removed'", async () => {
    const ids = Array.from(
      { length: 65 },
      (_, i) => `d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`
    );
    machines = [ciHost({ device_ids: ids, device_listings: [] })];
    postAnswers = [json(502, { detail: "bad gateway" })];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(posts).toHaveLength(1);
    expect(result.textContent).toContain(
      "0 of 65 bindings confirmed removed; 1 not sent (an earlier batch failed or its answer was lost); 64 not reported by the route."
    );
    const outcomes = within(result)
      .getAllByTestId("fleet-roles-remove-outcome-row")
      .map((r) => r.getAttribute("data-outcome"));
    expect(outcomes[64]).toBe("not_sent_after_failure");
    expect(outcomes.slice(0, 64).every((o) => o === "unreported")).toBe(true);
  });

  it("a web-gate 403 on the second batch marks it not attempted and says no more were removed", async () => {
    const ids = Array.from(
      { length: 65 },
      (_, i) => `d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`
    );
    machines = [ciHost({ device_ids: ids, device_listings: [] })];
    postAnswers = [
      answer(ids.slice(0, 64).map((id) => unbound(id))),
      json(403, { detail: "not_coord_tenant_admin" }),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(posts.map((p) => p.length)).toEqual([64, 1]);
    const refusal = within(result).getByTestId(
      "fleet-roles-remove-refusal"
    ).textContent;
    expect(refusal).toContain(
      "This console refused the removal (HTTP 403): only an operator of this tenant may remove a machine from it. The batch stopped there; 64 bindings were already removed."
    );
    expect(refusal).not.toContain("more may have been");
    expect(result.textContent).toContain(
      "64 of 65 bindings removed; 1 not attempted (this console refused the request)."
    );
    expect(
      within(result).queryByTestId("fleet-roles-remove-may-have-applied")
    ).toBeNull();
  });

  it("an unreadable 2xx body says the answer could not be read", async () => {
    postAnswers = [
      {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
        text: async () => "<html>",
      } as unknown as ReturnType<typeof json>,
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(result.textContent).toContain(
      "0 of 2 bindings confirmed removed; 2 unreported (the answer could not be read; the list re-reads to show what coord now holds)."
    );
  });

  it("a retry that finds the bindings absent after a lost answer credits the earlier attempt", async () => {
    postAnswers = [
      new TypeError("Failed to fetch"),
      answer([absent(DEV_CI), absent(DEV_CI_2)]),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    await screen.findByTestId("fleet-roles-remove-may-have-applied");
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-roles-remove-dialog")).toBeNull()
    );
    expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe(
      "0 of 2 bindings removed; 2 absent now (the earlier attempt's answer was lost)."
    );
    // Absent, but nothing confirmed the removal: a warning — never a
    // success, and never "Nothing to remove".
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.info).not.toHaveBeenCalled();
  });

  it("a retry after one lost row credits only that row's earlier attempt", async () => {
    postAnswers = [
      answer([
        unbound(DEV_CI),
        {
          device_id: DEV_CI_2,
          outcome: "unknown",
          status: 504,
          error: { error: "coord_answer_lost", detail: "timed out" },
          still_member_via_pointer: null,
        },
      ]),
      answer([absent(DEV_CI_2)]),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    await screen.findByTestId("fleet-roles-remove-result");
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-roles-remove-dialog")).toBeNull()
    );
    expect(posts).toEqual([[DEV_CI, DEV_CI_2], [DEV_CI_2]]);
    expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe(
      "1 of 2 bindings removed; 1 absent now (the earlier attempt's answer was lost)."
    );
  });

  it("a not-attempted row's own detail picks its words, whatever the abort says", async () => {
    postAnswers = [
      json(403, {
        detail: {
          error: "coord_refused_caller",
          coord_status: 403,
          coord_error: { error: "operator_principal_required" },
          refused_device_id: DEV_CI,
          results: [
            refusedRow(DEV_CI),
            {
              device_id: DEV_CI_2,
              outcome: "not_attempted",
              status: null,
              error: {
                error: "not_attempted",
                detail: "the batch's time budget ran out",
              },
              still_member_via_pointer: null,
            },
          ],
        },
      }),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(
      within(result)
        .getAllByTestId("fleet-roles-remove-outcome-row")
        .map((r) => r.getAttribute("data-outcome"))
    ).toEqual(["refused_auth", "deadline_not_attempted"]);
  });

  it("a non-auth 4xx says the request was rejected, never 'may have been removed'", async () => {
    postAnswers = [json(422, { detail: "device_ids must be unique" })];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(result.textContent).toContain(
      "0 of 2 bindings removed; 2 not attempted (the request was rejected: HTTP 422)."
    );
    expect(
      within(result).getAllByTestId("fleet-roles-remove-outcome-row")[0]!
        .textContent
    ).toBe(`${DEV_CI}: not attempted (the request was rejected: HTTP 422)`);
    expect(
      within(result).queryByTestId("fleet-roles-remove-may-have-applied")
    ).toBeNull();
  });

  it("combineSummaries keeps an earlier row's unreadable answer", () => {
    const earlier = summarizeUnbind([DEV_CI, DEV_CI_2], null);
    const later = summarizeUnbind([DEV_CI], { results: [unbound(DEV_CI)] });
    const whole = combineSummaries([DEV_CI, DEV_CI_2], earlier, later);
    expect(whole.sentence).toBe(
      "1 of 2 bindings confirmed removed; 1 unreported (the answer could not be read; the list re-reads to show what coord now holds)."
    );
  });

  it("an unsettled retry shows the whole machine, not the retried subset", async () => {
    postAnswers = [
      answer([unbound(DEV_CI), failed(DEV_CI_2)]),
      answer([failed(DEV_CI_2)]),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    await screen.findByTestId("fleet-roles-remove-result");
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts).toHaveLength(2));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    const result = screen.getByTestId("fleet-roles-remove-result");
    expect(result.textContent).toContain("1 of 2 bindings removed; 1 failed.");
    expect(result.textContent).not.toContain("0 of 1 binding removed");
    expect(
      within(result)
        .getAllByTestId("fleet-roles-remove-outcome-row")
        .map((r) => r.getAttribute("data-outcome"))
    ).toEqual(["removed", "failed"]);
    expect(screen.getByTestId("fleet-roles-remove-previous").textContent).toBe(
      "Previous attempt: 1 of 2 bindings removed; 1 failed."
    );
  });

  it("a never-sent retry keeps the earlier lost answer, so a later absence still credits it", async () => {
    postAnswers = [
      answer([
        unbound(DEV_CI),
        {
          device_id: DEV_CI_2,
          outcome: "unknown",
          status: 504,
          error: { error: "coord_answer_lost", detail: "timed out" },
          still_member_via_pointer: null,
        },
      ]),
      answer([
        {
          device_id: DEV_CI_2,
          outcome: "not_attempted",
          status: null,
          error: {
            error: "not_attempted",
            detail: "the batch's time budget ran out",
          },
          still_member_via_pointer: null,
        },
      ]),
      answer([absent(DEV_CI_2)]),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      fireEvent.click(confirmButton());
      await waitFor(() => expect(posts).toHaveLength(attempt));
      await waitFor(() => expect(confirmButton().disabled).toBe(false));
    }
    // After the never-sent retry the lost answer still stands.
    expect(
      screen.getByTestId("fleet-roles-remove-result").textContent
    ).toContain("may have been removed (coord's answer was lost");
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-roles-remove-dialog")).toBeNull()
    );
    expect(posts).toEqual([[DEV_CI, DEV_CI_2], [DEV_CI_2], [DEV_CI_2]]);
    expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe(
      "1 of 2 bindings removed; 1 absent now (the earlier attempt's answer was lost)."
    );
  });

  it("combineSummaries: answer lost, then not sent, then absent credits the earlier attempt", () => {
    const ids = [DEV_CI];
    const lost = summarizeUnbind(ids, {
      results: [
        {
          device_id: DEV_CI,
          outcome: "unknown",
          status: 504,
          error: null,
          still_member_via_pointer: null,
        },
      ],
    });
    const notSent = summarizeUnbind(ids, {
      results: [
        {
          device_id: DEV_CI,
          outcome: "not_sent_after_failure",
          status: null,
          error: null,
          still_member_via_pointer: null,
        },
      ],
    });
    const gone = summarizeUnbind(ids, { results: [absent(DEV_CI)] });
    const whole = combineSummaries(
      ids,
      combineSummaries(ids, lost, notSent),
      gone
    );
    expect(whole.rows.map((r) => r.outcome)).toEqual(["removed_earlier"]);
    expect(whole.sentence).toBe(
      "0 of 1 binding removed; 1 absent now (the earlier attempt's answer was lost)."
    );
  });

  it("a lost answer, then a 403 abort on retry, keeps 'may have been removed'", async () => {
    postAnswers = [
      answer([
        unbound(DEV_CI),
        {
          device_id: DEV_CI_2,
          outcome: "unknown",
          status: 504,
          error: { error: "coord_answer_lost", detail: "timed out" },
          still_member_via_pointer: null,
        },
      ]),
      json(403, {
        detail: {
          error: "coord_refused_caller",
          coord_status: 403,
          coord_error: { error: "operator_principal_required" },
          refused_device_id: DEV_CI_2,
          results: [refusedRow(DEV_CI_2)],
        },
      }),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    await screen.findByTestId("fleet-roles-remove-result");
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts).toHaveLength(2));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    const result = screen.getByTestId("fleet-roles-remove-result");
    expect(result.textContent).toContain(
      "1 of 2 bindings confirmed removed; 1 may have been removed (coord's answer was lost; reload to check)."
    );
    expect(
      within(result)
        .getAllByTestId("fleet-roles-remove-outcome-row")
        .map((r) => r.getAttribute("data-outcome"))
    ).toEqual(["removed", "answer_lost"]);
    expect(
      within(result).getByTestId("fleet-roles-remove-refusal").textContent
    ).toContain(
      "The batch stopped there; 1 binding was already removed, and more may have been."
    );
  });

  it("a refused retry after earlier removals never says 'Nothing was removed'", async () => {
    machines = [
      ciHost({
        device_ids: [DEV_CI, DEV_CI_2, DEV_CI_OTHER],
        device_listings: [],
      }),
    ];
    postAnswers = [
      answer([unbound(DEV_CI), unbound(DEV_CI_2), failed(DEV_CI_OTHER)]),
      json(403, {
        detail: {
          error: "coord_refused_caller",
          coord_status: 403,
          coord_error: { error: "operator_principal_required" },
          refused_device_id: DEV_CI_OTHER,
          results: [refusedRow(DEV_CI_OTHER)],
        },
      }),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    await screen.findByTestId("fleet-roles-remove-result");
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts).toHaveLength(2));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    const result = screen.getByTestId("fleet-roles-remove-result");
    const refusal = within(result).getByTestId(
      "fleet-roles-remove-refusal"
    ).textContent;
    expect(refusal).not.toContain("Nothing was removed.");
    expect(refusal).toContain(
      "The batch stopped there; 2 bindings were already removed."
    );
    expect(result.textContent).toContain(
      "2 of 3 bindings removed; 1 refused (auth)."
    );
    expect(
      screen.getByTestId("fleet-roles-remove-ack").textContent
    ).not.toContain("Nothing was removed.");
  });

  it("all already absent and gone from the re-read is an info toast with no home-tenant note", async () => {
    machines = [workstation({ heartbeat_fresh: false })];
    postAnswers = [answer([absent(DEV_A)])];
    render(<FleetRolesSection />);
    await openRemoval(HOST_A);
    machines = [];
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(toastMock.info).toHaveBeenCalledWith(
        `${HOST_A}: Nothing to remove; 1 already absent.`
      )
    );
    expect(toastMock.warning).not.toHaveBeenCalled();
  });

  it("a rowless 502 on a retry keeps the whole-machine counts beside the error", async () => {
    postAnswers = [
      answer([unbound(DEV_CI), failed(DEV_CI_2)]),
      json(502, { detail: "bad gateway" }),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    await screen.findByTestId("fleet-roles-remove-result");
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts).toHaveLength(2));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    const result = screen.getByTestId("fleet-roles-remove-result");
    expect(result.textContent).toContain(
      "1 of 2 bindings confirmed removed; 1 not reported by the route."
    );
    expect(
      within(result).getByTestId("fleet-roles-remove-may-have-applied")
        .textContent
    ).toBe(MAY_HAVE_APPLIED_TEXT);
    expect(
      within(result)
        .getAllByTestId("fleet-roles-remove-outcome-row")
        .map((r) => r.getAttribute("data-outcome"))
    ).toEqual(["removed", "unreported"]);
    expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toContain(
      "1 of 2 bindings confirmed removed; 1 not reported by the route."
    );
    expect(confirmButton().textContent).toBe(
      "Retry the 1 device row not confirmed removed"
    );
  });

  it("a mixed removed and already-absent answer on a still-listed machine gets the note and a warning", async () => {
    postAnswers = [answer([unbound(DEV_CI), absent(DEV_CI_2)])];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.queryByTestId("fleet-roles-remove-dialog")).toBeNull()
    );
    const sentence = `1 of 2 bindings removed; 1 already absent. ${STILL_LISTED_NOTE}`;
    expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe(
      sentence
    );
    expect(toastMock.warning).toHaveBeenCalledWith(
      `${CI_HOST_LABEL}: ${sentence}`
    );
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("a 422 retry over an earlier lost answer keeps 'may have been removed'", async () => {
    postAnswers = [
      answer([
        unbound(DEV_CI),
        {
          device_id: DEV_CI_2,
          outcome: "unknown",
          status: 504,
          error: { error: "coord_answer_lost", detail: "timed out" },
          still_member_via_pointer: null,
        },
      ]),
      json(422, { detail: "device_ids must be unique" }),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    await screen.findByTestId("fleet-roles-remove-result");
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts).toHaveLength(2));
    await waitFor(() => expect(confirmButton().disabled).toBe(false));
    const result = screen.getByTestId("fleet-roles-remove-result");
    expect(
      within(result).getByTestId("fleet-roles-remove-may-have-applied")
        .textContent
    ).toBe(MAY_HAVE_APPLIED_TEXT);
    expect(result.textContent).toContain(
      "1 of 2 bindings confirmed removed; 1 may have been removed (coord's answer was lost; reload to check)."
    );
  });
});
