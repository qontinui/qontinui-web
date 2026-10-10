/**
 * EgressPanel — six rows, an UNKNOWN row on a failed read, and a write that
 * sends the tenant band (plan
 * `2026-10-10-spec-front-end-phase-9-generic-boundary` Phase 8 gate).
 *
 * The HTTP client is mocked rather than the hook, so the assertions cover the
 * real `useTenantFleetPolicyDial` read/write path the panel ships with.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const putMock = vi.fn();
const registered: {
  current: {
    actions: {
      id: string;
      effect?: string;
      handler: (p?: unknown) => unknown;
    }[];
  } | null;
} = {
  current: null,
};

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    put: (...args: unknown[]) => putMock(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@qontinui/ui-bridge", () => ({
  useUIComponent: (c: typeof registered.current) => {
    registered.current = c;
  },
}));

import { EgressPanel, egressLevelSource } from "./EgressPanel";
import { EGRESS_FLOWS } from "../types";

function view(domain: string, overrides: Record<string, unknown> = {}) {
  return {
    domain,
    effective_level: "on",
    master_enabled: true,
    resolved_scope: "none",
    can_edit: true,
    keys_not_shown: [],
    keys_not_shown_source: null,
    default_source: "product",
    ...overrides,
  };
}

function domainOf(url: string): string {
  return decodeURIComponent(url.split("domain=")[1] ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  registered.current = null;
});

describe("EgressPanel", () => {
  it("renders exactly six rows, one per egress domain, with level and source", async () => {
    getMock.mockImplementation(async (url: string) => {
      const domain = domainOf(url);
      if (domain === "egress_code_mirror") {
        return view(domain, {
          effective_level: "off",
          resolved_scope: "tenant",
          default_source: null,
        });
      }
      if (domain === "egress_telemetry") {
        return view(domain, {
          effective_level: "off",
          default_source: "deployment_profile",
        });
      }
      return view(domain);
    });
    render(<EgressPanel />);

    await waitFor(() =>
      expect(screen.getByTestId("egress-skill_mirror-level").textContent).toBe(
        "on"
      )
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(6);
    expect(EGRESS_FLOWS).toHaveLength(6);
    expect(
      new Set(getMock.mock.calls.map((c) => domainOf(c[0] as string)))
    ).toEqual(new Set(EGRESS_FLOWS.map((f) => f.domain)));

    expect(screen.getByTestId("egress-code_mirror-level").textContent).toBe(
      "off"
    );
    expect(screen.getByTestId("egress-code_mirror-source").textContent).toBe(
      "tenant choice"
    );
    expect(screen.getByTestId("egress-telemetry-source").textContent).toBe(
      "deployment default"
    );
    expect(
      screen.getByTestId("egress-transcript_sync-source").textContent
    ).toBe("product default");
    expect(screen.getByTestId("egress-telemetry-next-start")).toBeTruthy();
    expect(screen.queryByTestId("egress-code_mirror-next-start")).toBeNull();
  });

  it("renders a row whose read failed as unknown, never on, with its switch disabled", async () => {
    getMock.mockImplementation(async (url: string) => {
      const domain = domainOf(url);
      if (domain === "egress_terminal_stream")
        throw new Error("coord unreachable");
      return view(domain);
    });
    render(<EgressPanel />);

    await waitFor(() =>
      expect(screen.getByTestId("egress-terminal_stream-error")).toBeTruthy()
    );
    expect(screen.getByTestId("egress-terminal_stream-level").textContent).toBe(
      "unknown"
    );
    expect(screen.queryByTestId("egress-terminal_stream-source")).toBeNull();
    const sw = screen.getByTestId("egress-terminal_stream-switch");
    // No on/off state at all for an unread switch — not even "unchecked".
    expect(sw.getAttribute("data-state")).toBeNull();
    expect(sw.getAttribute("aria-checked")).toBeNull();
    expect(sw.getAttribute("aria-label")).toBe("Terminal streaming: unknown");
    expect(sw.getAttribute("role")).toBe("status");
    fireEvent.click(sw);
    expect(putMock).not.toHaveBeenCalled();
    // The other rows are unaffected.
    expect(screen.getByTestId("egress-code_mirror-level").textContent).toBe(
      "on"
    );
  });

  it("writes the flipped level at the tenant band, with the master on", async () => {
    getMock.mockImplementation(async (url: string) => view(domainOf(url)));
    putMock.mockImplementation(
      async (_url: string, body: Record<string, unknown>) => ({
        ok: true,
        domain: body.domain,
        written_level: body.level,
        written_master_enabled: true,
        versioned: true,
        version: 1,
        updated_by: "admin@example.com",
        effective: view(body.domain as string, {
          effective_level: body.level,
          resolved_scope: "tenant",
          default_source: null,
        }),
        readback_error: null,
      })
    );
    render(<EgressPanel />);

    await waitFor(() =>
      expect(
        screen.getByTestId("egress-code_mirror-switch").hasAttribute("disabled")
      ).toBe(false)
    );
    fireEvent.click(screen.getByTestId("egress-code_mirror-switch"));

    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    const [url, body] = putMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(url).toBe("/api/v1/operations/fleet-policy");
    expect(body).toMatchObject({
      domain: "egress_code_mirror",
      scope_band: "tenant",
      scope_key: null,
      level: "off",
      master_enabled: true,
    });
    await waitFor(() =>
      expect(screen.getByTestId("egress-code_mirror-source").textContent).toBe(
        "tenant choice"
      )
    );
    expect(screen.getByTestId("egress-code_mirror-level").textContent).toBe(
      "off"
    );
  });

  it("disables every switch for a non-admin", async () => {
    getMock.mockImplementation(async (url: string) =>
      view(domainOf(url), { can_edit: false })
    );
    render(<EgressPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("coord-tenant-egress-readonly")).toBeTruthy()
    );
    for (const f of EGRESS_FLOWS) {
      expect(
        screen.getByTestId(`egress-${f.flow}-switch`).hasAttribute("disabled")
      ).toBe(true);
    }
  });

  it("declares one write action per flow on the UI Bridge", async () => {
    getMock.mockImplementation(async (url: string) => view(domainOf(url)));
    putMock.mockResolvedValue({
      ok: true,
      domain: "egress_update_check",
      written_level: "off",
      written_master_enabled: true,
      versioned: true,
      version: 1,
      updated_by: null,
      effective: null,
      readback_error: "boom",
    });
    render(<EgressPanel />);
    await waitFor(() => expect(registered.current).not.toBeNull());
    const actions = registered.current!.actions;
    expect(actions.map((a) => a.id)).toEqual(
      EGRESS_FLOWS.map((f) => `set-egress-${f.flow}`)
    );
    expect(actions.every((a) => a.effect === "write")).toBe(true);

    const update = actions.find((a) => a.id === "set-egress-update_check")!;
    await expect(update.handler({ level: "maybe" })).rejects.toThrow();
    await expect(update.handler({ level: "off" })).resolves.toBe(true);
    expect(putMock.mock.calls[0][1]).toMatchObject({
      domain: "egress_update_check",
      scope_band: "tenant",
      level: "off",
    });
  });
});

describe("egressLevelSource", () => {
  it("names the source of every resolved shape and never guesses for a failed read", () => {
    const base = view("egress_code_mirror");
    expect(egressLevelSource(null)).toBeNull();
    expect(egressLevelSource({ ...base, resolved_scope: "tenant" })).toBe(
      "tenant choice"
    );
    expect(egressLevelSource({ ...base, resolved_scope: "system" })).toBe(
      "fleet-wide system row"
    );
    expect(
      egressLevelSource({ ...base, default_source: "deployment_profile" })
    ).toBe("deployment default");
    expect(egressLevelSource({ ...base, default_source: "product" })).toBe(
      "product default"
    );
    expect(egressLevelSource({ ...base, default_source: null })).toBe(
      "default (source not reported)"
    );
  });
});
