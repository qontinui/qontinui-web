/**
 * The presentation scope loader (plan `2026-10-23-console-presentation-spaces`
 * D3.3, D3.4): the wire record becomes the redaction state, one read serves the
 * tab, a read never serves another project, and every failure withholds.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationScopeRecord } from "@/lib/api/presentationScope";
import { ACTIVE_TENANT_STORAGE_KEY } from "@/services/http-client";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import {
  FixedPresentationMode,
  PresentationModeProvider,
} from "./PresentationModeProvider";
import {
  createPresentationScopeStore,
  presentationScopeStateOf,
  usePresentationScope,
  type PresentationScopeStore,
} from "./presentationScopeLoader";
import {
  UNREADABLE_SNAPSHOT,
  type PresentationModeStore,
} from "./presentationModeStore";

function record(
  overrides: Partial<PresentationScopeRecord> = {}
): PresentationScopeRecord {
  return {
    tenant_id: "00000000-0000-0000-0000-00000000000a",
    first_party_owners: ["qontinui"],
    first_party_owners_source: "registered_repos",
    first_party_owners_unknown_reason: null,
    confidential_terms: ["Acme Corp"],
    configured: {
      first_party_owners: null,
      confidential_terms: [],
      version: 0,
      updated_at: null,
      updated_by: null,
    },
    defaults: {
      registered_repo_owners: ["qontinui"],
      registered_repo_owners_unknown_reason: null,
      viewer_other_tenant_names: ["Acme Corp"],
    },
    can_edit: false,
    ...overrides,
  };
}

/** A load the test resolves or rejects by hand, counting every call. */
function manualLoad() {
  const calls: Array<{
    resolve: (r: PresentationScopeRecord) => void;
    reject: (e: unknown) => void;
    signal: AbortSignal;
  }> = [];
  const load = vi.fn(
    (signal: AbortSignal) =>
      new Promise<PresentationScopeRecord>((resolve, reject) => {
        calls.push({ resolve, reject, signal });
      })
  );
  return { load, calls };
}

interface Rig {
  store: PresentationScopeStore;
  calls: ReturnType<typeof manualLoad>["calls"];
  load: ReturnType<typeof manualLoad>["load"];
  clock: { t: number };
  selection: { value: string | null };
}

