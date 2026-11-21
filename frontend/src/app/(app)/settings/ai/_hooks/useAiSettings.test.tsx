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

import { useAiSettings, FLEET_UNREAD_REFRESH_MS } from "./useAiSettings";
import {
  ClaudeCliSettings,
  FLEET_UNREAD_LABEL,
} from "../_components/ClaudeCliSettings";

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
      "fleet_account_selection_answered",
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
        previewEnabled
      />
    );
    expect(screen.getByTestId("effective-mode").textContent).toContain(
      "unknown"
    );
    expect(screen.getByTestId("source").textContent).toContain("unknown");
    expect(screen.getByTestId("fleet-mode").textContent).toContain("unknown");
    expect(screen.getByTestId("preview").textContent).toContain("unknown");
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
        previewEnabled
      />
    );
    expect(screen.getByTestId("fleet-mode").textContent).toContain(
      "no fleet opinion"
    );
    expect(screen.getByTestId("source").textContent).toBe(
      "Managed by fleet policy"
    );
    expect(screen.getByTestId("preview").textContent).toContain(
      "Would apply after save: least_usage"
    );
  });

  it("fleet absent but pinned: preview is the local mode", async () => {
    const old: Record<string, unknown> = view({
      account_selection_pinned: true,
    });
    delete old.fleet_account_selection_mode;
    const { result } = await loaded(old as ReturnType<typeof view>);
    render(
      <ClaudeCliSettings
        config={result.current.claudeCli}
        onChange={() => {}}
        derived={result.current.derived}
        previewEnabled
      />
    );
    expect(screen.getByTestId("preview").textContent).toContain(
      "Would apply after save: least_usage"
    );
  });
});

describe("derived read-out — fleet domain not yet answered (runner#2357)", () => {
  const unread = (cli = {}, extra = {}) =>
    view(cli, {
      account_selection_source: "local",
      fleet_account_selection_mode: null,
      fleet_account_selection_answered: false,
      ...extra,
    });

  it("unpinned: source and fleet are not-read-yet, never local / no opinion", async () => {
    const { result } = await loaded(unread());
    expect(result.current.derived).toEqual({
      effective: "manual",
      fleetUnread: true,
    });
    render(
      <ClaudeCliSettings
        config={result.current.claudeCli}
        onChange={() => {}}
        derived={result.current.derived}
        previewEnabled
      />
    );
    expect(screen.getByTestId("source").textContent).toBe(FLEET_UNREAD_LABEL);
    expect(screen.getByTestId("fleet-mode").textContent).toContain(
      "not read yet"
    );
    expect(screen.getByTestId("fleet-mode").textContent).not.toContain(
      "no fleet opinion"
    );
    expect(screen.getByTestId("preview").textContent).toContain("unknown");
  });

  it("pinned keeps its source: no fleet answer can change a pin", async () => {
    const { result } = await loaded(
      unread(
        { account_selection_pinned: true },
        { account_selection_source: "pinned" }
      )
    );
    expect(result.current.derived.source).toBe("pinned");
    expect(result.current.derived.fleetUnread).toBe(true);
  });

  it("a non-null fleet value is an answer whatever the flag says", async () => {
    const { result } = await loaded(
      unread(
        {},
        {
          account_selection_source: "fleet",
          fleet_account_selection_mode: "manual",
        }
      )
    );
    expect(result.current.derived).toEqual({
      effective: "manual",
      source: "fleet",
      fleet: "manual",
    });
  });

  it("answered: true with a null fleet value is a definite no-opinion", async () => {
    const { result } = await loaded(
      unread({}, { fleet_account_selection_answered: true })
    );
    expect(result.current.derived).toEqual({
      effective: "manual",
      source: "local",
      fleet: null,
    });
  });

  it("re-reads the read-out until the runner reports an answer, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result } = await loaded(unread());
      expect(result.current.derived.fleetUnread).toBe(true);
      const callsBefore = getAiSettings.mock.calls.length;
      getAiSettings.mockResolvedValue(
        unread({}, { fleet_account_selection_answered: true })
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FLEET_UNREAD_REFRESH_MS);
      });
      expect(getAiSettings.mock.calls.length).toBe(callsBefore + 1);
      expect(result.current.derived).toEqual({
        effective: "manual",
        source: "local",
        fleet: null,
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FLEET_UNREAD_REFRESH_MS * 3);
      });
      expect(getAiSettings.mock.calls.length).toBe(callsBefore + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a read slower than the interval still lands, with no overlapping read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result } = await loaded(unread());
      const callsBefore = getAiSettings.mock.calls.length;
      let resolveSlow: (v: unknown) => void = () => {};
      getAiSettings.mockImplementation(
        () => new Promise((r) => (resolveSlow = r))
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FLEET_UNREAD_REFRESH_MS);
      });
      // In flight for three more intervals: no second read is started.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FLEET_UNREAD_REFRESH_MS * 3);
      });
      expect(getAiSettings.mock.calls.length).toBe(callsBefore + 1);
      await act(async () => {
        resolveSlow(unread({}, { fleet_account_selection_answered: true }));
      });
      expect(result.current.derived).toEqual({
        effective: "manual",
        source: "local",
        fleet: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a poll that lands after a reload started is dropped", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result } = await loaded(unread());
      let resolveSlow: (v: unknown) => void = () => {};
      getAiSettings.mockImplementationOnce(
        () => new Promise((r) => (resolveSlow = r))
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FLEET_UNREAD_REFRESH_MS);
      });
      // A reload starts (and lands, still unread) while the poll is in flight.
      getAiSettings.mockResolvedValue(unread());
      await act(() => result.current.retryLoad());
      await act(async () => {
        resolveSlow(
          unread(
            {},
            {
              account_selection_source: "fleet",
              fleet_account_selection_mode: "least_usage",
            }
          )
        );
      });
      expect(result.current.derived.fleetUnread).toBe(true);
      expect(result.current.derived.fleet).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never re-reads while the fleet domain is answered", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await loaded(unread({}, { fleet_account_selection_answered: true }));
      const callsBefore = getAiSettings.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FLEET_UNREAD_REFRESH_MS * 3);
      });
      expect(getAiSettings.mock.calls.length).toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
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
    expect(result.current.loading).toBe(false);
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

