/**
 * The tab's tour state (plan `2026-10-23-console-presentation-spaces`
 * Phase 8): kept in sessionStorage with an in-memory mirror, every access
 * guarded — a convenience, never an authority, and never a remembered
 * preference (it does not touch localStorage).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OFF_TOUR_SNAPSHOT,
  TOUR_STORAGE_KEY,
  createTourStore,
  decodeTourState,
  encodeTourState,
} from "./tourStore";

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("the snapshot", () => {
  it("round-trips the state", () => {
    for (const state of [
      { onTour: false, lastStopId: null },
      { onTour: true, lastStopId: null },
      { onTour: true, lastStopId: "ui-bridge" as const },
    ]) {
      expect(decodeTourState(encodeTourState(state))).toEqual(state);
    }
  });

  it("reads anything it did not write as off the tour", () => {
    for (const raw of [null, undefined, "", "1", "yes|ui-bridge", "1|ui-bridge|x", "true"]) {
      expect(decodeTourState(raw)).toEqual({ onTour: false, lastStopId: null });
    }
  });

  it("reads a stop id this build does not know as no stop", () => {
    expect(decodeTourState("1|no-such-stop")).toEqual({
      onTour: true,
      lastStopId: null,
    });
  });
});

describe("createTourStore", () => {
  it("starts off the tour, and reports off on a server or hydration render", () => {
    const store = createTourStore();
    expect(store.getSnapshot()).toBe(OFF_TOUR_SNAPSHOT);
    expect(store.getServerSnapshot()).toBe(OFF_TOUR_SNAPSHOT);
  });

  it("puts the tab on the tour, remembers the last stop, and ends it — in this tab's sessionStorage", () => {
    const store = createTourStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.startTour();
    expect(decodeTourState(store.getSnapshot())).toEqual({
      onTour: true,
      lastStopId: null,
    });
    store.recordStop("dev-ops");
    expect(decodeTourState(store.getSnapshot()).lastStopId).toBe("dev-ops");
    expect(window.sessionStorage.getItem(TOUR_STORAGE_KEY)).toBe("1|dev-ops");

    store.endTour();
    expect(store.getSnapshot()).toBe(OFF_TOUR_SNAPSHOT);
    expect(window.sessionStorage.getItem(TOUR_STORAGE_KEY)).toBe("0|-");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("does not notify for a change that changes nothing", () => {
    const store = createTourStore();
    store.startTour();
    store.recordStop("ui-bridge");
    const listener = vi.fn();
    store.subscribe(listener);
    store.startTour();
    store.recordStop("ui-bridge");
    expect(listener).not.toHaveBeenCalled();
  });

  it("carries the tour over a reload of the tab", () => {
    createTourStore().startTour();
    // A fresh store is a reloaded page: no memory, the tab's storage only.
    expect(decodeTourState(createTourStore().getSnapshot()).onTour).toBe(true);
  });

  it("never writes a remembered preference", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const store = createTourStore();
    store.startTour();
    store.recordStop("digital-twin");
    store.endTour();
    expect(window.localStorage.length).toBe(0);
    for (const call of setItem.mock.contexts) {
      expect(call).toBe(window.sessionStorage);
    }
  });

  it("keeps the state in memory when sessionStorage refuses, or cannot even be reached", () => {
    const refusing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    } as unknown as Storage;
    const store = createTourStore({ session: () => refusing });
    expect(store.getSnapshot()).toBe(OFF_TOUR_SNAPSHOT);
    store.startTour();
    store.recordStop("ui-bridge");
    expect(decodeTourState(store.getSnapshot())).toEqual({
      onTour: true,
      lastStopId: "ui-bridge",
    });

    const unreachable = createTourStore({
      session: () => {
        throw new Error("SecurityError");
      },
    });
    expect(unreachable.getSnapshot()).toBe(OFF_TOUR_SNAPSHOT);
    unreachable.startTour();
    expect(decodeTourState(unreachable.getSnapshot()).onTour).toBe(true);
  });

  it("stops notifying an unsubscribed listener", () => {
    const store = createTourStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.startTour();
    expect(listener).not.toHaveBeenCalled();
  });
});