function rig(): Rig {
  const { load, calls } = manualLoad();
  const clock = { t: 1_000_000 };
  const selection = { value: "project-a" as string | null };
  const store = createPresentationScopeStore({
    load,
    now: () => clock.t,
    readSelection: () => selection.value,
    maxAgeMs: 60_000,
    retryMs: 15_000,
    watchStorage: false,
  });
  return { store, calls, load, clock, selection };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("presentationScopeStateOf", () => {
  it("maps the wire lists to the camelCase scope", () => {
    expect(presentationScopeStateOf(record())).toEqual({
      status: "ready",
      scope: {
        firstPartyOwners: ["qontinui"],
        confidentialTerms: ["Acme Corp"],
      },
    });
  });

  it("an empty owner list is a real (withhold-everything) scope", () => {
    expect(
      presentationScopeStateOf(record({ first_party_owners: [] }))
    ).toEqual({
      status: "ready",
      scope: { firstPartyOwners: [], confidentialTerms: ["Acme Corp"] },
    });
  });

  it("unknown first-party owners are an error, never an empty list", () => {
    const state = presentationScopeStateOf(
      record({
        first_party_owners: null,
        first_party_owners_unknown_reason: "coord_unreachable",
      })
    );
    expect(state.status).toBe("error");
    expect(state.status === "error" && state.reason).toContain(
      "coord_unreachable"
    );
  });
});

describe("the store", () => {
  it("costs one read however many callers ask", async () => {
    const r = rig();
    r.store.ensureFresh();
    r.store.ensureFresh();
    void r.store.reload();
    expect(r.load).toHaveBeenCalledTimes(1);
    expect(r.store.getSnapshot().state).toEqual({ status: "loading" });
    r.calls[0].resolve(record());
    await flush();
    expect(r.store.getSnapshot().state.status).toBe("ready");
    expect(r.store.getSnapshot().selection).toBe("project-a");
    r.store.ensureFresh();
    expect(r.load).toHaveBeenCalledTimes(1);
  });

  it("reads again once the scope is past its age, serving the held one meanwhile", async () => {
    const r = rig();
    r.store.ensureFresh();
    r.calls[0].resolve(record());
    await flush();
    r.clock.t += 59_999;
    expect(r.store.msUntilRecheck()).toBe(1);
    r.store.ensureFresh();
    expect(r.load).toHaveBeenCalledTimes(1);
    r.clock.t += 1;
    r.store.ensureFresh();
    expect(r.load).toHaveBeenCalledTimes(2);
    // The refresh does not blank a presentation that is already showing titles.
    expect(r.store.getSnapshot().state.status).toBe("ready");
    expect(r.store.msUntilRecheck()).toBeNull();
    r.calls[1].resolve(record({ confidential_terms: ["Acme Corp", "Globex"] }));
    await flush();
    const state = r.store.getSnapshot().state;
    expect(state.status === "ready" && state.scope.confidentialTerms).toEqual([
      "Acme Corp",
      "Globex",
    ]);
  });

  it("never serves a scope read under another project selection", async () => {
    const r = rig();
    r.store.ensureFresh();
    r.calls[0].resolve(record());
    await flush();
    r.selection.value = "project-b";
    expect(r.store.msUntilRecheck()).toBe(0);
    r.store.ensureFresh();
    expect(r.load).toHaveBeenCalledTimes(2);
    // Project A's lists are gone while B's are read.
    expect(r.store.getSnapshot().state).toEqual({ status: "loading" });
    expect(r.store.getSnapshot().record).toBeNull();
  });

  it("a failed read withholds, and is retried only after the retry delay", async () => {
    const r = rig();
    r.store.ensureFresh();
    r.calls[0].reject(new Error("HTTP 503"));
    await flush();
    expect(r.store.getSnapshot().state).toEqual({
      status: "error",
      reason: "HTTP 503",
    });
    r.store.ensureFresh();
    expect(r.load).toHaveBeenCalledTimes(1);
    r.clock.t += 15_000;
    r.store.ensureFresh();
    expect(r.load).toHaveBeenCalledTimes(2);
    r.calls[1].resolve(record());
    await flush();
    expect(r.store.getSnapshot().state.status).toBe("ready");
    expect(r.store.getSnapshot().failure).toBeNull();
  });

  it("a failed refresh withholds too: a held scope does not outlive a failure", async () => {
    const r = rig();
    r.store.ensureFresh();
    r.calls[0].resolve(record());
    await flush();
    r.clock.t += 60_000;
    r.store.ensureFresh();
    r.calls[1].reject(new Error("HTTP 502"));
    await flush();
    expect(r.store.getSnapshot().state.status).toBe("error");
  });

  it("accept holds a save's answer at once and discards a read in flight", async () => {
    const r = rig();
    r.store.ensureFresh();
    const saved = record({ confidential_terms: ["Initech"] });
    expect(r.store.accept(saved, r.store.currentSelection())).toBe(true);
    expect(r.calls[0].signal.aborted).toBe(true);
    expect(r.store.getSnapshot().record).toBe(saved);
    expect(r.store.getSnapshot().selection).toBe("project-a");
    // The stale read resolving late changes nothing.
    r.calls[0].resolve(record({ confidential_terms: ["stale"] }));
    await flush();
    expect(r.store.getSnapshot().record).toBe(saved);
    r.store.ensureFresh();
    expect(r.load).toHaveBeenCalledTimes(1);
  });

  it("does not hold a save's answer that lands after another tab switched project", async () => {
    // A save sent under project A; another tab switches to B while it is in
    // flight (the storage event invalidates), and this tab starts reading B.
    const r = rig();
    const sentUnder = r.store.currentSelection();
    r.store.invalidate();
    r.selection.value = "project-b";
    r.store.ensureFresh();
    expect(r.load).toHaveBeenCalledTimes(1);

    const savedForA = record({ confidential_terms: ["Initech"] });
    expect(r.store.accept(savedForA, sentUnder)).toBe(false);
    // Nothing of A's is held — not as B's, not at all — and B's read stands.
    expect(r.store.getSnapshot().record).toBeNull();
    expect(r.store.getSnapshot().state).toEqual({ status: "loading" });
    expect(r.calls[0].signal.aborted).toBe(false);
    r.calls[0].resolve(record({ confidential_terms: ["Globex"] }));
    await flush();
    const state = r.store.getSnapshot().state;
    expect(state.status === "ready" && state.scope.confidentialTerms).toEqual([
      "Globex",
    ]);
  });

  it("does not hold a save's answer when the selection changed with no storage event", async () => {
    // A selection this tab changes without reloading fires no storage event
    // here, so nothing invalidates: the selection itself must be compared.
    const r = rig();
    r.store.ensureFresh();
    r.calls[0].resolve(record());
    await flush();
    const sentUnder = r.store.currentSelection();
    r.selection.value = "project-b";
    expect(
      r.store.accept(record({ confidential_terms: ["Initech"] }), sentUnder)
    ).toBe(false);
    expect(r.store.getSnapshot().selection).toBe("project-a");
    expect(r.store.msUntilRecheck()).toBe(0);
  });

  it("invalidate forgets everything, and a read in flight cannot bring it back", async () => {
    const r = rig();
    r.store.ensureFresh();
    r.store.invalidate();
    r.calls[0].resolve(record());
    await flush();
    expect(r.store.getSnapshot().state).toEqual({ status: "unknown" });
    expect(r.store.getSnapshot().record).toBeNull();
  });
});

describe("another tab switching project", () => {
  afterEach(() => window.localStorage.clear());

  it("drops the held scope on the active-project storage event", async () => {
    const { load, calls } = manualLoad();
    const store = createPresentationScopeStore({ load, watchStorage: true });
    const unsubscribe = store.subscribe(() => {});
    store.ensureFresh();
    calls[0].resolve(record());
    await flush();
    expect(store.getSnapshot().state.status).toBe("ready");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "unrelated-key", newValue: "x" })
      );
    });
    expect(store.getSnapshot().state.status).toBe("ready");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: ACTIVE_TENANT_STORAGE_KEY,
          newValue: "project-b",
        })
      );
    });
    expect(store.getSnapshot().state).toEqual({ status: "unknown" });
    unsubscribe();
  });
});

