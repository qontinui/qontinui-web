/**
 * The two browser stores behind D2's middle arms: the tab session (with its
 * in-memory mirror) and the viewer convenience. Every read and write is
 * guarded; a storage that throws reads as "nothing stored".
 */

import { describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_MODE_STORAGE_KEY,
  UNREADABLE_SNAPSHOT,
  createPresentationModeStore,
  decodeStoreSnapshot,
} from "./presentationModeStore";

/** A minimal in-memory `Storage`. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

/** A `Storage` whose every method throws, like blocked site data. */
function throwingStorage(): Storage {
  const fail = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  return {
    length: 0,
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
}

describe("presentationModeStore", () => {
  it("starts with nothing stored, and serves an unreadable server snapshot", () => {
    const store = createPresentationModeStore({
      session: memoryStorage,
      viewer: memoryStorage,
    });
    expect(decodeStoreSnapshot(store.getSnapshot())).toEqual({
      readable: true,
      session: null,
      storage: null,
    });
    expect(store.getServerSnapshot()).toBe(UNREADABLE_SNAPSHOT);
    expect(decodeStoreSnapshot(UNREADABLE_SNAPSHOT)).toEqual({
      readable: false,
      session: null,
      storage: null,
    });
  });

  it("records a URL choice in the tab session only", () => {
    const session = memoryStorage();
    const viewer = memoryStorage();
    const store = createPresentationModeStore({
      session: () => session,
      viewer: () => viewer,
    });
    store.recordChoice(true, { remember: false });
    expect(session.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBe("1");
    expect(viewer.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBeNull();
    expect(decodeStoreSnapshot(store.getSnapshot())).toMatchObject({
      session: true,
      storage: null,
    });
  });

  it("records a toggle press in both stores", () => {
    const session = memoryStorage();
    const viewer = memoryStorage();
    const store = createPresentationModeStore({
      session: () => session,
      viewer: () => viewer,
    });
    store.recordChoice(false, { remember: true });
    expect(session.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBe("0");
    expect(viewer.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBe("0");
  });

  it("carries the tab's choice in memory when sessionStorage refuses it", () => {
    const store = createPresentationModeStore({
      session: throwingStorage,
      viewer: throwingStorage,
    });
    expect(() => store.recordChoice(true, { remember: true })).not.toThrow();
    // Following a link must not drop the lens just because storage is blocked.
    expect(decodeStoreSnapshot(store.getSnapshot())).toEqual({
      readable: true,
      session: true,
      storage: null,
    });
  });

  it("treats a storage GETTER that throws as no storage", () => {
    const store = createPresentationModeStore({
      session: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      viewer: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(decodeStoreSnapshot(store.getSnapshot())).toMatchObject({
      session: null,
      storage: null,
    });
    store.recordChoice(false, { remember: true });
    expect(decodeStoreSnapshot(store.getSnapshot()).session).toBe(false);
  });

  it("lets the tab's latest choice win over a stale sessionStorage copy", () => {
    // A refused write can leave sessionStorage one choice behind.
    let refuse = false;
    const backing = memoryStorage();
    const session: Storage = {
      ...backing,
      getItem: (k) => backing.getItem(k),
      setItem: (k, v) => {
        if (refuse) throw new DOMException("quota", "QuotaExceededError");
        backing.setItem(k, v);
      },
    };
    const store = createPresentationModeStore({
      session: () => session,
      viewer: memoryStorage,
    });
    store.recordChoice(true, { remember: false });
    refuse = true;
    store.recordChoice(false, { remember: false });
    expect(backing.getItem(PRESENTATION_MODE_STORAGE_KEY)).toBe("1");
    expect(decodeStoreSnapshot(store.getSnapshot()).session).toBe(false);
  });

  it("reads a choice an earlier page load left in sessionStorage", () => {
    const session = memoryStorage();
    session.setItem(PRESENTATION_MODE_STORAGE_KEY, "1");
    const store = createPresentationModeStore({
      session: () => session,
      viewer: memoryStorage,
    });
    expect(decodeStoreSnapshot(store.getSnapshot()).session).toBe(true);
  });

  it("keeps the snapshot referentially stable while nothing changes", () => {
    const store = createPresentationModeStore({
      session: memoryStorage,
      viewer: memoryStorage,
    });
    // A primitive, so `useSyncExternalStore` sees no change between renders.
    expect(typeof store.getSnapshot()).toBe("string");
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("notifies subscribers on a choice and on another tab's storage event", () => {
    const store = createPresentationModeStore({
      session: memoryStorage,
      viewer: memoryStorage,
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.recordChoice(true, { remember: false });
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage"));
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.recordChoice(false, { remember: false });
    window.dispatchEvent(new StorageEvent("storage"));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
