/**
 * RepoFollowupDialsPanel — plan
 * `2026-09-01-post-merge-followup-spawn-is-repo-and-content-blind` Phase 4b.
 *
 * Drives the REAL hook against a mocked `httpClient`, so the PUT bodies the
 * panel builds are asserted where they are built.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const httpGet = vi.fn();
const httpPut = vi.fn();
const listRepos = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...a: unknown[]) => httpGet(...a),
    put: (...a: unknown[]) => httpPut(...a),
  },
}));

vi.mock("@/lib/api/operations/sessions", () => ({
  listRegisteredRepos: (...a: unknown[]) => listRepos(...a),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

import { RepoFollowupDialsPanel } from "./RepoFollowupDialsPanel";

const NOTES = "qontinui/qontinui-dev-notes";
const WEB = "qontinui/qontinui-web";

function scopeView(
  repo: string,
  scope: string,
  opts: {
    resolved?: string;
    mode?: string | null;
    canEdit?: boolean;
    paths?: string[];
  } = {}
) {
  return {
    repo,
    scope,
    code_paths: opts.paths ?? [],
    resolved_scope: opts.resolved ?? "repo",
    mode: opts.mode === undefined ? "shadow" : opts.mode,
    can_edit: opts.canEdit ?? true,
  };
}

function deliveryView(repo: string, mode = "in_session_with_spawn_fallback") {
  return { repo, mode, provenance_known: false, can_edit: true };
}

function serve(scopes: Record<string, unknown | Error>) {
  httpGet.mockImplementation((url: string) => {
    const repo = decodeURIComponent(url.split("repo=")[1] ?? "");
    if (url.includes("post-merge-followup-scope")) {
      const v = scopes[repo];
      return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
    }
    return Promise.resolve(deliveryView(repo));
  });
}

function rowFor(repo: string): HTMLElement {
  const rows = screen.getAllByTestId("repo-followup-row");
  const row = rows.find((r) => r.textContent?.includes(repo));
  if (!row) throw new Error(`no row for ${repo}`);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  listRepos.mockResolvedValue([{ repo: WEB }, { repo: NOTES }]);
});

describe("RepoFollowupDialsPanel", () => {
  it("shows the shadow rollout prominently and counts scopes", async () => {
    serve({
      [NOTES]: scopeView(NOTES, "code_only", { paths: ["scripts/**"] }),
      [WEB]: scopeView(WEB, "all", { resolved: "default" }),
    });
    render(<RepoFollowupDialsPanel />);

    const rollout = await screen.findByTestId("repo-followup-rollout");
    await waitFor(() =>
      expect(rollout.getAttribute("data-rollout-mode")).toBe("shadow")
    );
    expect(rollout.textContent).toContain("suppresses nothing");
    expect(screen.getByTestId("repo-followup-summary-mode").textContent).toBe(
      "rollout Shadow"
    );
    expect(
      screen.getByTestId("repo-followup-summary-scopes").textContent
    ).toContain("every merge 1 · code only 1 · never 0");
    expect(rowFor(WEB).textContent).toContain("Every merge (default)");
  });

  it("an unreadable scope renders UNKNOWN, never 'Every merge'", async () => {
    serve({
      [NOTES]: new Error(
        'GET x failed: 503 - {"error":"preference_unreadable"}'
      ),
      [WEB]: scopeView(WEB, "none"),
    });
    render(<RepoFollowupDialsPanel />);

    await waitFor(() => expect(rowFor(NOTES).textContent).toContain("–"));
    expect(rowFor(NOTES).textContent).not.toContain("Every merge");
    expect(
      rowFor(NOTES)
        .querySelector("[data-attention]")
        ?.getAttribute("data-attention")
    ).toBe("waiting");
    expect(
      screen.getByTestId("repo-followup-summary-scopes").textContent
    ).toContain("unknown 1");
  });

  it("with no scope readable, the rollout mode is UNKNOWN", async () => {
    serve({
      [NOTES]: new Error("GET x failed: 502 - down"),
      [WEB]: new Error("GET x failed: 502 - down"),
    });
    render(<RepoFollowupDialsPanel />);
    const rollout = await screen.findByTestId("repo-followup-rollout");
    await waitFor(() => expect(httpGet).toHaveBeenCalledTimes(4));
    expect(rollout.getAttribute("data-rollout-mode")).toBe("unknown");
    expect(rollout.textContent).toContain("unknown");
  });

  it("saving code_only sends the globs and shows the read-back", async () => {
    serve({
      [NOTES]: scopeView(NOTES, "all", { resolved: "default" }),
      [WEB]: scopeView(WEB, "all", { resolved: "default" }),
    });
    httpPut.mockResolvedValueOnce({
      ok: true,
      repo: NOTES,
      written_scope: "code_only",
      stored_code_paths: ["scripts/**", ".github/**"],
      updated_by: "op@example.com",
      effective: scopeView(NOTES, "code_only", {
        paths: ["scripts/**", ".github/**"],
      }),
      readback_error: null,
    });
    render(<RepoFollowupDialsPanel />);

    await waitFor(() => expect(rowFor(NOTES).textContent).toContain("default"));
    fireEvent.click(
      within(rowFor(NOTES)).getByRole("button", { expanded: false })
    );
    const detail = await screen.findByTestId("repo-followup-detail");

    fireEvent.click(
      within(detail).getByTestId("repo-followup-scope-code_only")
    );
    // No glob yet: refused before any request.
    expect(
      within(detail).getByTestId("repo-followup-scope-invalid")
    ).toBeTruthy();
    expect(
      (
        within(detail).getByTestId(
          "repo-followup-scope-save"
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);

    fireEvent.change(within(detail).getByTestId("repo-followup-paths"), {
      target: { value: "scripts/**\n\n .github/** " },
    });
    fireEvent.click(within(detail).getByTestId("repo-followup-scope-save"));

    await waitFor(() => expect(httpPut).toHaveBeenCalledTimes(1));
    expect(httpPut).toHaveBeenCalledWith(
      "/api/v1/operations/post-merge-followup-scope",
      {
        repo: NOTES,
        scope: "code_only",
        code_paths: ["scripts/**", ".github/**"],
      }
    );
    await waitFor(() =>
      expect(rowFor(NOTES).textContent).toContain("Code changes only")
    );
  });

  it("choosing a delivery mode writes it for that repo", async () => {
    serve({
      [NOTES]: scopeView(NOTES, "all"),
      [WEB]: scopeView(WEB, "all"),
    });
    httpPut.mockResolvedValueOnce({
      ok: true,
      repo: WEB,
      written_mode: "notify_only",
      effective: deliveryView(WEB, "notify_only"),
      readback_error: null,
    });
    render(<RepoFollowupDialsPanel />);
    await waitFor(() =>
      expect(rowFor(WEB).textContent).toContain("Every merge")
    );
    fireEvent.click(
      within(rowFor(WEB)).getByRole("button", { expanded: false })
    );
    const detail = await screen.findByTestId("repo-followup-detail");
    expect(detail.textContent).toContain("fail-open");

    fireEvent.click(
      within(detail).getByTestId("repo-followup-delivery-notify_only")
    );
    await waitFor(() =>
      expect(httpPut).toHaveBeenCalledWith(
        "/api/v1/operations/continuation-delivery-mode",
        { repo: WEB, mode: "notify_only" }
      )
    );
    await waitFor(() =>
      expect(
        within(detail).getByTestId("repo-followup-delivery-current").textContent
      ).toBe("Notify only (resolved, not confirmed)")
    );
  });

  it("controls are disabled when the backend says the caller cannot edit", async () => {
    serve({
      [NOTES]: scopeView(NOTES, "all", { canEdit: false }),
      [WEB]: scopeView(WEB, "all", { canEdit: false }),
    });
    httpGet.mockImplementation((url: string) => {
      const repo = decodeURIComponent(url.split("repo=")[1] ?? "");
      if (url.includes("post-merge-followup-scope")) {
        return Promise.resolve(scopeView(repo, "all", { canEdit: false }));
      }
      return Promise.resolve({ ...deliveryView(repo), can_edit: false });
    });
    render(<RepoFollowupDialsPanel />);
    await screen.findByTestId("repo-followup-readonly");
    fireEvent.click(
      within(rowFor(WEB)).getByRole("button", { expanded: false })
    );
    const detail = await screen.findByTestId("repo-followup-detail");
    expect(
      (
        within(detail).getByTestId(
          "repo-followup-scope-none"
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (
        within(detail).getByTestId(
          "repo-followup-delivery-notify_only"
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("a failed write read-back makes the row AND the header counts unknown", async () => {
    serve({
      [NOTES]: scopeView(NOTES, "all", { resolved: "default" }),
      [WEB]: scopeView(WEB, "all", { resolved: "default" }),
    });
    httpPut.mockResolvedValueOnce({
      ok: true,
      repo: NOTES,
      written_scope: "none",
      stored_code_paths: [],
      updated_by: null,
      effective: null,
      readback_error: "read-back failed: coord returned 503",
    });
    render(<RepoFollowupDialsPanel />);
    await waitFor(() =>
      expect(
        screen.getByTestId("repo-followup-summary-scopes").textContent
      ).toContain("every merge 2")
    );
    fireEvent.click(
      within(rowFor(NOTES)).getByRole("button", { expanded: false })
    );
    const detail = await screen.findByTestId("repo-followup-detail");
    fireEvent.click(within(detail).getByTestId("repo-followup-scope-none"));
    fireEvent.click(within(detail).getByTestId("repo-followup-scope-save"));

    await waitFor(() =>
      expect(
        screen.getByTestId("repo-followup-summary-scopes").textContent
      ).toContain("every merge 1 · code only 0 · never 0 · unknown 1")
    );
    const badge = rowFor(NOTES).querySelector("[data-status-kind]");
    expect(badge?.getAttribute("data-status-kind")).toBe("unknown");
    expect(badge?.textContent).toBe("–");
    expect(rowFor(NOTES).textContent).toContain("scope=unknown");
  });

  it("a failed refresh after a good read labels the rollout stale", async () => {
    serve({
      [NOTES]: scopeView(NOTES, "all", { mode: "enforce" }),
      [WEB]: scopeView(WEB, "all", { mode: "enforce" }),
    });
    render(<RepoFollowupDialsPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("repo-followup-summary-mode").textContent).toBe(
        "rollout Enforced"
      )
    );
    serve({
      [NOTES]: new Error("GET x failed: 502 - down"),
      [WEB]: new Error("GET x failed: 502 - down"),
    });
    fireEvent.click(screen.getByTestId("repo-followup-refresh"));
    await waitFor(() =>
      expect(screen.getByTestId("repo-followup-summary-mode").textContent).toBe(
        "rollout Enforced (stale)"
      )
    );
    expect(screen.getByTestId("repo-followup-rollout").textContent).toContain(
      "last good read"
    );
  });

  it("an unconfirmed delivery mode is qualified, amber, and can be re-written", async () => {
    serve({
      [NOTES]: scopeView(NOTES, "all"),
      [WEB]: scopeView(WEB, "all"),
    });
    render(<RepoFollowupDialsPanel />);
    await waitFor(() =>
      expect(rowFor(WEB).textContent).toContain("Every merge")
    );
    fireEvent.click(
      within(rowFor(WEB)).getByRole("button", { expanded: false })
    );
    const detail = await screen.findByTestId("repo-followup-detail");
    const current = within(detail).getByTestId(
      "repo-followup-delivery-current"
    );
    await waitFor(() =>
      expect(current.textContent).toBe(
        "In the author's session (resolved, not confirmed)"
      )
    );
    expect(current.getAttribute("data-provenance")).toBe("unconfirmed");
    expect(current.className).toContain("bg-amber-500/10");
    // The resolved value may be the fail-open default, so writing it
    // explicitly stays possible.
    expect(
      (
        within(detail).getByTestId(
          "repo-followup-delivery-in_session_with_spawn_fallback"
        ) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  it("a repo on the undeclared default can save `all` explicitly", async () => {
    serve({
      [NOTES]: scopeView(NOTES, "all", { resolved: "default" }),
      [WEB]: scopeView(WEB, "all", { resolved: "repo" }),
    });
    render(<RepoFollowupDialsPanel />);
    await waitFor(() => expect(rowFor(NOTES).textContent).toContain("default"));
    fireEvent.click(
      within(rowFor(NOTES)).getByRole("button", { expanded: false })
    );
    let detail = await screen.findByTestId("repo-followup-detail");
    expect(
      (
        within(detail).getByTestId(
          "repo-followup-scope-save"
        ) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    httpPut.mockResolvedValueOnce({
      ok: true,
      repo: NOTES,
      written_scope: "all",
      stored_code_paths: [],
      updated_by: null,
      effective: scopeView(NOTES, "all", { resolved: "repo" }),
      readback_error: null,
    });
    fireEvent.click(within(detail).getByTestId("repo-followup-scope-save"));
    await waitFor(() =>
      expect(httpPut).toHaveBeenCalledWith(
        "/api/v1/operations/post-merge-followup-scope",
        { repo: NOTES, scope: "all" }
      )
    );
    // Already declared `all`: nothing left to save.
    fireEvent.click(
      within(rowFor(WEB)).getByRole("button", { expanded: false })
    );
    detail = await screen.findByTestId("repo-followup-detail");
    expect(
      (
        within(detail).getByTestId(
          "repo-followup-scope-save"
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});
