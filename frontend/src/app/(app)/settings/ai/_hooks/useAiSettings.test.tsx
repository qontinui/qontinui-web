/**
 * useAiSettings — roster-key save discipline, load gating, derived read-out.
 * Enters through the hook (the arming path), not the component alone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  renderHook,
  waitFor,
  render,
  screen,
} from "@testing-library/react";

const getAiSettings = vi.fn();
const saveAiSettings = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));
vi.mock("@/lib/runner-api", () => {
  const api = {
    getAiSettings: (...a: unknown[]) => getAiSettings(...a),
    saveAiSettings: (...a: unknown[]) => saveAiSettings(...a),
    hasAiApiKey: () => Promise.resolve({ has_key: false }),
  };
  return {
    useRunnerApi: () => api,
    useRunnerHealth: () => ({ isLoading: false, isOffline: false }),
    runnerFailureMessage: (_e: unknown, fallback: string) => fallback,
  };
});

import { useAiSettings } from "./useAiSettings";
import { ClaudeCliSettings } from "../_components/ClaudeCliSettings";

const view = (cli: Record<string, unknown> = {}, extra = {}) => ({
  provider: "claude_cli",
  claude_cli: {
    execution_mode: "auto",
    custom_path: null,
    timeout_seconds: 600,
    config_dir: null,
    account_selection_mode: "least_usage",
    account_selection_pinned: false,
    ...cli,
  },
  claude_api: { model: "m", max_tokens: 1 },
  gemini_cli: {
    execution_mode: "auto",
    custom_path: null,
    timeout_seconds: 1,
    auth_method: "oauth",
    model: "g",
  },
  gemini_api: { model: "g", max_output_tokens: 1, temperature: 0.1 },
  auto_refine_video_after_iterations: 3,
  interactive_sessions_enabled: true,
  effective_account_selection_mode: "manual",
  account_selection_source: "fleet",
  fleet_account_selection_mode: "manual",
  ...extra,
});

const ROSTER = [
  "config_dir",
  "account_selection_mode",
  "account_selection_pinned",
];
const lastBody = () => saveAiSettings.mock.calls.at(-1)![0];

async function loaded(v = view()) {
  getAiSettings.mockResolvedValue(v);
  const hook = renderHook(() => useAiSettings());
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  saveAiSettings.mockResolvedValue(undefined);
});

describe("useAiSettings save", () => {
  it("an unedited save sends none of the roster keys", async () => {
    const { result } = await loaded();
    await act(() => result.current.handleSave());
    const cli = lastBody().claude_cli;
    for (const k of ROSTER) expect(k in cli).toBe(false);
    expect(cli.timeout_seconds).toBe(600);
  });

  it("an edited pin sends only account_selection_pinned", async () => {
    const { result } = await loaded();
    act(() =>
      result.current.setClaudeCli({
        ...result.current.claudeCli,
        account_selection_pinned: true,
      })
    );
    await act(() => result.current.handleSave());
    const cli = lastBody().claude_cli;
    expect(cli.account_selection_pinned).toBe(true);
    expect("config_dir" in cli).toBe(false);
    expect("account_selection_mode" in cli).toBe(false);
  });

  it("emptying config_dir sends explicit null only when edited", async () => {
    const { result } = await loaded(view({ config_dir: "/x" }));
    act(() =>
      result.current.setClaudeCli({
        ...result.current.claudeCli,
        config_dir: null,
      })
    );
    await act(() => result.current.handleSave());
    expect(lastBody().claude_cli.config_dir).toBeNull();
  });

  it("a second save after a successful save sends none", async () => {
    const { result } = await loaded();
    act(() =>
      result.current.setClaudeCli({
        ...result.current.claudeCli,
        account_selection_pinned: true,
      })
    );
    await act(() => result.current.handleSave());
    await act(() => result.current.handleSave());
    const cli = lastBody().claude_cli;
    for (const k of ROSTER) expect(k in cli).toBe(false);
  });

  it("derived keys are absent from the PUT body", async () => {
    const { result } = await loaded();
    await act(() => result.current.handleSave());
    const body = lastBody();
    for (const k of [
      "effective_account_selection_mode",
      "account_selection_source",
      "fleet_account_selection_mode",
    ]) {
      expect(k in body).toBe(false);
      expect(k in body.claude_cli).toBe(false);
    }
  });
});

describe("load gating", () => {
  it("a failed load leaves Save gated and handleSave a no-op", async () => {
    getAiSettings.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loaded).toBe(false);
    expect(result.current.loadError).toBe("Failed to load AI settings");
    await act(() => result.current.handleSave());
    expect(saveAiSettings).not.toHaveBeenCalled();
  });
});

describe("derived read-out", () => {
  it("absent effective/source/fleet keys are UNKNOWN even with a local mode", async () => {
    const v = view();
    const old: Record<string, unknown> = { ...v };
    delete old.effective_account_selection_mode;
    delete old.account_selection_source;
    delete old.fleet_account_selection_mode;
    const { result } = await loaded(old as ReturnType<typeof view>);
    expect(result.current.derived).toEqual({});
    render(
      <ClaudeCliSettings
        config={result.current.claudeCli}
        onChange={() => {}}
        derived={result.current.derived}
      />
    );
    expect(screen.getByTestId("effective-mode").textContent).toContain(
      "unknown"
    );
    expect(screen.getByTestId("source").textContent).toContain("unknown");
    expect(screen.getByTestId("fleet-mode").textContent).toContain("unknown");
    expect(screen.queryByTestId("preview")).toBeNull();
  });

  it("fleet null reads no fleet opinion; fleet source says managed by fleet policy", async () => {
    const { result } = await loaded(
      view({}, { fleet_account_selection_mode: null })
    );
    expect(result.current.derived.fleet).toBeNull();
    render(
      <ClaudeCliSettings
        config={result.current.claudeCli}
        onChange={() => {}}
        derived={result.current.derived}
      />
    );
    expect(screen.getByTestId("fleet-mode").textContent).toContain(
      "no fleet opinion"
    );
    expect(screen.getByTestId("source").textContent).toBe(
      "Managed by fleet policy"
    );
    expect(screen.queryByTestId("preview")).toBeNull();
  });
});

describe("roster edits", () => {
  const edit = (r: { current: ReturnType<typeof useAiSettings> }, p: object) =>
    act(() => r.current.setClaudeCli({ ...r.current.claudeCli, ...p }));

  it("an edit to account_selection_mode alone sends only that key", async () => {
    const { result } = await loaded();
    edit(result, { account_selection_mode: "manual" });
    await act(() => result.current.handleSave());
    const cli = lastBody().claude_cli;
    expect(cli.account_selection_mode).toBe("manual");
    expect("config_dir" in cli).toBe(false);
    expect("account_selection_pinned" in cli).toBe(false);
  });

  it("roster keys absent on GET (older runner): an edit sends only the edited key", async () => {
    const v = view();
    const cli = v.claude_cli as Record<string, unknown>;
    for (const k of ROSTER) delete cli[k];
    const { result } = await loaded(v);
    await act(() => result.current.handleSave());
    for (const k of ROSTER) expect(k in lastBody().claude_cli).toBe(false);
    edit(result, { account_selection_pinned: true });
    await act(() => result.current.handleSave());
    const sent = lastBody().claude_cli;
    expect(sent.account_selection_pinned).toBe(true);
    expect("config_dir" in sent).toBe(false);
    expect("account_selection_mode" in sent).toBe(false);
  });

  it("an edit made while a save is in flight survives the save", async () => {
    const { result } = await loaded();
    let release!: () => void;
    saveAiSettings.mockImplementationOnce(
      () => new Promise<void>((r) => (release = r))
    );
    edit(result, { account_selection_mode: "manual" });
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.handleSave();
    });
    edit(result, { account_selection_mode: "highest_expected_usage" });
    await act(async () => {
      release();
      await saving;
    });
    expect(result.current.rosterDirty).toBe(true);
    await act(() => result.current.handleSave());
    expect(lastBody().claude_cli.account_selection_mode).toBe(
      "highest_expected_usage"
    );
  });

  it("rosterDirty is false when unedited, true after an edit, false after save", async () => {
    const { result } = await loaded();
    expect(result.current.rosterDirty).toBe(false);
    edit(result, { account_selection_pinned: true });
    expect(result.current.rosterDirty).toBe(true);
    await act(() => result.current.handleSave());
    expect(result.current.rosterDirty).toBe(false);
  });
});

describe("request sequencing", () => {
  it("a stale load response is ignored (last call wins)", async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    getAiSettings.mockImplementation(
      () => new Promise((r) => resolvers.push(r))
    );
    const { result } = renderHook(() => useAiSettings());
    await waitFor(() => expect(resolvers.length).toBe(1));
    act(() => {
      void result.current.retryLoad();
    });
    await waitFor(() => expect(resolvers.length).toBe(2));
    // The newer call answers first, then the older one arrives late.
    await act(async () =>
      resolvers[1](view({}, { effective_account_selection_mode: "new" }))
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () =>
      resolvers[0](view({}, { effective_account_selection_mode: "stale" }))
    );
    expect(result.current.derived.effective).toBe("new");
  });
});

describe("post-save refresh sequencing", () => {
  it("a stale post-save derived refresh is ignored when a newer load was called", async () => {
    const { result } = await loaded();
    const resolvers: Array<(v: unknown) => void> = [];
    getAiSettings.mockImplementation(
      () => new Promise((r) => resolvers.push(r))
    );
    await act(async () => {
      void result.current.handleSave();
    });
    await waitFor(() => expect(resolvers.length).toBe(1)); // refresh
    act(() => {
      void result.current.retryLoad();
    });
    await waitFor(() => expect(resolvers.length).toBe(2)); // newer load
    await act(async () =>
      resolvers[1](view({}, { effective_account_selection_mode: "new" }))
    );
    await waitFor(() => expect(result.current.derived.effective).toBe("new"));
    await act(async () =>
      resolvers[0](view({}, { effective_account_selection_mode: "stale" }))
    );
    expect(result.current.derived.effective).toBe("new");
  });
});

describe("preview", () => {
  it("renders only while the pin or local mode is dirty", async () => {
    const { result } = await loaded();
    const ui = () => (
      <ClaudeCliSettings
        config={result.current.claudeCli}
        onChange={() => {}}
        derived={result.current.derived}
        previewEnabled={result.current.rosterDirty}
      />
    );
    const r = render(ui());
    expect(screen.queryByTestId("preview")).toBeNull();
    act(() =>
      result.current.setClaudeCli({
        ...result.current.claudeCli,
        account_selection_pinned: true,
      })
    );
    r.rerender(ui());
    expect(screen.getByTestId("preview").textContent).toContain(
      "Would apply after save: least_usage"
    );
  });
});
