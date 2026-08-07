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
  httpClient: {
    get: vi.fn(),
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

// `vi.hoisted` because the sonner factory dereferences the object EAGERLY
// (`toast: toastMock`), unlike the httpClient factory above whose arrow
// function defers until call time.
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import {
  CiNodeConfigPanel,
  configsEqual,
  reachabilityCopy,
  validateRepoEntry,
} from "./CiNodeConfigPanel";
import type { CiNodeConfigState, Machine } from "@/services/devenv-api";

/**
 * Tests for the per-machine CI-node consent surface (plan
 * `2026-08-07-runner-local-ci-parity-and-web-configuration`, Phase 4).
 *
 * The assertions here are the plan's UX GATES expressed executably, not
 * decoration. An option that fails one of them is rejected even if it wins on
 * power, so each gate gets a test that would fail if the gate were softened:
 * the consequence must precede the toggle; there must be no bulk allow-all;
 * allowlisting must be per-repo and reversible; and a device that cannot
 * receive the settings must be rendered as such rather than as applied.
 */

const MACHINE: Machine = {
  id: "m-1",
  name: "workshop",
  hostname: "workshop.local",
  description: null,
  key_prefix: "mk_abc",
  enrolled: true,
  last_seen_at: "2026-08-07T10:00:00Z",
  revoked: false,
  environment_id: null,
  coord_device_id: "d-1",
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
};

function state(overrides: Partial<CiNodeConfigState> = {}): CiNodeConfigState {
  return {
    machine_id: "m-1",
    coord_device_id: "d-1",
    requested: {
      enabled: false,
      max_concurrent_builds: 1,
      repo_allowlist: [],
      min_free_disk_gb: 20,
    },
    configured: false,
    requested_at: null,
    dispatched_at: null,
    reachability: "online",
    dispatched: null,
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

beforeEach(() => {
  fetchMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.warning.mockReset();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("validateRepoEntry", () => {
  it("rejects a wildcard with its own message, not a generic format error", () => {
    // The point of the dedicated message: someone reaching for "allow
    // everything" is told the affordance does not exist, rather than guessing
    // at a pattern until something is accepted.
    expect(validateRepoEntry("*", [])).toMatch(/no wildcard/i);
    expect(validateRepoEntry("qontinui/*", [])).toMatch(/no wildcard/i);
    expect(validateRepoEntry("all", [])).toMatch(/no wildcard/i);
  });

  it("accepts `owner/name` and a bare repo name — the runner's two forms", () => {
    expect(validateRepoEntry("qontinui/qontinui-web", [])).toBeNull();
    expect(validateRepoEntry("qontinui-web", [])).toBeNull();
  });

  it("rejects empties, junk and duplicates", () => {
    expect(validateRepoEntry("   ", [])).toBeTruthy();
    expect(validateRepoEntry("owner/name/extra", [])).toBeTruthy();
    expect(validateRepoEntry("owner name", [])).toBeTruthy();
    expect(validateRepoEntry("a/b", ["a/b"])).toMatch(/already/i);
  });
});

describe("reachabilityCopy", () => {
  it("keeps `unknown` distinct from `offline`", () => {
    // "we could not ask coord" is a statement about qontinui.io; "the device is
    // not connected" is a statement about the machine. Collapsing them would
    // assert something about the machine on no evidence.
    expect(reachabilityCopy("unknown").message).toMatch(/could not check/i);
    expect(reachabilityCopy("offline").message).toMatch(/not connected/i);
    expect(reachabilityCopy("unknown").badge).not.toEqual(
      reachabilityCopy("offline").badge
    );
  });
});

describe("configsEqual", () => {
  const base = {
    enabled: false,
    max_concurrent_builds: 1,
    repo_allowlist: ["a/b"],
    min_free_disk_gb: 20,
  };

  it("is true for an identical config and false for any single change", () => {
    expect(configsEqual(base, { ...base })).toBe(true);
    expect(configsEqual(base, { ...base, enabled: true })).toBe(false);
    expect(configsEqual(base, { ...base, repo_allowlist: [] })).toBe(false);
    expect(configsEqual(base, { ...base, min_free_disk_gb: 21 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

describe("CiNodeConfigPanel", () => {
  it("states the consequence BEFORE the toggle, in the DOM order a reader follows", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(state()));
    const { container } = render(<CiNodeConfigPanel machine={MACHINE} />);

    const consent = await screen.findByTestId("ci-node-consent");
    const toggle = screen.getByTestId("ci-node-enabled");

    // Naming what the consent copy must actually say — that the repo, not
    // qontinui.io, supplies the commands, and that they run on this machine.
    expect(consent.textContent).toMatch(/run on/i);
    expect(consent.textContent).toMatch(/\.qontinui\/ci\.toml/);
    expect(consent.textContent).toMatch(/your hardware/i);

    // DOCUMENT_POSITION_FOLLOWING: the toggle comes after the consent block.
    // A consequence placed after the control is a justification, not a warning.
    expect(
      consent.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it("ships off with an empty allowlist and says an empty list runs nothing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(state()));
    render(<CiNodeConfigPanel machine={MACHINE} />);

    const toggle = await screen.findByTestId("ci-node-enabled");
    expect(toggle).toHaveAttribute("data-state", "unchecked");
    expect(screen.getByTestId("ci-node-allowlist-empty").textContent).toMatch(
      /nothing can build/i
    );
    // Never configured from here => the runner's own file is untouched, and
    // the panel says so rather than implying it enforced "off".
    expect(screen.getByTestId("ci-node-never-configured")).toBeTruthy();
  });

  it("offers no bulk allow-all affordance anywhere in the panel", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        state({
          requested: {
            enabled: true,
            max_concurrent_builds: 2,
            repo_allowlist: ["qontinui/qontinui-web"],
            min_free_disk_gb: 20,
          },
          configured: true,
        })
      )
    );
    render(<CiNodeConfigPanel machine={MACHINE} />);
    const panel = await screen.findByTestId("ci-node-panel");

    // No control whose accessible name promises everything at once.
    for (const control of within(panel).queryAllByRole("button")) {
      expect(control.textContent ?? "").not.toMatch(
        /allow all|all repos|everything|select all/i
      );
    }
    // And the input path refuses a wildcard rather than quietly storing one.
    fireEvent.change(screen.getByTestId("ci-node-repo-input"), {
      target: { value: "*" },
    });
    fireEvent.click(screen.getByTestId("ci-node-repo-add"));
    expect(screen.getByTestId("ci-node-repo-error").textContent).toMatch(
      /no wildcard/i
    );
    expect(
      within(screen.getByTestId("ci-node-allowlist-items")).getAllByRole(
        "listitem"
      )
    ).toHaveLength(1);
  });

  it("adds a repo one at a time and removes it again", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(state()));
    render(<CiNodeConfigPanel machine={MACHINE} />);
    await screen.findByTestId("ci-node-panel");

    fireEvent.change(screen.getByTestId("ci-node-repo-input"), {
      target: { value: " qontinui/qontinui-web " },
    });
    fireEvent.click(screen.getByTestId("ci-node-repo-add"));

    const items = screen.getByTestId("ci-node-allowlist-items");
    expect(within(items).getAllByRole("listitem")).toHaveLength(1);
    expect(items.textContent).toContain("qontinui/qontinui-web");

    // Reversible without a surprise: one entry out, no confirmation theatre,
    // and nothing is sent to the machine until Apply.
    fireEvent.click(
      screen.getByTestId("ci-node-repo-remove-qontinui/qontinui-web")
    );
    expect(screen.getByTestId("ci-node-allowlist-empty")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders an offline device as undelivered, never as applied", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        state({
          reachability: "offline",
          configured: true,
          requested_at: "2026-08-07T11:00:00Z",
          dispatched_at: null,
        })
      )
    );
    render(<CiNodeConfigPanel machine={MACHINE} />);

    const banner = await screen.findByTestId("ci-node-reachability");
    expect(banner).toHaveAttribute("data-reachability", "offline");
    expect(banner.textContent).toMatch(/not connected/i);

    const delivery = screen.getByTestId("ci-node-delivery");
    expect(delivery.textContent).toMatch(/never successfully sent/i);
    expect(delivery.textContent).toMatch(/cannot read/i);
    // The strong word is never used about an undelivered config.
    expect(delivery.textContent).not.toMatch(/\bactive\b|\bin effect\b/i);
  });

  it("reports a rejected dispatch as saved-but-not-delivered", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(state()));
    render(<CiNodeConfigPanel machine={MACHINE} />);
    await screen.findByTestId("ci-node-panel");

    fireEvent.click(screen.getByTestId("ci-node-enabled"));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        state({
          requested: {
            enabled: true,
            max_concurrent_builds: 1,
            repo_allowlist: [],
            min_free_disk_gb: 20,
          },
          configured: true,
          requested_at: "2026-08-07T11:00:00Z",
          dispatched: false,
          dispatch_detail: "coord rejected the dispatch (HTTP 404)",
        })
      )
    );
    fireEvent.click(screen.getByTestId("ci-node-apply"));

    await waitFor(() =>
      expect(
        screen.getByTestId("ci-node-dispatch-detail").textContent
      ).toContain("coord rejected the dispatch (HTTP 404)")
    );
    // A warning, not a success: the save happened, the delivery did not.
    expect(toastMock.warning).toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toMatchObject({ enabled: true });
  });

  it("does not present a failed load as 'CI is off here'", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { detail: { code: "boom", message: "coord is not reachable" } },
        502
      )
    );
    render(<CiNodeConfigPanel machine={MACHINE} />);

    const err = await screen.findByTestId("ci-node-load-error");
    expect(err.textContent).toMatch(/couldn't load/i);
    expect(err.textContent).toContain("coord is not reachable");
    // No toggle at all — an unreadable state must not be drawn as a readable one.
    expect(screen.queryByTestId("ci-node-enabled")).toBeNull();
  });
});