function ScopeProbe({ store }: { store: PresentationScopeStore }) {
  const state = usePresentationScope(store);
  return <span data-testid="scope">{state.status}</span>;
}

describe("usePresentationScope", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/admin/coord/devops");
  });

  it("reads while presenting, and the page gets the state", async () => {
    const r = rig();
    render(
      <FixedPresentationMode presenting>
        <ScopeProbe store={r.store} />
      </FixedPresentationMode>
    );
    await flush();
    expect(r.load).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("scope")).toHaveTextContent("loading");
    r.calls[0].resolve(record());
    await flush();
    expect(screen.getByTestId("scope")).toHaveTextContent("ready");
  });

  it("reads nothing in operator mode", async () => {
    const r = rig();
    render(
      <FixedPresentationMode presenting={false}>
        <ScopeProbe store={r.store} />
      </FixedPresentationMode>
    );
    await flush();
    expect(r.load).not.toHaveBeenCalled();
    expect(screen.getByTestId("scope")).toHaveTextContent("unknown");
  });

  it("reads nothing while the mode is unresolved, which still withholds", async () => {
    const unreadable: PresentationModeStore = {
      subscribe: () => () => {},
      getSnapshot: () => UNREADABLE_SNAPSHOT,
      getServerSnapshot: () => UNREADABLE_SNAPSHOT,
      recordChoice: () => {},
    };
    const r = rig();
    render(
      <PresentationModeProvider store={unreadable}>
        <ScopeProbe store={r.store} />
      </PresentationModeProvider>
    );
    await flush();
    expect(r.load).not.toHaveBeenCalled();
    expect(screen.getByTestId("scope")).toHaveTextContent("unknown");
  });

  it("serves loading, not another project's ready scope, after a switch", async () => {
    const r = rig();
    r.store.ensureFresh();
    r.calls[0].resolve(record());
    await flush();
    r.selection.value = "project-b";
    render(
      <FixedPresentationMode presenting>
        <ScopeProbe store={r.store} />
      </FixedPresentationMode>
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("loading");
    await flush();
    expect(r.load).toHaveBeenCalledTimes(2);
  });

  it("re-reads on its own once the scope ages out while presenting", async () => {
    vi.useFakeTimers();
    try {
      const { load, calls } = manualLoad();
      let t = 5_000_000;
      const store = createPresentationScopeStore({
        load,
        now: () => t,
        readSelection: () => "project-a",
        maxAgeMs: 60_000,
        watchStorage: false,
      });
      render(
        <FixedPresentationMode presenting>
          <ScopeProbe store={store} />
        </FixedPresentationMode>
      );
      await act(async () => {
        await Promise.resolve();
      });
      calls[0].resolve(record());
      await act(async () => {
        await Promise.resolve();
      });
      expect(load).toHaveBeenCalledTimes(1);
      t += 60_000;
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
