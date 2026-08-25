import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: vi.fn(),
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

// `vi.hoisted` because the sonner factory dereferences the object EAGERLY.
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { CiCapacityDisclosure } from "./CiCapacityDisclosure";
import type { CiCapacityJoin } from "./ciCapacity";
import {
  CI_NODE_DEFAULTS,
  type CiNodeConfigState,
  type Machine,
} from "@/services/devenv-api";

/**
 * The SECOND mount point of `CiNodeConfigPanel` — plan
 * `2026-08-25-coord-console-intent-and-devops-sections` Phase 2, verification
 * items 4 and 6.
 *
 * Two things are under test and they are different in kind:
 *
 *  1. **This is not a fork.** The Dev Ops mount holds no fetch of its own, no
 *     CI-node state of its own and no defaults of its own — it renders the one
 *     shared panel, which calls the one shared pair of API functions. That is
 *     the phase's central constraint, and the plan says a vet should be able
 *     to check it in the diff; these tests check it executably instead, both
 *     behaviourally (exactly one GET, exactly one PUT, both to the panel's own
 *     route) and structurally (the module's own source).
 *  2. **The consent UX is unchanged at this mount.** The panel's own gates —
 *     consequence before the toggle, no wildcard, nothing pre-filled friendlier
 *     than `CI_NODE_DEFAULTS` — are re-run HERE, because a second mount point
 *     is exactly where a surface like this quietly softens.
 */

const MACHINE: Machine = {
  id: "m-1",
  name: "workshop",
  hostname: "workshop.local",
  description: null,
  key_prefix: "mk_abc",
  enrolled: true,
  last_seen_at: "2026-08-25T10:00:00Z",
  revoked: false,
  environment_id: null,
  coord_device_id: "d-1",
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
};

const LINKED: CiCapacityJoin = { state: "linked", machine: MACHINE };

/** Every non-test file with this basename under `dir`, recursively. */
function findComponentCopies(dir: string, basename: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findComponentCopies(full, basename));
    } else if (entry.name === basename) {
      found.push(full);
    }
  }
  return found;
}

