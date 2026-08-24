/**
 * /admin/coord/agent-registry — the tenant-default admin surface.
 *
 * Phase 3 of plan
 * `2026-08-22-agent-registry-prefs-are-admin-only-and-the-tenant-default-has-no-ui`.
 *
 * ## What is pinned, and why each would go red
 *
 * 1. **The override count is on the row.** It is the number that makes the
 *    decision honest: a default most members have already contradicted reaches
 *    almost nobody when it changes. Dropping it turns
 *    `renders the override count` red.
 * 2. **The write is MINIMAL.** Coord's upsert is `COALESCE`-preserving and an
 *    earlier full-row shape is what once reset a seeded row's `purpose` and
 *    `fanout_bound`. `sends only the minimal body` fails the moment the page
 *    echoes the row back.
 * 3. **`policy_required` alone still sends `default_enabled`.** Coord makes it
 *    the one required field. Omitting it is a 422 in production, which no unit
 *    test of the page would otherwise catch.
 * 4. **A 403 is a page-level explanation, not an empty registry.** Rendering
 *    zero rows would state "this tenant has no agents", which is a claim.
 * 5. **Counts that have not been fetched render `–`, never `0`** (R6).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listAdminAgentRegistry = vi.fn();
const putAgentRegistryDefaults = vi.fn();

vi.mock("@/lib/api/agent-registry", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/agent-registry")
  >("@/lib/api/agent-registry");
  return {
    ...actual,
    listAdminAgentRegistry: (...a: unknown[]) => listAdminAgentRegistry(...a),
    putAgentRegistryDefaults: (...a: unknown[]) =>
      putAgentRegistryDefaults(...a),
  };
});

import { AgentPrefError } from "@/lib/api/agent-registry";
import CoordAgentRegistryPage from "./page";

function row(overrides: Record<string, unknown> = {}) {
  return {
    agent_name: "code-reviewer",
    purpose: "Reviews code changes.",
    trigger_condition: "before opening a PR",
    spawn_path: "in_session_subagent",
    model: null,
    effort: null,
    default_enabled: false,
    policy_required: true,
    allowed_dispositions: ["block", "degrade", "warn_proceed"],
    fanout_bound: 15,
    pref_count: 0,
    pref_differs_from_default_count: 0,
    ...overrides,
  };
}

describe("/admin/coord/agent-registry", () => {
  beforeEach(() => {
    listAdminAgentRegistry.mockReset();
    putAgentRegistryDefaults.mockReset();
    listAdminAgentRegistry.mockResolvedValue([row()]);
    putAgentRegistryDefaults.mockResolvedValue(undefined);
  });

  it("lists the raw registry rows with their tenant default", async () => {
    render(<CoordAgentRegistryPage />);
    const rowEl = await screen.findByTestId(
      "agent-registry-row-code-reviewer"
    );
    expect(within(rowEl).getByText("code-reviewer")).toBeInTheDocument();
    expect(within(rowEl).getByText("Off by default")).toBeInTheDocument();
    // `policy_required` is a claim about policy and must be visible.
    expect(within(rowEl).getByText("policy required")).toBeInTheDocument();
  });

  it("renders the override count on every row", async () => {
    listAdminAgentRegistry.mockResolvedValue([
      row({ pref_count: 4, pref_differs_from_default_count: 3 }),
    ]);
    render(<CoordAgentRegistryPage />);

    const badge = await screen.findByTestId(
      "agent-registry-overrides-code-reviewer"
    );
    expect(badge).toHaveTextContent("4 overrides");
    // The decision-relevant sentence, not just the number.
    expect(badge.getAttribute("title")).toMatch(
      /does not reach|contradict/i
    );
  });

  it("says so explicitly when nobody has overridden the default", async () => {
    render(<CoordAgentRegistryPage />);
    const badge = await screen.findByTestId(
      "agent-registry-overrides-code-reviewer"
    );
    // "no overrides" is a measured statement; a blank cell is not.
    expect(badge).toHaveTextContent("no overrides");
  });

  it("marks a contested default with the waiting accent, never red", async () => {
    listAdminAgentRegistry.mockResolvedValue([
      row({ pref_count: 2, pref_differs_from_default_count: 2 }),
    ]);
    render(<CoordAgentRegistryPage />);

    const rowEl = await screen.findByTestId(
      "agent-registry-row-code-reviewer"
    );
    expect(rowEl.getAttribute("data-attention")).toBe("waiting");
    expect(rowEl.className).toContain("border-l-amber-500/80");
    expect(rowEl.className).not.toContain("border-l-red");
  });

  it("sends only the minimal body when toggling the default", async () => {
    render(<CoordAgentRegistryPage />);
    const toggle = await screen.findByLabelText(
      "Default-enable code-reviewer"
    );
    await userEvent.click(toggle);

    await waitFor(() => expect(putAgentRegistryDefaults).toHaveBeenCalled());
    const [name, body] = putAgentRegistryDefaults.mock.calls[0];
    expect(name).toBe("code-reviewer");
    // Never a full row: coord's upsert preserves every field this omits, and
    // echoing them back is what once reset a seeded `purpose`/`fanout_bound`.
    expect(body).toEqual({ default_enabled: true });
    expect(Object.keys(body)).not.toContain("spawn_path");
    expect(Object.keys(body)).not.toContain("purpose");
  });

  it("sends the current default_enabled back when editing policy_required", async () => {
    render(<CoordAgentRegistryPage />);
    await userEvent.click(
      await screen.findByLabelText("Expand code-reviewer")
    );
    await userEvent.click(
      screen.getByTestId("agent-registry-toggle-policy-code-reviewer")
    );

    await waitFor(() => expect(putAgentRegistryDefaults).toHaveBeenCalled());
    // `default_enabled` is coord's ONE required field. Omitting it is a 422.
    expect(putAgentRegistryDefaults.mock.calls[0][1]).toEqual({
      default_enabled: false,
      policy_required: false,
    });
  });

  it("re-reads from the server after a save", async () => {
    render(<CoordAgentRegistryPage />);
    await waitFor(() =>
      expect(listAdminAgentRegistry).toHaveBeenCalledTimes(1)
    );
    listAdminAgentRegistry.mockResolvedValue([row({ default_enabled: true })]);
    await userEvent.click(screen.getByLabelText("Default-enable code-reviewer"));

    await waitFor(() =>
      expect(screen.getByText("On by default")).toBeInTheDocument()
    );
  });

  it("shows a save failure inline rather than reverting silently", async () => {
    putAgentRegistryDefaults.mockRejectedValue(new Error("coord said no"));
    render(<CoordAgentRegistryPage />);
    await userEvent.click(
      await screen.findByLabelText("Default-enable code-reviewer")
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("agent-registry-save-error-code-reviewer")
      ).toHaveTextContent("coord said no")
    );
  });

  it("a 403 explains the gate instead of rendering an empty registry", async () => {
    listAdminAgentRegistry.mockRejectedValue(
      new AgentPrefError("not_coord_tenant_admin", null, 403)
    );
    render(<CoordAgentRegistryPage />);

    await waitFor(() =>
      expect(
        screen.getByTestId("coord-agent-registry-forbidden")
      ).toBeInTheDocument()
    );
    // An empty list here would STATE that the tenant has no agents.
    expect(screen.queryByTestId("coord-agent-registry-empty")).toBeNull();
    expect(
      screen.getByText(/administrator-only/i)
    ).toBeInTheDocument();
  });

  it("a non-403 load failure keeps the retry affordance", async () => {
    listAdminAgentRegistry.mockRejectedValue(new Error("Failed to fetch"));
    render(<CoordAgentRegistryPage />);

    await waitFor(() =>
      expect(
        screen.getByTestId("coord-agent-registry-error")
      ).toHaveTextContent("Failed to fetch")
    );
    expect(screen.queryByTestId("coord-agent-registry-forbidden")).toBeNull();
  });

  it("filter tabs carry live counts", async () => {
    listAdminAgentRegistry.mockResolvedValue([
      row({ agent_name: "a", default_enabled: false }),
      row({
        agent_name: "b",
        default_enabled: true,
        pref_count: 1,
        pref_differs_from_default_count: 1,
      }),
    ]);
    render(<CoordAgentRegistryPage />);

    await waitFor(() =>
      expect(screen.getByTestId("agent-registry-filter-all")).toHaveTextContent(
        "2"
      )
    );
    expect(screen.getByTestId("agent-registry-filter-off")).toHaveTextContent(
      "1"
    );
    expect(
      screen.getByTestId("agent-registry-filter-contested")
    ).toHaveTextContent("1");
  });

  it("an unfetched count renders as an en dash, never 0 (R6)", async () => {
    // A promise that never settles: the pre-load state, held open.
    listAdminAgentRegistry.mockReturnValue(new Promise(() => {}));
    render(<CoordAgentRegistryPage />);

    expect(screen.getByTestId("agent-registry-filter-all")).toHaveTextContent(
      "–"
    );
    expect(screen.getByTestId("agent-registry-health")).toHaveTextContent(
      "agents –"
    );
  });

  it("the health strip is derived, and reports the contested count", async () => {
    listAdminAgentRegistry.mockResolvedValue([
      row({ agent_name: "a", pref_count: 2, pref_differs_from_default_count: 2 }),
      row({ agent_name: "b", default_enabled: true }),
    ]);
    render(<CoordAgentRegistryPage />);

    const strip = await screen.findByTestId("agent-registry-health");
    await waitFor(() =>
      expect(strip.getAttribute("data-health-level")).toBe("amber")
    );
    expect(strip).toHaveTextContent("overridden 1");
    expect(strip).toHaveTextContent("off by default 1");
    // R1 — derived from rows already on the page, never a second fetch.
    expect(listAdminAgentRegistry).toHaveBeenCalledTimes(1);
  });

  it("an empty registry says rows are created by seeding", async () => {
    listAdminAgentRegistry.mockResolvedValue([]);
    render(<CoordAgentRegistryPage />);

    await waitFor(() =>
      expect(
        screen.getByTestId("coord-agent-registry-empty")
      ).toHaveTextContent(/seeding/i)
    );
  });
});
