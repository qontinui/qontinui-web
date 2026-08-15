import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: vi.fn(),
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { AutoEnrollPolicyPanel, autoEnrollStatus } from "./AutoEnrollPolicyPanel";
import type { AutoEnrollPolicy, Environment } from "@/services/devenv-api";

/**
 * Tests for the auto-enrollment policy surface (plan
 * `2026-08-05-devenv-auto-enrollment-on-connection`, Phase 5).
 *
 * The load-bearing assertion is the `unresolved` one. The plan's Risks section
 * names "ambiguity is silent by default" as the failure this phase exists to
 * prevent, so a regression that renders "two environments, no target" as a
 * healthy "on" has to fail a test rather than merely look fine.
 */

function policy(overrides: Partial<AutoEnrollPolicy> = {}): AutoEnrollPolicy {
  return {
    enabled: true,
    target_environment_id: null,
    configured: false,
    effective_environment_id: null,
    environment_count: 0,
    updated_at: null,
    ...overrides,
  };
}

const ENVIRONMENTS: Environment[] = [
  {
    id: "env-1",
    owner_user_id: "u-1",
    organization_id: null,
    application_id: null,
    name: "Alpha",
    description: null,
    canonical_machine_id: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "env-2",
    owner_user_id: "u-1",
    organization_id: null,
    application_id: null,
    name: "Beta",
    description: null,
    canonical_machine_id: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  },
];

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe("autoEnrollStatus", () => {
  it("reports a disabled policy as off, whatever the target says", () => {
    const status = autoEnrollStatus(
      policy({
        enabled: false,
        environment_count: 2,
        effective_environment_id: "env-1",
      })
    );
    expect(status.kind).toBe("off");
    expect(status.tone).toBe("secondary");
  });

  it("names the ambiguous state instead of reporting a healthy 'on'", () => {
    // Two environments, no target: the engine skips EVERY new machine and only
    // logs. This must not read as success.
    const status = autoEnrollStatus(
      policy({
        enabled: true,
        environment_count: 2,
        effective_environment_id: null,
      })
    );
    expect(status.kind).toBe("unresolved");
    expect(status.tone).not.toBe("success");
    expect(status.message).toContain("2 environments");
    // The honest empty state says machines ARE being missed, and why.
    expect(status.message).toMatch(/skips|missed/);
    expect(status.action).not.toBeNull();
  });

  it("distinguishes 'no environments at all' from 'no target chosen'", () => {
    const status = autoEnrollStatus(
      policy({
        enabled: true,
        environment_count: 0,
        effective_environment_id: null,
      })
    );
    expect(status.kind).toBe("no_environments");
    expect(status.action).toContain("Create an environment");
  });

  it("reports a resolvable policy as active", () => {
    const status = autoEnrollStatus(
      policy({
        enabled: true,
        environment_count: 1,
        effective_environment_id: "env-1",
      })
    );
    expect(status.kind).toBe("active");
    expect(status.tone).toBe("success");
    expect(status.action).toBeNull();
  });

  it("treats a single environment as resolved even with no stated target", () => {
    // The shipped auto-bind rule: one environment needs no choice.
    const status = autoEnrollStatus(
      policy({
        enabled: true,
        target_environment_id: null,
        environment_count: 1,
        effective_environment_id: "env-1",
      })
    );
    expect(status.kind).toBe("active");
  });
});

describe("AutoEnrollPolicyPanel", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it("surfaces the ambiguous state in the rendered panel", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        policy({
          enabled: true,
          environment_count: 2,
          effective_environment_id: null,
        })
      )
    );

    render(<AutoEnrollPolicyPanel environments={ENVIRONMENTS} />);

    await waitFor(() =>
      expect(screen.getByTestId("auto-enroll-panel")).toBeInTheDocument()
    );
    expect(screen.getByTestId("auto-enroll-panel")).toHaveAttribute(
      "data-status",
      "unresolved"
    );
    expect(screen.getByTestId("auto-enroll-status-badge")).toHaveTextContent(
      "no target set"
    );
    expect(screen.getByTestId("auto-enroll-status-action")).toBeInTheDocument();
  });

  it("does not claim the policy is off when it could not be read", async () => {
    // A failed read is UNKNOWN. Rendering it as "off" would be a reassuring
    // claim about the server we have no evidence for.
    fetchMock.mockRejectedValue(new Error("network down"));

    render(<AutoEnrollPolicyPanel environments={ENVIRONMENTS} />);

    await waitFor(() =>
      expect(screen.getByTestId("auto-enroll-load-error")).toBeInTheDocument()
    );
    expect(screen.queryByTestId("auto-enroll-panel")).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing has been changed/)).toBeInTheDocument();
  });
});