describe("save racing a reload", () => {
  it("a reload that resolves while a save is in flight is not overwritten by the saved snapshot", async () => {
    const { result } = await loaded();
    let release!: () => void;
    saveAiSettings.mockImplementationOnce(
      () => new Promise<void>((r) => (release = r))
    );
    act(() =>
      result.current.setClaudeCli({
        ...result.current.claudeCli,
        account_selection_mode: "manual",
      })
    );
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.handleSave();
    });
    getAiSettings.mockResolvedValue(
      view({ account_selection_mode: "highest_expected_usage" })
    );
    await act(() => result.current.retryLoad());
    expect(result.current.claudeCli.account_selection_mode).toBe(
      "highest_expected_usage"
    );
    await act(async () => {
      release();
      await saving;
    });
    expect(result.current.rosterDirty).toBe(false);
    await act(() => result.current.handleSave());
    for (const k of ROSTER) expect(k in lastBody().claude_cli).toBe(false);
  });

  it("overlapping saves with out-of-order refreshes keep the newer derived", async () => {
    const { result } = await loaded();
    const resolvers: Array<(v: unknown) => void> = [];
    getAiSettings.mockImplementation(
      () => new Promise((r) => resolvers.push(r))
    );
    await act(async () => {
      void result.current.handleSave();
    });
    await act(async () => {
      void result.current.handleSave();
    });
    await waitFor(() => expect(resolvers.length).toBe(2));
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

describe("save while a reload is in flight", () => {
  it("handleSave is a no-op while a (re)load is pending", async () => {
    const hook = await loaded();
    let resolveReload!: (v: unknown) => void;
    getAiSettings.mockReturnValueOnce(
      new Promise((r) => {
        resolveReload = r;
      }),
    );
    act(() => {
      void hook.result.current.retryLoad();
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(true));
    await act(async () => {
      await hook.result.current.handleSave();
    });
    expect(saveAiSettings).not.toHaveBeenCalled();
    await act(async () => {
      resolveReload(view());
    });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
  });
});