/** A never-configured machine: the runner's own posture, nothing friendlier. */
function state(overrides: Partial<CiNodeConfigState> = {}): CiNodeConfigState {
  return {
    machine_id: "m-1",
    coord_device_id: "d-1",
    requested: { ...CI_NODE_DEFAULTS },
    configured: false,
    requested_at: null,
    dispatched_at: null,
    reachability: "online",
    dispatched: null,
    dispatch_status: null,
    dispatch_error: null,
    dispatch_detail: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Render the disclosure and open it, returning once the panel has loaded. */
async function openDisclosure(join: CiCapacityJoin = LINKED) {
  const result = render(<CiCapacityDisclosure join={join} />);
  fireEvent.click(screen.getByRole("button", { name: /CI builds/i }));
  await screen.findByTestId("ci-node-panel");
  return result;
}

beforeEach(() => {
  fetchMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.warning.mockReset();
});

// ---------------------------------------------------------------------------
// One implementation, two mount points
// ---------------------------------------------------------------------------

describe("the Dev Ops mount is a mount, not a fork", () => {
  it("is collapsed on arrival and reads nothing until it is opened", async () => {
    // A consent surface must not be the first thing a hand lands on while
    // reading fleet telemetry — and collapsed means UNMOUNTED, so a closed row
    // costs no request at all.
    fetchMock.mockResolvedValue(jsonResponse(state()));
    render(<CiCapacityDisclosure join={LINKED} />);

    expect(screen.queryByTestId("ci-node-panel")).toBeNull();
    expect(screen.queryByTestId("ci-node-enabled")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /CI builds/i }));
    await screen.findByTestId("ci-node-panel");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not remember being open across mounts", () => {
    // Every other console panel persists its open/closed choice by
    // `storageKey`. This one deliberately does not: a persisted-open consent
    // control would be under the cursor on the next visit.
    fetchMock.mockResolvedValue(jsonResponse(state()));
    const first = render(<CiCapacityDisclosure join={LINKED} />);
    fireEvent.click(screen.getByRole("button", { name: /CI builds/i }));
    first.unmount();

    render(<CiCapacityDisclosure join={LINKED} />);
    expect(screen.queryByTestId("ci-node-panel")).toBeNull();
  });

  it("reads the config through the shared route, exactly once", async () => {
    fetchMock.mockResolvedValue(jsonResponse(state()));
    await openDisclosure();

    // ONE read, and it is the panel's own `getCiNodeConfig` — there is no
    // second fetch belonging to this mount.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/machines/m-1/ci-node");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("saves through `setCiNodeConfig` once, and nothing else", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(state()));
    await openDisclosure();

    fireEvent.click(screen.getByTestId("ci-node-enabled"));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        state({
          requested: { ...CI_NODE_DEFAULTS, enabled: true },
          configured: true,
          requested_at: "2026-08-25T11:00:00Z",
          dispatched_at: "2026-08-25T11:00:00Z",
          dispatched: true,
        })
      )
    );
    fireEvent.click(screen.getByTestId("ci-node-apply"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const puts = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "PUT"
    );
    expect(puts).toHaveLength(1);
    expect(String(puts[0][0])).toContain("/machines/m-1/ci-node");
    expect(JSON.parse(String((puts[0][1] as RequestInit).body))).toMatchObject({
      enabled: true,
    });
    // And no request this mount invented for itself.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("mounts the same component `/environments/machines` mounts", () => {
    // The plan's distinction, guarded: this is ONE implementation with two
    // mount points, unlike the `GatesPanel` / `/admin/coord/gates` pair, which
    // is two implementations over two backends. A second copy of the panel
    // would satisfy every behavioural test above and still be the fork.
    const root = join(__dirname, "..", "..");
    const here = readFileSync(
      join(__dirname, "CiCapacityDisclosure.tsx"),
      "utf8"
    );
    const environments = readFileSync(
      join(root, "app", "(app)", "environments", "machines", "page.tsx"),
      "utf8"
    );
    expect(here).toContain(
      'from "@/app/(app)/environments/_components/CiNodeConfigPanel"'
    );
    expect(environments).toContain('from "../_components/CiNodeConfigPanel"');
    // ...and there is exactly ONE such component under `src/`, so those two
    // specifiers cannot be naming different files.
    expect(findComponentCopies(root, "CiNodeConfigPanel.tsx")).toHaveLength(1);
  });

  it("holds no fetch, no config state and no defaults of its own", () => {
    // The structural half of the same claim, asserted on the module's source
    // because that is where the failure would appear: the moment this file
    // grows its own read, its own draft config or its own default posture,
    // the two mount points have forked and the phase has failed.
    const source = readFileSync(
      join(__dirname, "CiCapacityDisclosure.tsx"),
      "utf8"
    );
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

    expect(code).toContain("CiNodeConfigPanel");
    for (const forbidden of [
      "getCiNodeConfig",
      "setCiNodeConfig",
      "CI_NODE_DEFAULTS",
      "httpClient",
      "useState",
      "useEffect",
      "useReducer",
      "fetch(",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// Consent UX, unchanged at this mount (verification item 6)
// ---------------------------------------------------------------------------

describe("consent UX at the Dev Ops mount", () => {
  it("states the consequence BEFORE the toggle, in DOM order", async () => {
    fetchMock.mockResolvedValue(jsonResponse(state()));
    await openDisclosure();

    const consent = screen.getByTestId("ci-node-consent");
    const toggle = screen.getByTestId("ci-node-enabled");
    expect(consent.textContent).toMatch(/\.qontinui\/ci\.toml/);
    expect(consent.textContent).toMatch(/your hardware/i);
    // A consequence placed after the control is a justification, not a warning.
    expect(
      consent.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("pre-fills nothing friendlier than the runner's own defaults", async () => {
    fetchMock.mockResolvedValue(jsonResponse(state()));
    await openDisclosure();

    // The defaults themselves, restated so a friendlier edit to the constant
    // fails here too: off, empty allowlist, one build, 20 GiB floor.
    expect(CI_NODE_DEFAULTS).toEqual({
      enabled: false,
      max_concurrent_builds: 1,
      repo_allowlist: [],
      min_free_disk_gb: 20,
    });
    expect(screen.getByTestId("ci-node-enabled")).toHaveAttribute(
      "data-state",
      "unchecked"
    );
    expect(screen.getByTestId("ci-node-max-builds")).toHaveValue(
      CI_NODE_DEFAULTS.max_concurrent_builds
    );
    expect(screen.getByTestId("ci-node-min-disk")).toHaveValue(
      CI_NODE_DEFAULTS.min_free_disk_gb
    );
    expect(screen.getByTestId("ci-node-allowlist-empty").textContent).toMatch(
      /nothing can build/i
    );
    // Never configured from here => the runner's own file is untouched.
    expect(screen.getByTestId("ci-node-never-configured")).toBeTruthy();
  });

  it("accepts no wildcard and offers no bulk allow-all", async () => {
    fetchMock.mockResolvedValue(jsonResponse(state()));
    const { container } = await openDisclosure();

    fireEvent.change(screen.getByTestId("ci-node-repo-input"), {
      target: { value: "qontinui/*" },
    });
    fireEvent.click(screen.getByTestId("ci-node-repo-add"));
    expect(screen.getByTestId("ci-node-repo-error").textContent).toMatch(
      /no wildcard/i
    );
    expect(screen.queryByTestId("ci-node-allowlist-items")).toBeNull();

    for (const control of container.querySelectorAll("button")) {
      expect(control.textContent ?? "").not.toMatch(
        /allow all|all repos|everything|select all/i
      );
    }
  });

  it("keeps requested / sent / reachable as three separate facts", async () => {
    // The panel's central honesty property, re-asserted at this mount: an
    // offline machine renders saved-and-undelivered, never applied.
    fetchMock.mockResolvedValue(
      jsonResponse(
        state({
          reachability: "offline",
          configured: true,
          requested_at: "2026-08-25T11:00:00Z",
          dispatched_at: null,
        })
      )
    );
    await openDisclosure();

    expect(screen.getByTestId("ci-node-reachability")).toHaveAttribute(
      "data-reachability",
      "offline"
    );
    const delivery = screen.getByTestId("ci-node-delivery");
    expect(delivery.textContent).toMatch(/never successfully sent/i);
    expect(delivery.textContent).toMatch(/cannot read/i);
    expect(delivery.textContent).not.toMatch(/\bactive\b|\bin effect\b/i);
  });
});

// ---------------------------------------------------------------------------
// The join's un-linked cases (verification item 5, the Dev Ops direction)
// ---------------------------------------------------------------------------

describe("a row with no panel to show says which fact is missing", () => {
  it("explains an unlinked device and links to Environments — never a disabled toggle", () => {
    render(
      <CiCapacityDisclosure join={{ state: "no_machine", deviceId: "d-9" }} />
    );

    const notice = screen.getByTestId("ci-capacity-unavailable");
    expect(notice).toHaveAttribute("data-ci-capacity", "no_machine");
    expect(notice.textContent).toMatch(/no machine record/i);
    expect(notice.textContent).toMatch(/enrol it under/i);
    expect(screen.getByTestId("ci-capacity-environments-link")).toHaveAttribute(
      "href",
      "/environments/machines"
    );
    // A disabled toggle would read as "CI is off on this machine" — a claim
    // about the machine, where the truth is a gap in the join.
    expect(screen.queryByTestId("ci-node-enabled")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(document.querySelector("[disabled]")).toBeNull();
    expect(notice.textContent).not.toMatch(/\bCI is off\b|\bdisabled\b/i);
  });

  it("offers no panel when two machine records name the same device", () => {
    render(
      <CiCapacityDisclosure
        join={{
          state: "ambiguous",
          deviceId: "d-1",
          machines: [
            { ...MACHINE, id: "m-1", name: "left" },
            { ...MACHINE, id: "m-2", name: "right" },
          ],
        }}
      />
    );
    const notice = screen.getByTestId("ci-capacity-unavailable");
    expect(notice).toHaveAttribute("data-ci-capacity", "ambiguous");
    expect(notice.textContent).toContain("left");
    expect(notice.textContent).toContain("right");
    expect(screen.queryByTestId("ci-node-panel")).toBeNull();
  });

  it("says a row with no coord device has nothing to match on", () => {
    render(<CiCapacityDisclosure join={{ state: "no_device" }} />);
    const notice = screen.getByTestId("ci-capacity-unavailable");
    expect(notice).toHaveAttribute("data-ci-capacity", "no_device");
    expect(notice.textContent).toMatch(/no device id to match/i);
  });

  it("reports an unread roster as unknown, never as 'none is linked'", () => {
    render(
      <CiCapacityDisclosure
        join={{
          state: "unknown",
          reason: "The machine list could not be read: HTTP 502.",
        }}
      />
    );
    const notice = screen.getByTestId("ci-capacity-unavailable");
    expect(notice).toHaveAttribute("data-ci-capacity", "unknown");
    expect(notice.textContent).toContain("HTTP 502");
    expect(notice.textContent).toMatch(/not that none is/i);
    expect(notice.textContent).not.toMatch(/no machine record linked/i);
  });
});
