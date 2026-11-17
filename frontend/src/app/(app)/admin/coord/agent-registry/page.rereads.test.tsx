/**
 * /admin/coord/agent-registry — a save's RE-READ, apart from the write.
 *
 * 1. **An older re-read never paints over a newer one.** Two saves whose
 *    re-reads overtake each other leave the newer read on screen.
 * 2. **A 403 on a save's re-read is not the page's 403.** It keeps the rows
 *    and the save's own text rather than swapping in the administrator panel,
 *    whether the write's outcome is open or the write answered 2xx.
 * 3. **The interim line** says the open outcome is being re-read while it is.
 * 4. **A superseded re-read is not a failed one.** A save's re-read that fails
 *    after a newer read has delivered reports the newer read, and an older
 *    success landing after a newer failure keeps that failure's banner.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("./_components/RepoFollowupDialsPanel", () => ({
  RepoFollowupDialsPanel: () => null,
}));

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
    policy_required: false,
    allowed_dispositions: ["block", "degrade", "warn_proceed"],
    fanout_bound: 15,
    pref_count: 0,
    pref_differs_from_default_count: 0,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const toggle = (name: string) =>
  screen.getByLabelText<HTMLInputElement>(`Default-enable ${name}`);
const saveText = (name: string) =>
  screen.queryByTestId(`agent-registry-save-error-${name}`);

beforeEach(() => {
  listAdminAgentRegistry.mockReset();
  putAgentRegistryDefaults.mockReset();
  listAdminAgentRegistry.mockResolvedValue([row()]);
});

describe("/admin/coord/agent-registry — re-reads", () => {
  it("keeps the newer re-read when an older one lands after it", async () => {
    listAdminAgentRegistry.mockResolvedValue([
      row({ agent_name: "alpha" }),
      row({ agent_name: "beta" }),
    ]);
    render(<CoordAgentRegistryPage />);
    await screen.findByLabelText("Default-enable alpha");

    // Alpha's PUT loses its answer, and its re-read is held.
    putAgentRegistryDefaults.mockRejectedValueOnce(
      new AgentPrefError("timeout waiting for coord", null, 504)
    );
    const alphaRead = deferred<unknown>();
    listAdminAgentRegistry.mockImplementationOnce(() => alphaRead.promise);
    await userEvent.click(toggle("alpha"));

    // Beta saves, and its re-read shows beta on.
    putAgentRegistryDefaults.mockResolvedValueOnce(undefined);
    listAdminAgentRegistry.mockResolvedValueOnce([
      row({ agent_name: "alpha", default_enabled: true }),
      row({ agent_name: "beta", default_enabled: true }),
    ]);
    await userEvent.click(toggle("beta"));
    await waitFor(() => expect(toggle("beta").checked).toBe(true));

    // Alpha's older read arrives, from before beta's write.
    await act(async () => {
      alphaRead.resolve([
        row({ agent_name: "alpha", default_enabled: true }),
        row({ agent_name: "beta" }),
      ]);
    });
    await waitFor(() =>
      expect(saveText("alpha")).toHaveTextContent(
        "What is shown is a read made after it."
      )
    );
    expect(toggle("beta").checked).toBe(true);
  });

  it("does not let an older failed read report over a newer answer", async () => {
    render(<CoordAgentRegistryPage />);
    await screen.findByLabelText("Default-enable code-reviewer");
    let failOld: (e: unknown) => void = () => {};
    listAdminAgentRegistry.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failOld = reject;
        })
    );
    await userEvent.click(screen.getByTestId("coord-agent-registry-refresh"));
    listAdminAgentRegistry.mockResolvedValueOnce([
      row({ default_enabled: true }),
    ]);
    await userEvent.click(screen.getByTestId("coord-agent-registry-refresh"));
    await waitFor(() => expect(toggle("code-reviewer").checked).toBe(true));

    await act(async () => {
      failOld(new AgentPrefError("busy", null, 503));
    });
    expect(screen.queryByTestId("coord-agent-registry-error")).toBeNull();
    expect(toggle("code-reviewer").checked).toBe(true);
  });

  it("a saved write whose re-read fails after a newer read delivered is not 'the re-read failed'", async () => {
    putAgentRegistryDefaults.mockResolvedValueOnce(undefined);
    render(<CoordAgentRegistryPage />);
    await screen.findByLabelText("Default-enable code-reviewer");
    const saveRead = deferred<unknown>();
    listAdminAgentRegistry.mockImplementationOnce(() => saveRead.promise);
    await userEvent.click(toggle("code-reviewer"));
    await waitFor(() =>
      expect(listAdminAgentRegistry).toHaveBeenCalledTimes(2)
    );

    // A refresh issued after the save's re-read delivers first.
    listAdminAgentRegistry.mockResolvedValueOnce([
      row({ default_enabled: true }),
    ]);
    await userEvent.click(screen.getByTestId("coord-agent-registry-refresh"));
    await waitFor(() => expect(toggle("code-reviewer").checked).toBe(true));

    await act(async () => {
      saveRead.reject(new AgentPrefError("busy", null, 503));
    });
    expect(saveText("code-reviewer")).toBeNull();
    expect(screen.queryByTestId("coord-agent-registry-error")).toBeNull();
    expect(toggle("code-reviewer").checked).toBe(true);
  });

  it("an open outcome whose re-read is superseded by a newer delivered read says what is shown is after it", async () => {
    putAgentRegistryDefaults.mockRejectedValueOnce(
      new AgentPrefError("timeout waiting for coord", null, 504)
    );
    render(<CoordAgentRegistryPage />);
    await screen.findByLabelText("Default-enable code-reviewer");
    const saveRead = deferred<unknown>();
    listAdminAgentRegistry.mockImplementationOnce(() => saveRead.promise);
    await userEvent.click(toggle("code-reviewer"));
    await waitFor(() =>
      expect(saveText("code-reviewer")).toHaveTextContent(
        "Re-reading what coord serves."
      )
    );
    listAdminAgentRegistry.mockResolvedValueOnce([
      row({ default_enabled: true }),
    ]);
    await userEvent.click(screen.getByTestId("coord-agent-registry-refresh"));
    await waitFor(() => expect(toggle("code-reviewer").checked).toBe(true));

    await act(async () => {
      saveRead.reject(new AgentPrefError("busy", null, 503));
    });
    await waitFor(() =>
      expect(saveText("code-reviewer")).toHaveTextContent(
        "Whether this change was applied is unknown (timeout waiting for coord). What is shown is a read made after it."
      )
    );
  });

  it("an older success landing after a newer failure keeps that failure's banner", async () => {
    render(<CoordAgentRegistryPage />);
    await screen.findByLabelText("Default-enable code-reviewer");
    const older = deferred<unknown>();
    listAdminAgentRegistry.mockImplementationOnce(() => older.promise);
    await userEvent.click(screen.getByTestId("coord-agent-registry-refresh"));
    listAdminAgentRegistry.mockRejectedValueOnce(
      new AgentPrefError("coord is down", null, 503)
    );
    await userEvent.click(screen.getByTestId("coord-agent-registry-refresh"));
    await waitFor(() =>
      expect(
        screen.getByTestId("coord-agent-registry-error")
      ).toHaveTextContent("coord is down")
    );

    await act(async () => {
      older.resolve([row({ default_enabled: true })]);
    });
    expect(screen.getByTestId("coord-agent-registry-error")).toHaveTextContent(
      "coord is down"
    );
  });

  it("an older 2xx landing after a newer 403 keeps the administrator panel", async () => {
    render(<CoordAgentRegistryPage />);
    await screen.findByLabelText("Default-enable code-reviewer");
    const older = deferred<unknown>();
    listAdminAgentRegistry.mockImplementationOnce(() => older.promise);
    await userEvent.click(screen.getByTestId("coord-agent-registry-refresh"));
    listAdminAgentRegistry.mockRejectedValueOnce(
      new AgentPrefError("not_coord_tenant_admin", null, 403)
    );
    await userEvent.click(screen.getByTestId("coord-agent-registry-refresh"));
    await screen.findByTestId("coord-agent-registry-forbidden");

    await act(async () => {
      older.resolve([row({ default_enabled: true })]);
    });
    expect(
      screen.getByTestId("coord-agent-registry-forbidden")
    ).toBeInTheDocument();
  });

  it("keeps the page and the open outcome's text when the re-read is a 403", async () => {
    putAgentRegistryDefaults.mockRejectedValue(
      new AgentPrefError("timeout waiting for coord", null, 504)
    );
    render(<CoordAgentRegistryPage />);
    await screen.findByLabelText("Default-enable code-reviewer");
    listAdminAgentRegistry.mockRejectedValue(
      new AgentPrefError("not_coord_tenant_admin", null, 403)
    );
    await userEvent.click(toggle("code-reviewer"));

    await waitFor(() =>
      expect(saveText("code-reviewer")).toHaveTextContent(
        "Whether this change was applied is unknown (timeout waiting for coord). The re-read failed too, so what is shown may be out of date."
      )
    );
    expect(screen.queryByTestId("coord-agent-registry-forbidden")).toBeNull();
    expect(screen.getByTestId("coord-agent-registry-page")).toBeInTheDocument();
  });

  it("says saved when a 2xx write's re-read is a 403, and keeps the page", async () => {
    putAgentRegistryDefaults.mockResolvedValue(undefined);
    render(<CoordAgentRegistryPage />);
    await screen.findByLabelText("Default-enable code-reviewer");
    listAdminAgentRegistry.mockRejectedValue(
      new AgentPrefError("not_coord_tenant_admin", null, 403)
    );
    await userEvent.click(toggle("code-reviewer"));

    await waitFor(() =>
      expect(saveText("code-reviewer")).toHaveTextContent(
        "Saved, but the re-read failed, so what is shown may be out of date."
      )
    );
    expect(screen.queryByTestId("coord-agent-registry-forbidden")).toBeNull();
  });

  it("still shows the administrator panel when the page's own read is a 403", async () => {
    listAdminAgentRegistry.mockRejectedValue(
      new AgentPrefError("not_coord_tenant_admin", null, 403)
    );
    render(<CoordAgentRegistryPage />);
    expect(
      await screen.findByTestId("coord-agent-registry-forbidden")
    ).toBeInTheDocument();
  });

  it("says it is re-reading while the open outcome's re-read is out", async () => {
    putAgentRegistryDefaults.mockRejectedValue(
      new AgentPrefError("timeout waiting for coord", null, 504)
    );
    render(<CoordAgentRegistryPage />);
    await screen.findByLabelText("Default-enable code-reviewer");
    const held = deferred<unknown>();
    listAdminAgentRegistry.mockImplementationOnce(() => held.promise);
    await userEvent.click(toggle("code-reviewer"));

    await waitFor(() =>
      expect(saveText("code-reviewer")).toHaveTextContent(
        "Whether this change was applied is unknown (timeout waiting for coord). Re-reading what coord serves."
      )
    );
    await act(async () => {
      held.resolve([row({ default_enabled: true })]);
    });
    await waitFor(() =>
      expect(saveText("code-reviewer")).toHaveTextContent(
        "What is shown is a read made after it."
      )
    );
  });
});
