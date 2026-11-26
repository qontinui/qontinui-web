/**
 * /admin/coord/agent-registry — the catalog and the tenant-admin spawn switch.
 *
 * Phase 7 of plan
 * `2026-11-24-tenant-admins-switch-agent-spawns-off-per-agent-type`.
 *
 * What is pinned, and what would go red:
 *
 * 1. **A type with no row is listed and switchable.** Rendering rows only (the
 *    page before this phase) turns `lists an unrowed type…` red.
 * 2. **The switch acknowledges itself** — in flight, done, failed with coord's
 *    own reason — and re-reads the catalog after the write. A switch driven by
 *    local optimism, or a failure flattened to "failed", reddens the switch
 *    tests.
 * 3. **The switch is labelled apart from the default.** Both exist on a rowed
 *    line, under different names.
 * 4. **A policy-required type picks its disposition from the row's own set.**
 * 5. **An unread source is an UNKNOWN banner**, and an unread catalog leaves
 *    every switch Unknown, never On.
 * 6. **Add-by-name lowercases and checks coord's grammar** before any write.
 * 7. **The enforcement reach is stated** — an Agent-tool subagent is labelled
 *    advisory outside hooked sessions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const listAdminAgentRegistry = vi.fn();
const putAgentRegistryDefaults = vi.fn();
const getAgentCatalog = vi.fn();
const putAgentAdminSwitch = vi.fn();

vi.mock("@/lib/api/agent-registry", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/agent-registry")
  >("@/lib/api/agent-registry");
  return {
    ...actual,
    listAdminAgentRegistry: (...a: unknown[]) => listAdminAgentRegistry(...a),
    putAgentRegistryDefaults: (...a: unknown[]) =>
      putAgentRegistryDefaults(...a),
    getAgentCatalog: (...a: unknown[]) => getAgentCatalog(...a),
    putAgentAdminSwitch: (...a: unknown[]) => putAgentAdminSwitch(...a),
  };
});

vi.mock("./_components/RepoFollowupDialsPanel", () => ({
  RepoFollowupDialsPanel: () => null,
}));

import { AgentAdminSwitchError } from "@/lib/api/agent-registry";
import CoordAgentRegistryPage from "./page";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    agent_name: "triage-judge",
    has_row: false,
    spawn_path: "in_session_subagent",
    purpose: "Judges one triage page.",
    sources: [
      {
        source: "declared_role",
        repo: "qontinui/qontinui-claude-config",
        sha: "abc123",
        path: ".claude/agents/triage-judge.md",
      },
    ],
    admin_disabled: false,
    admin_disposition: null,
    admin_reason: null,
    default_enabled: true,
    policy_required: false,
    allowed_dispositions: ["block", "degrade", "warn_proceed"],
    enforcement: "hook",
    ...overrides,
  };
}

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
    allowed_dispositions: ["block", "degrade"],
    fanout_bound: 15,
    pref_count: 0,
    pref_differs_from_default_count: 0,
    ...overrides,
  };
}

const rowedEntry = entry({
  agent_name: "code-reviewer",
  has_row: true,
  sources: [{ source: "row" }],
  default_enabled: false,
  policy_required: true,
  allowed_dispositions: ["block", "degrade"],
});

function catalog(agents: unknown[], sources_unread: unknown[] = []) {
  return { agents, sources_unread, declared_skipped: [] };
}

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const spawnSwitch = (name: string) =>
  screen.findByRole("switch", { name: `Spawns of ${name}` });

beforeEach(() => {
  listAdminAgentRegistry.mockReset();
  putAgentRegistryDefaults.mockReset();
  getAgentCatalog.mockReset();
  putAgentAdminSwitch.mockReset();
  listAdminAgentRegistry.mockResolvedValue([row()]);
  getAgentCatalog.mockResolvedValue(catalog([entry(), rowedEntry]));
  putAgentAdminSwitch.mockResolvedValue({
    agent: {},
    effective: {},
    created: true,
  });
});

describe("/admin/coord/agent-registry — the catalog", () => {
  it("lists an unrowed type as 'no registry row — default: on' with its sources", async () => {
    render(<CoordAgentRegistryPage />);
    const line = await screen.findByTestId("agent-registry-row-triage-judge");
    expect(line).toHaveAttribute("data-has-row", "false");
    expect(
      within(line).getByTestId("agent-registry-source-triage-judge-no-row")
    ).toHaveTextContent("no registry row — default: on");
    expect(
      within(line).getByText("declared in qontinui/qontinui-claude-config")
    ).toBeInTheDocument();
    // No row means no tenant-default toggle to show.
    expect(screen.queryByLabelText("Default-enable triage-judge")).toBeNull();
    expect(await spawnSwitch("triage-judge")).toBeEnabled();
  });

  it("labels the spawn switch apart from the default on a rowed type", async () => {
    render(<CoordAgentRegistryPage />);
    const line = await screen.findByTestId("agent-registry-row-code-reviewer");
    expect(within(line).getByText("Default for members")).toBeInTheDocument();
    expect(within(line).getByText("Spawns:")).toBeInTheDocument();
    expect(
      within(line).getByLabelText("Default-enable code-reviewer")
    ).toBeInTheDocument();
    expect(
      within(line).getByRole("switch", { name: "Spawns of code-reviewer" })
    ).toBeInTheDocument();
  });

  it.each([
    ["harness_builtin", "built-in"],
    ["contract_kind", "spawn kind/class"],
    ["contract_class", "spawn kind/class"],
  ])("renders a %s source as '%s'", async (kind, label) => {
    getAgentCatalog.mockResolvedValue(
      catalog([entry({ agent_name: "explore", sources: [{ source: kind }] })])
    );
    render(<CoordAgentRegistryPage />);
    const line = await screen.findByTestId("agent-registry-row-explore");
    expect(within(line).getByText(label)).toBeInTheDocument();
  });

  it("states the hook-enforced reach as advisory outside hooked sessions", async () => {
    render(<CoordAgentRegistryPage />);
    const badge = await screen.findByTestId(
      "agent-registry-enforcement-triage-judge"
    );
    expect(badge).toHaveTextContent("hook-enforced; advisory elsewhere");
    expect(badge.getAttribute("title")).toBe(
      "Enforced in sessions running the Qontinui hook set; advisory elsewhere."
    );
  });

  it("appends coord's enforcement_note, and tolerates its absence", async () => {
    getAgentCatalog.mockResolvedValue(
      catalog([
        entry(),
        entry({
          agent_name: "gate_continuation",
          enforcement: "coord",
          enforcement_note: "Kind rows veto authorize_and_publish_spawn.",
        }),
      ])
    );
    render(<CoordAgentRegistryPage />);
    const coord = await screen.findByTestId(
      "agent-registry-enforcement-gate_continuation"
    );
    expect(coord.getAttribute("title")).toContain(
      "Kind rows veto authorize_and_publish_spawn."
    );
    expect(
      screen
        .getByTestId("agent-registry-enforcement-triage-judge")
        .getAttribute("title")
    ).not.toContain("undefined");
  });

  it("renders each unread source as an UNKNOWN banner", async () => {
    getAgentCatalog.mockResolvedValue(
      catalog(
        [entry()],
        [{ source: "declared_role", reason: "mirror read failed" }]
      )
    );
    render(<CoordAgentRegistryPage />);
    const banner = await screen.findByTestId(
      "agent-catalog-source-unread-declared_role"
    );
    expect(banner).toHaveTextContent(/^UNKNOWN:/);
    expect(banner).toHaveTextContent("mirror read failed");
  });

  it("an unread catalog leaves every switch Unknown and disabled, never On", async () => {
    getAgentCatalog.mockRejectedValue(new Error("Failed to fetch"));
    render(<CoordAgentRegistryPage />);
    const sw = await spawnSwitch("code-reviewer");
    expect(sw).toBeDisabled();
    expect(
      screen.getByTestId("agent-spawn-switch-label-code-reviewer")
    ).toHaveTextContent("Unknown");
    expect(screen.getByTestId("agent-catalog-load-error")).toHaveTextContent(
      /UNKNOWN/
    );
    expect(
      screen.getByTestId("agent-registry-filter-spawns-off")
    ).toHaveTextContent("–");
  });
});

describe("/admin/coord/agent-registry — the spawn switch", () => {
  it("switching off confirms, writes the ceiling, and re-reads the catalog", async () => {
    render(<CoordAgentRegistryPage />);
    await userEvent.click(await spawnSwitch("triage-judge"));
    // Not written yet: the confirmation is the decision.
    expect(putAgentAdminSwitch).not.toHaveBeenCalled();
    await userEvent.type(
      screen.getByLabelText("Reason for switching off triage-judge"),
      "too noisy"
    );
    const reads = getAgentCatalog.mock.calls.length;
    getAgentCatalog.mockResolvedValue(
      catalog([entry({ admin_disabled: true, has_row: true }), rowedEntry])
    );
    await userEvent.click(
      screen.getByTestId("agent-spawn-switch-confirm-off-triage-judge")
    );

    expect(putAgentAdminSwitch).toHaveBeenCalledWith("triage-judge", {
      disabled: true,
      reason: "too noisy",
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("agent-spawn-switch-status-triage-judge")
      ).toHaveAttribute("data-phase", "done")
    );
    expect(getAgentCatalog.mock.calls.length).toBeGreaterThan(reads);
    // The switch shows what the RE-READ serves.
    expect(
      screen.getByTestId("agent-spawn-switch-label-triage-judge")
    ).toHaveTextContent("Off");
  });

  it("shows the write in flight, with the switch disabled", async () => {
    const held = deferred<unknown>();
    putAgentAdminSwitch.mockImplementationOnce(() => held.promise);
    getAgentCatalog.mockResolvedValue(
      catalog([entry({ admin_disabled: true, has_row: true })])
    );
    render(<CoordAgentRegistryPage />);
    await userEvent.click(await spawnSwitch("triage-judge"));

    const status = await screen.findByTestId(
      "agent-spawn-switch-status-triage-judge"
    );
    expect(status).toHaveAttribute("data-phase", "in_flight");
    expect(status).toHaveTextContent("Switching spawns back on…");
    expect(await spawnSwitch("triage-judge")).toBeDisabled();
    // Switching back ON needs no confirmation.
    expect(putAgentAdminSwitch).toHaveBeenCalledWith("triage-judge", {
      disabled: false,
    });
    await act(async () => {
      held.resolve({ agent: {}, effective: {}, created: false });
    });
  });

  it("a refusal says coord's own reason and leaves the switch on what is served", async () => {
    putAgentAdminSwitch.mockRejectedValueOnce(
      new AgentAdminSwitchError(
        "`warn_proceed` is not in [block, degrade]",
        "disposition_not_allowed",
        422,
        true
      )
    );
    render(<CoordAgentRegistryPage />);
    await userEvent.click(await spawnSwitch("triage-judge"));
    await userEvent.click(
      screen.getByTestId("agent-spawn-switch-confirm-off-triage-judge")
    );

    const status = await screen.findByTestId(
      "agent-spawn-switch-status-triage-judge"
    );
    await waitFor(() => expect(status).toHaveAttribute("data-phase", "failed"));
    expect(status).toHaveTextContent(
      "Not saved: That disposition is not allowed for this agent — `warn_proceed` is not in [block, degrade]"
    );
    expect(
      screen.getByTestId("agent-spawn-switch-label-triage-judge")
    ).toHaveTextContent("On");
  });

  it("an outcome that may have landed is UNKNOWN until a re-read", async () => {
    putAgentAdminSwitch.mockRejectedValueOnce(
      new AgentAdminSwitchError("timeout waiting for coord", null, 504, true)
    );
    render(<CoordAgentRegistryPage />);
    await userEvent.click(await spawnSwitch("triage-judge"));
    await userEvent.click(
      screen.getByTestId("agent-spawn-switch-confirm-off-triage-judge")
    );

    const status = await screen.findByTestId(
      "agent-spawn-switch-status-triage-judge"
    );
    await waitFor(() =>
      expect(status).toHaveTextContent("What is shown is a read made after it.")
    );
    expect(status).toHaveAttribute("data-phase", "unknown");
    expect(status).toHaveTextContent(
      "Whether this change was applied is unknown (timeout waiting for coord)."
    );
  });

  it("a policy-required type offers only the row's allowed dispositions", async () => {
    getAgentCatalog.mockResolvedValue(catalog([rowedEntry]));
    render(<CoordAgentRegistryPage />);
    await userEvent.click(await spawnSwitch("code-reviewer"));

    const panel = screen.getByTestId(
      "agent-spawn-switch-confirm-code-reviewer"
    );
    const radios = within(panel).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(within(panel).getByText("Block")).toBeInTheDocument();
    expect(within(panel).getByText("Degrade to inline")).toBeInTheDocument();
    expect(within(panel).queryByText("Warn & proceed")).toBeNull();

    await userEvent.click(within(panel).getByText("Block"));
    await userEvent.click(
      screen.getByTestId("agent-spawn-switch-confirm-off-code-reviewer")
    );
    expect(putAgentAdminSwitch).toHaveBeenCalledWith("code-reviewer", {
      disabled: true,
      disposition: "block",
    });
  });

  it("an unrowed type is not asked for a disposition", async () => {
    render(<CoordAgentRegistryPage />);
    await userEvent.click(await spawnSwitch("triage-judge"));
    const panel = screen.getByTestId("agent-spawn-switch-confirm-triage-judge");
    expect(within(panel).queryAllByRole("radio")).toHaveLength(0);
  });

  it("the expanded detail says who switched it off, when, why and how", async () => {
    listAdminAgentRegistry.mockResolvedValue([
      row({
        admin_disposition: "block",
        admin_reason: "too costly",
        admin_disabled_by: "admin@example.com",
        admin_disabled_at: "2026-11-25T00:00:00Z",
      }),
    ]);
    getAgentCatalog.mockResolvedValue(
      catalog([
        {
          ...rowedEntry,
          admin_disabled: true,
          admin_disposition: "block",
          admin_reason: "too costly",
        },
      ])
    );
    render(<CoordAgentRegistryPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Expand code-reviewer" })
    );
    const detail = screen.getByTestId(
      "agent-registry-admin-detail-code-reviewer"
    );
    expect(detail).toHaveTextContent("by admin@example.com");
    expect(detail).toHaveTextContent("disposition: block");
    expect(detail).toHaveTextContent("reason: too costly");
  });

  it("the spawns-off filter counts switched-off types", async () => {
    getAgentCatalog.mockResolvedValue(
      catalog([entry(), { ...rowedEntry, admin_disabled: true }])
    );
    render(<CoordAgentRegistryPage />);
    await waitFor(() =>
      expect(
        screen.getByTestId("agent-registry-filter-spawns-off")
      ).toHaveTextContent("1")
    );
  });
});

describe("/admin/coord/agent-registry — a rows read that never answered", () => {
  it("leaves every switch disabled: the reader's role is unknown, never admin", async () => {
    listAdminAgentRegistry.mockRejectedValue(new Error("502 Bad Gateway"));
    render(<CoordAgentRegistryPage />);
    for (const name of ["triage-judge", "code-reviewer"]) {
      expect(await spawnSwitch(name)).toBeDisabled();
      expect(screen.getByTestId(`agent-spawn-switch-${name}`)).toHaveAttribute(
        "title",
        expect.stringMatching(/unknown/)
      );
    }
    expect(screen.queryByTestId("agent-registry-add-by-name")).toBeNull();
  });
});

describe("/admin/coord/agent-registry — a type whose policy_required nobody states", () => {
  it("cannot be switched off, since whether it needs a disposition is unknown", async () => {
    listAdminAgentRegistry.mockResolvedValue([]);
    getAgentCatalog.mockResolvedValue(
      catalog([entry(), { ...rowedEntry, policy_required: null }])
    );
    render(<CoordAgentRegistryPage />);
    const sw = await spawnSwitch("code-reviewer");
    expect(sw).toBeDisabled();
    expect(
      screen.getByTestId("agent-spawn-switch-code-reviewer")
    ).toHaveAttribute("title", expect.stringMatching(/needs a disposition/));
    // An unrowed type has no row to wait for.
    expect(await spawnSwitch("triage-judge")).not.toBeDisabled();
  });
});

describe("/admin/coord/agent-registry — add-by-name waits for both reads", () => {
  it("is held while the catalog's row source is unread", async () => {
    getAgentCatalog.mockResolvedValue(
      catalog([entry()], [{ source: "row", reason: "timeout" }])
    );
    render(<CoordAgentRegistryPage />);
    await screen.findByTestId("agent-registry-add-by-name-held");
    expect(screen.queryByTestId("agent-registry-add-by-name")).toBeNull();
  });
});

describe("/admin/coord/agent-registry — cancelling the switch-off", () => {
  it("clears the reason typed before Cancel", async () => {
    render(<CoordAgentRegistryPage />);
    await userEvent.click(await spawnSwitch("triage-judge"));
    const reason = () =>
      screen.getByRole("textbox", {
        name: "Reason for switching off triage-judge",
      });
    await userEvent.type(reason(), "stale words");
    await userEvent.click(
      within(
        screen.getByTestId("agent-spawn-switch-confirm-triage-judge")
      ).getByRole("button", { name: "Cancel" })
    );
    await userEvent.click(await spawnSwitch("triage-judge"));
    expect(reason()).toHaveValue("");
  });
});

describe("/admin/coord/agent-registry — add agent type by name", () => {
  const field = () =>
    screen.getByRole("textbox", { name: "Add agent type by name" });
  const submit = () =>
    userEvent.click(
      screen.getByRole("button", { name: "Switch its spawns off" })
    );

  it("lowercases the name and switches its spawns off only once confirmed", async () => {
    render(<CoordAgentRegistryPage />);
    await screen.findByTestId("agent-registry-add-by-name");
    await userEvent.type(field(), "My-Agent");
    await submit();
    // One click on the form writes nothing: the switch-off is confirmed first.
    expect(putAgentAdminSwitch).not.toHaveBeenCalled();
    const confirm = screen.getByTestId("agent-registry-add-confirm");
    await userEvent.type(
      within(confirm).getByRole("textbox", {
        name: "Reason for switching off my-agent",
      }),
      "custom agent misbehaves"
    );
    await userEvent.click(screen.getByTestId("agent-registry-add-confirm-off"));
    expect(putAgentAdminSwitch).toHaveBeenCalledWith("my-agent", {
      disabled: true,
      reason: "custom agent misbehaves",
    });
  });

  it("cancelling the add-by-name confirmation writes nothing", async () => {
    render(<CoordAgentRegistryPage />);
    await screen.findByTestId("agent-registry-add-by-name");
    await userEvent.type(field(), "my-agent");
    await submit();
    await userEvent.click(
      within(screen.getByTestId("agent-registry-add-confirm")).getByRole(
        "button",
        { name: "Cancel" }
      )
    );
    expect(screen.queryByTestId("agent-registry-add-confirm")).toBeNull();
    expect(putAgentAdminSwitch).not.toHaveBeenCalled();
  });

  it.each([
    ["has space", /lowercase letters, digits/],
    ["émile", /lowercase letters, digits/],
    ["catalog", /reserved/],
    ["Observed", /reserved/],
    ["a".repeat(65), /at most 64/],
  ])("refuses %s before any write", async (name, problem) => {
    render(<CoordAgentRegistryPage />);
    await screen.findByTestId("agent-registry-add-by-name");
    await userEvent.type(field(), name);
    await submit();
    expect(
      screen.getByTestId("agent-registry-add-name-problem")
    ).toHaveTextContent(problem);
    expect(putAgentAdminSwitch).not.toHaveBeenCalled();
  });

  it("an empty name is refused", async () => {
    render(<CoordAgentRegistryPage />);
    await screen.findByTestId("agent-registry-add-by-name");
    await submit();
    expect(
      screen.getByTestId("agent-registry-add-name-problem")
    ).toHaveTextContent("Enter an agent type name.");
  });

  it("a listed name is pointed at, not re-written", async () => {
    render(<CoordAgentRegistryPage />);
    await screen.findByTestId("agent-registry-add-by-name");
    await userEvent.type(field(), "Triage-Judge");
    await submit();
    expect(putAgentAdminSwitch).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("agent-registry-add-name-problem")
    ).toHaveTextContent("already listed");
    expect(screen.queryByTestId("agent-registry-row-code-reviewer")).toBeNull();
    expect(
      screen.getByTestId("agent-registry-row-triage-judge")
    ).toBeInTheDocument();
  });
});

describe("/admin/coord/agent-registry — coord#4585's catalog shape", () => {
  it("a row source coord could not read leaves the switch Unknown, never On", async () => {
    getAgentCatalog.mockResolvedValue(
      catalog(
        [entry({ has_row: null, admin_disabled: null, default_enabled: null })],
        [{ source: "row", reason: "registry read failed" }]
      )
    );
    render(<CoordAgentRegistryPage />);
    expect(await spawnSwitch("triage-judge")).toBeDisabled();
    expect(
      screen.getByTestId("agent-spawn-switch-label-triage-judge")
    ).toHaveTextContent("Unknown");
    expect(
      screen.getByTestId("agent-registry-source-triage-judge-row-unknown")
    ).toHaveTextContent("registry row unknown");
    expect(
      screen.queryByTestId("agent-registry-source-triage-judge-no-row")
    ).toBeNull();
  });

  it("an unrowed policy-required type offers the catalog's disposition set", async () => {
    getAgentCatalog.mockResolvedValue(
      catalog([
        entry({
          policy_required: true,
          allowed_dispositions: ["block", "warn_proceed"],
        }),
      ])
    );
    render(<CoordAgentRegistryPage />);
    await userEvent.click(await spawnSwitch("triage-judge"));
    const panel = screen.getByTestId("agent-spawn-switch-confirm-triage-judge");
    expect(within(panel).getAllByRole("radio")).toHaveLength(2);
  });

  it("a member reads who-why from the catalog, which every member is served", async () => {
    const { AgentPrefError } = await import("@/lib/api/agent-registry");
    listAdminAgentRegistry.mockRejectedValue(
      new AgentPrefError("forbidden", null, 403)
    );
    getAgentCatalog.mockResolvedValue(
      catalog([
        entry({
          has_row: true,
          admin_disabled: true,
          admin_disposition: "block",
          admin_reason: "too costly",
        }),
      ])
    );
    render(<CoordAgentRegistryPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Expand triage-judge" })
    );
    const detail = screen.getByTestId(
      "agent-registry-admin-detail-triage-judge"
    );
    expect(detail).toHaveTextContent("disposition: block");
    expect(detail).toHaveTextContent("reason: too costly");
  });

  it("renders also_vetoes and the hook_or_advisory label when coord sends them", async () => {
    getAgentCatalog.mockResolvedValue(
      catalog([
        entry({
          enforcement: "hook_or_advisory",
          enforcement_note: "Only Claude Code sessions run the hook.",
          also_vetoes: ["explore", "general-purpose"],
        }),
      ])
    );
    render(<CoordAgentRegistryPage />);
    const badge = await screen.findByTestId(
      "agent-registry-enforcement-triage-judge"
    );
    expect(badge).toHaveTextContent(
      "hook-enforced where the hook runs; otherwise advisory"
    );
    expect(badge).toHaveAttribute(
      "title",
      expect.stringContaining("Only Claude Code sessions run the hook.")
    );
    expect(
      screen.getByTestId("agent-registry-also-vetoes-badge-triage-judge")
    ).toHaveTextContent("also stops 2");
  });

  it("tolerates also_vetoes absent", async () => {
    render(<CoordAgentRegistryPage />);
    await screen.findByTestId("agent-registry-row-triage-judge");
    expect(
      screen.queryByTestId("agent-registry-also-vetoes-badge-triage-judge")
    ).toBeNull();
  });

  it("names a repo whose roles were unread, and lists skipped role files", async () => {
    getAgentCatalog.mockResolvedValue({
      agents: [entry()],
      sources_unread: [
        { source: "declared_role", repo: "o/r", reason: "mirror absent" },
      ],
      declared_skipped: [
        {
          repo: "o/r",
          path: ".claude/agents/Bad Name.md",
          declared_name: "Bad Name",
          reason: "outside the registry grammar",
        },
      ],
    });
    render(<CoordAgentRegistryPage />);
    expect(
      await screen.findByTestId("agent-catalog-source-unread-declared_role")
    ).toHaveTextContent("in o/r could not be read");
    expect(
      screen.getByTestId("agent-catalog-declared-skipped")
    ).toHaveTextContent("Bad Name");
  });
});

describe("/admin/coord/agent-registry — counts and joins under coord#4585", () => {
  it("an unread ceiling makes the spawns-off count unknown, never 0", async () => {
    listAdminAgentRegistry.mockResolvedValue([]);
    getAgentCatalog.mockResolvedValue(
      catalog(
        [entry({ has_row: null, admin_disabled: null, default_enabled: null })],
        [{ source: "row", reason: "registry read failed" }]
      )
    );
    render(<CoordAgentRegistryPage />);
    expect(
      await screen.findByTestId("agent-registry-spawns-off-count")
    ).toHaveTextContent("at least 0; 1 unknown.");
    expect(
      screen.getByTestId("agent-registry-filter-spawns-off")
    ).toHaveTextContent("–");
  });

  it("joins a legacy case-variant row to the catalog's normalized line", async () => {
    listAdminAgentRegistry.mockResolvedValue([
      row({ agent_name: "Code-Reviewer" }),
    ]);
    render(<CoordAgentRegistryPage />);
    expect(
      await screen.findByTestId("agent-registry-row-code-reviewer")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("agent-registry-row-Code-Reviewer")).toBeNull();
  });
});

describe("/admin/coord/agent-registry — review round 6", () => {
  it("a member's override and default counts are unknown, never 0", async () => {
    const { AgentPrefError } = await import("@/lib/api/agent-registry");
    listAdminAgentRegistry.mockRejectedValue(
      new AgentPrefError("forbidden", null, 403)
    );
    getAgentCatalog.mockResolvedValue(
      catalog([entry({ default_enabled: null })])
    );
    render(<CoordAgentRegistryPage />);
    await screen.findByTestId("agent-registry-row-triage-judge");
    expect(
      screen.getByTestId("agent-registry-filter-contested")
    ).toHaveTextContent("–");
    expect(screen.getByTestId("agent-registry-filter-off")).toHaveTextContent(
      "–"
    );
  });

  it("binds the lowercase row of a case-variant pair, as coord does", async () => {
    listAdminAgentRegistry.mockResolvedValue([
      row({ agent_name: "Code-Reviewer", default_enabled: true }),
      row({ agent_name: "code-reviewer", default_enabled: false }),
    ]);
    render(<CoordAgentRegistryPage />);
    expect(
      await screen.findByLabelText("Default-enable code-reviewer")
    ).not.toBeChecked();
  });

  it("a joined legacy row keeps its save error on its line", async () => {
    const { AgentPrefError } = await import("@/lib/api/agent-registry");
    listAdminAgentRegistry.mockResolvedValue([
      row({ agent_name: "Code-Reviewer" }),
    ]);
    putAgentRegistryDefaults.mockRejectedValue(
      new AgentPrefError("coord said no", null, 409)
    );
    render(<CoordAgentRegistryPage />);
    await userEvent.click(
      await screen.findByLabelText("Default-enable code-reviewer")
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("agent-registry-save-error-code-reviewer")
      ).toHaveTextContent("coord said no")
    );
    expect(putAgentRegistryDefaults.mock.calls[0][0]).toBe("Code-Reviewer");
  });
});

describe("/admin/coord/agent-registry — review round 7", () => {
  it("the off detail reads the catalog's disposition, not an older row's", async () => {
    listAdminAgentRegistry.mockResolvedValue([
      row({ admin_disposition: null, admin_reason: null }),
    ]);
    getAgentCatalog.mockResolvedValue(
      catalog([
        {
          ...rowedEntry,
          admin_disabled: true,
          admin_disposition: "block",
          admin_reason: "too costly",
        },
      ])
    );
    render(<CoordAgentRegistryPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Expand code-reviewer" })
    );
    const detail = screen.getByTestId(
      "agent-registry-admin-detail-code-reviewer"
    );
    expect(detail).toHaveTextContent("disposition: block");
    expect(detail).toHaveTextContent("reason: too costly");
  });
});
