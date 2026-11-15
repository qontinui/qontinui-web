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
  LIVENESS_UNKNOWN_TEXT,
  LISTING_NOT_SERVED,
  STILL_LISTED_TEXT,
  confirmPhraseFor,
  isLastCiHost,
  removalRows,
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
let postAnswers: Array<ReturnType<typeof json>>;
let gets: number;

function serve() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/fleet/devices/unbind")) {
      posts.push(
        (JSON.parse(String(init.body)) as { device_ids: string[] }).device_ids
      );
      return postAnswers.shift() ?? json(500, { detail: "unexpected" });
    }
    gets += 1;
    return json(200, { state: "known", roles_table: "present", machines });
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
  fetchMock.mockReset();
  toastMock.success.mockReset();
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
    expect(isLastCiHost([only], only)).toBe(true);
    const other = readMachine(
      ciHost({
        machine_key: "host:other-ci",
        ci_host_name: "other-ci",
        name: "other-ci",
        device_ids: [DEV_CI_OTHER],
      })
    );
    expect(isLastCiHost([only, other], only)).toBe(false);
    const ws = readMachine(workstation());
    expect(isLastCiHost([ws], ws)).toBe(false);
  });

  it("an answer that omits a sent id reports it unreported, not removed", () => {
    const s = summarizeUnbind([DEV_CI, DEV_CI_2], {
      results: [unbound(DEV_CI)],
      unbound: 1,
      already_absent: 0,
      failed: 0,
    } as never);
    expect(s.sentence).toBe(
      "1 of 2 rows removed; 1 not reported by the route."
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
      `${CI_HOST_LABEL}: 2 of 2 rows removed.`
    );
    expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe(
      "2 of 2 rows removed."
    );
    await waitFor(() => expect(gets).toBeGreaterThan(before));
  });

  it("a partial removal says partial, keeps the dialog open with coord's refusal, and never toasts", async () => {
    postAnswers = [answer([unbound(DEV_CI), failed(DEV_CI_2)])];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(result.textContent).toContain("1 of 2 rows removed; 1 failed.");
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
    expect(result.textContent).toContain("0 of 2 rows removed; 2 failed.");
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
      "Coord refused the removal (HTTP 401): only an operator of this tenant may remove a machine from it. Nothing was removed."
    );
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("a 403 after the first id keeps the rows already answered", async () => {
    postAnswers = [
      json(403, {
        detail: {
          error: "operator_principal_required",
          results: [unbound(DEV_CI)],
        },
      }),
    ];
    render(<FleetRolesSection />);
    await openRemoval(CI_HOST_LABEL);
    fireEvent.click(confirmButton());
    const result = await screen.findByTestId("fleet-roles-remove-result");
    expect(result.textContent).toContain(
      "The batch stopped there; the rows below were already answered."
    );
    expect(result.textContent).toContain(
      "1 of 2 rows removed; 1 not reported by the route."
    );
  });

  it("still_member_via_pointer true is still listed, never removed", async () => {
    machines = [workstation({ heartbeat_fresh: false })];
    postAnswers = [answer([unbound(DEV_A, true)])];
    render(<FleetRolesSection />);
    await openRemoval(HOST_A);
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(screen.getByTestId("fleet-roles-remove-ack").textContent).toBe(
        "0 of 1 row removed; 1 binding removed; still listed through its home tenant, which only its owner can change on /runners."
      )
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
        "0 of 1 row removed; 1 binding removed; coord did not report whether it is still listed through its home tenant."
      )
    );
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
        "0 of 1 row removed; 1 already absent."
      )
    );
    expect(posts).toEqual([[DEV_A], [DEV_A]]);
  });
});
