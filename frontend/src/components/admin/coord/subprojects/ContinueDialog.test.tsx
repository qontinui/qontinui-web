/**
 * The Continue dialog (plan
 * `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * D8): it opens at the served effort profile or says why not, sends coord's
 * contract body, and acknowledges what coord answered — requested effort
 * beside "applied: not reported" — or words coord's typed refusal.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const continueSubproject = vi.fn();
vi.mock("@/lib/api/operations/coordSubprojects", () => ({
  continueSubproject: (...args: unknown[]) => continueSubproject(...args),
}));

const fetchPromptDocument = vi.fn();
vi.mock("@/lib/api/operations/coordPromptDocuments", () => ({
  fetchPromptDocument: (...args: unknown[]) => fetchPromptDocument(...args),
}));

const DEVICE = "00000000-0000-4000-8000-00000000cafe";
vi.mock("@/lib/api/operations/coordFleet", () => ({
  fetchFleetHealth: vi.fn(async () => ({
    as_of: "2026-11-08T15:00:00Z",
    devices: [{ device_id: DEVICE, hostname: "spaceship", state: "healthy" }],
    excluded: { unbound: 0, bound_to_other_tenant: 0 },
    excluded_error: null,
  })),
}));

vi.mock("@/lib/api/operations/agents", () => ({
  fetchClaudeAccounts: vi.fn(async () => ({ accounts: [] })),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { ContinueDialog } from "./ContinueDialog";

const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

const PLAYBOOK = {
  body: [
    "# Spawn effort profiles",
    "",
    "```spawn-effort",
    JSON.stringify({
      version: 1,
      default: "implementation",
      profiles: {
        research: { effort: "max", ultracode: true },
        implementation: { effort: "max", ultracode: false },
      },
    }),
    "```",
  ].join("\n"),
};

function respond(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });
}

function renderDialog(onContinued = vi.fn()) {
  render(
    <ContinueDialog
      open
      onClose={vi.fn()}
      subprojectId={ID}
      subprojectTitle="dashboards-and-presentation"
      defaultRepos={["qontinui-runner"]}
      onContinued={onContinued}
    />
  );
  return onContinued;
}

describe("ContinueDialog", () => {
  beforeEach(() => {
    continueSubproject.mockReset();
    fetchPromptDocument.mockReset();
  });

  it("opens at the served implementation profile, and says where the default came from", async () => {
    fetchPromptDocument.mockResolvedValue(PLAYBOOK);
    renderDialog();
    expect(
      await screen.findByTestId("subproject-continue-effort-source")
    ).toHaveTextContent(
      "Default max: the implementation profile of agent_playbook/spawn-effort-profiles."
    );
    expect(fetchPromptDocument).toHaveBeenCalledWith(
      "agent_playbook",
      "spawn-effort-profiles"
    );
    expect(screen.getByTestId("subproject-continue-submit")).toHaveTextContent(
      "Continue at max"
    );
  });

  it("falls back to high and names the read that failed", async () => {
    fetchPromptDocument.mockRejectedValue(
      new Error(
        'GET /api/v1/operations/coord/prompt-documents/agent_playbook/spawn-effort-profiles failed: 403 - {"error":"FORBIDDEN","message":"tenant_not_resolved"}'
      )
    );
    renderDialog();
    await waitFor(() =>
      expect(
        screen.getByTestId("subproject-continue-effort-source")
      ).toHaveTextContent(
        /^Default high: the effort profiles could not be read/
      )
    );
    expect(screen.getByTestId("subproject-continue-submit")).toHaveTextContent(
      "Continue at high"
    );
  });

  it("sends the next-available-runner body, then acknowledges what coord answered", async () => {
    fetchPromptDocument.mockResolvedValue(PLAYBOOK);
    continueSubproject.mockResolvedValue(
      respond(200, {
        subproject_id: ID,
        allocation_agent_id: "01a1bbe4-53fb-7101-ac6b-57bc45151491",
        target_device_id: DEVICE,
        placement: "pool",
        effort_requested: "max",
        ultracode_requested: false,
        repos: ["qontinui-runner"],
        brief_preview: "Continue the dashboards subproject...",
      })
    );
    const onContinued = renderDialog();
    await screen.findByText(/Default max/);
    expect(screen.getByTestId("subproject-continue-placement")).toHaveAttribute(
      "data-placement",
      "pool"
    );
    fireEvent.click(screen.getByTestId("subproject-continue-submit"));

    const result = await screen.findByTestId("subproject-continue-result");
    expect(continueSubproject).toHaveBeenCalledWith(ID, {
      effort: "max",
      ultracode: false,
      repos: [{ repo: "qontinui-runner" }],
    });
    expect(result).toHaveTextContent("01a1bbe4-53fb-7101-ac6b-57bc45151491");
    expect(
      screen.getByTestId("subproject-continue-placement-result")
    ).toHaveTextContent(
      `Placed on spaceship (${DEVICE}) — placed by coord on the next available runner.`
    );
    const effort = screen.getByTestId("subproject-continue-effort-result");
    expect(effort).toHaveTextContent(
      "effort requested max · applied: not reported"
    );
    expect(effort.getAttribute("title")).toMatch(
      /never assumed to be the one requested/
    );
    expect(onContinued).toHaveBeenCalledTimes(1);
  });

  it("omits the repos when the operator clears them, so coord derives them", async () => {
    fetchPromptDocument.mockResolvedValue(PLAYBOOK);
    continueSubproject.mockResolvedValue(respond(200, { placement: "pool" }));
    renderDialog();
    await screen.findByText(/Default max/);
    fireEvent.change(screen.getByTestId("subproject-continue-repos"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("subproject-continue-addendum"), {
      target: { value: "  Start at the failed gate.  " },
    });
    fireEvent.click(screen.getByTestId("subproject-continue-submit"));
    await screen.findByTestId("subproject-continue-result");
    expect(continueSubproject).toHaveBeenCalledWith(ID, {
      effort: "max",
      ultracode: false,
      prompt_addendum: "Start at the failed gate.",
    });
  });

  it("words coord's typed 409 and keeps the form for another try", async () => {
    fetchPromptDocument.mockResolvedValue(PLAYBOOK);
    continueSubproject.mockResolvedValue(
      respond(409, {
        error: "no_capacity",
        detail: "every device is at its cap",
      })
    );
    const onContinued = renderDialog();
    await screen.findByText(/Default max/);
    fireEvent.click(screen.getByTestId("subproject-continue-submit"));
    const refusal = await screen.findByTestId("subproject-continue-refusal");
    expect(refusal).toHaveAttribute("data-refusal-kind", "no_capacity");
    expect(refusal).toHaveTextContent("Every runner is at its session cap");
    expect(refusal).toHaveTextContent("every device is at its cap");
    expect(
      screen.getByTestId("subproject-continue-submit")
    ).toBeInTheDocument();
    expect(onContinued).not.toHaveBeenCalled();
  });

  it("names a subproject with no repo and both remedies", async () => {
    fetchPromptDocument.mockResolvedValue(PLAYBOOK);
    continueSubproject.mockResolvedValue(
      respond(422, { error: "subproject_has_no_repo" })
    );
    renderDialog();
    await screen.findByText(/Default max/);
    fireEvent.click(screen.getByTestId("subproject-continue-submit"));
    expect(
      await screen.findByTestId("subproject-continue-refusal")
    ).toHaveTextContent(
      "Name the repos in the Repos field, or attach a work unit whose plan names its repos."
    );
  });

  it("says a timed-out Continue may have landed, never that it failed", async () => {
    fetchPromptDocument.mockResolvedValue(PLAYBOOK);
    continueSubproject.mockResolvedValue(
      respond(504, {
        error: "GATEWAY_TIMEOUT",
        message: "timeout waiting for coord",
      })
    );
    renderDialog();
    await screen.findByText(/Default max/);
    fireEvent.click(screen.getByTestId("subproject-continue-submit"));
    expect(
      await screen.findByTestId("subproject-continue-refusal")
    ).toHaveTextContent("may or may not have landed");
  });
});
