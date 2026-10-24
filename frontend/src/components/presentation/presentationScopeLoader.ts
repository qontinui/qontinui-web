"use client";

/**
 * presentationScopeLoader — the ONE read presentation mode makes (plan
 * `2026-10-23-console-presentation-spaces` D3.3, D3.4).
 *
 * `RedactedText` lets a title through only when the tenant's presentation
 * scope says it may (`redaction.ts`). The scope lives behind
 * `GET /api/v1/presentation/scope`; this module reads it, holds it for the
 * tab, and turns the wire record into the `PresentationScopeState` the
 * redaction primitives read through `PresentationScopeProvider`.
 *
 * - **Only while presenting.** `usePresentationScope` reads nothing in
 *   operator mode (nothing redacts there) or while the mode is still
 *   `unresolved`; D3.4's "nothing new is fetched for presentation mode"
 *   admits exactly this read, and `noNetwork.test.tsx` holds it to one.
 * - **One read per tab, not per page.** The store is module-wide, so a client
 *   navigation inside the console — or into the twin — reuses what was read.
 *   It is read again once it is {@link PRESENTATION_SCOPE_MAX_AGE_MS} old, so
 *   an admin's edit in another browser reaches a running presentation within
 *   a minute; during that refresh the held scope keeps serving.
 * - **Never another project's.** The record is keyed on the active-project
 *   selection the request carried (`readActiveTenantId`, the same value
 *   `HttpClient` sends as `X-Qontinui-Active-Tenant`). A held record read
 *   under another selection is never served: it reads as `loading` and is read
 *   again. That check, made on every render, is what covers a selection this
 *   tab changes without reloading (the sessions page's tenant switcher, the
 *   tenant list replacing a stale selection), which fires no `storage` event
 *   here. Another tab switching project does fire one, which drops the held
 *   record at once.
 * - **A save's answer is held only for the project it was saved under.** The
 *   form reads the selection before it sends a save and hands it to `accept`
 *   with the answer, which is held only when the selection is still that
 *   one: an answer that lands after the project changed is another project's
 *   scope, and holding it under the new selection would redact the new
 *   project's pages by the old project's lists — failing OPEN on the new
 *   project's own names.
 * - **Unknown fails closed.** A failed read is `error`; a record whose
 *   first-party owners are unknown (coord could not list the registered
 *   repositories) is `error` too — an empty list would be a decision nobody
 *   made. Both withhold every title. A failed read is retried after
 *   {@link PRESENTATION_SCOPE_RETRY_MS}.
 *
 * The tenant-policy page's form (`PresentationScopePanel`, operator mode only)
 * reads the same store (`record`) — asking for the read itself, since nothing
 * there is presenting — and hands it the saved answer (`accept`, with the
 * selection the save was sent under), so a save is in force in this tab
 * immediately. After a save that did not answer it re-reads with
 * `rereadNow`, which starts a read AFTER the save (never joining one sent
 * before it) and says how that read went, so the form says what it observed.
 *
 * This is the presentation folder's only network module, and
 * `noNetwork.test.tsx` names it as such.
 */

import { useEffect, useSyncExternalStore } from "react";
import {
  fetchPresentationScope,
  type PresentationScopeRecord,
} from "@/lib/api/presentationScope";
import {
  ACTIVE_TENANT_STORAGE_KEY,
  readActiveTenantId,
} from "@/services/http-client";
import { usePresentationMode } from "./PresentationModeProvider";
import {
  PRESENTATION_SCOPE_UNKNOWN,
  type PresentationScopeState,
} from "./presentationScope";

/** How long a read scope serves before presentation mode reads it again. */
export const PRESENTATION_SCOPE_MAX_AGE_MS = 60_000;

/** How long after a failed read the next one waits. */
export const PRESENTATION_SCOPE_RETRY_MS = 15_000;

const LOADING: PresentationScopeState = { status: "loading" };

/** Everything the store holds; `state` is what the redaction primitives read. */
export interface PresentationScopeSnapshot {
  readonly state: PresentationScopeState;
  /** The last record read for `selection` — the tenant-policy form's source. */
  readonly record: PresentationScopeRecord | null;
  /** The active-project selection `record` was read under (`null`: none). */
  readonly selection: string | null;
  /** When `record` was read, in ms since the epoch. */
  readonly loadedAt: number | null;
  /** When the last read failed, and why; both `null` after a success. */
  readonly failedAt: number | null;
  readonly failure: string | null;
}

const NOTHING_READ: PresentationScopeSnapshot = {
  state: PRESENTATION_SCOPE_UNKNOWN,
  record: null,
  selection: null,
  loadedAt: null,
  failedAt: null,
  failure: null,
};

/**
 * The wire record as the redaction primitives read it. First-party owners the
 * server could not establish are `error`, never an empty list.
 */
export function presentationScopeStateOf(
  record: PresentationScopeRecord
): PresentationScopeState {
  if (record.first_party_owners === null) {
    return {
      status: "error",
      reason: `first-party owners unknown (${
        record.first_party_owners_unknown_reason ?? "no reason given"
      })`,
    };
  }
  return {
    status: "ready",
    scope: {
      firstPartyOwners: [...record.first_party_owners],
      confidentialTerms: [...record.confidential_terms],
    },
  };
}

/** How a re-read the caller started went (`rereadNow`). */
export type PresentationScopeReread =
  | { readonly status: "read"; readonly record: PresentationScopeRecord }
  | { readonly status: "failed"; readonly failure: string }
  /**
   * Its answer was discarded unread: `accept` or `invalidate` (another tab
   * changed the active project) replaced the world it was read for.
   */
  | { readonly status: "superseded" };

const SUPERSEDED: PresentationScopeReread = { status: "superseded" };

export interface PresentationScopeStoreOptions {
  /** The read. Default: `fetchPresentationScope`. */
  load?: (signal: AbortSignal) => Promise<PresentationScopeRecord>;
  /** The selection a request would carry now. Default: `readActiveTenantId`. */
  readSelection?: () => string | null;
  now?: () => number;
  maxAgeMs?: number;
  retryMs?: number;
  /** Drop the held record when another tab changes the active project.
   *  Default: true in a browser. */
  watchStorage?: boolean;
}

export interface PresentationScopeStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PresentationScopeSnapshot;
  getServerSnapshot(): PresentationScopeSnapshot;
  /**
   * Read when the held record is missing, another project's, older than the
   * max age, or a failed read's retry is due. A no-op while a read is in
   * flight, so any number of callers cost one request.
   */
  ensureFresh(): void;
  /** Read now, whatever is held (joins a read already in flight). */
  reload(): Promise<void>;
  /**
   * Read again NOW, abandoning any read already in flight — one sent before
   * the caller's reason to re-read (a save that did not answer) may carry
   * what was stored before it — and say how THIS read went.
   */
  rereadNow(): Promise<PresentationScopeReread>;
  /**
   * Hold `record` — a save's answer — as the active project's scope, but only
   * while the selection is still `sentUnder`, the one the save's request
   * carried (read with {@link currentSelection} just before sending). Returns
   * whether it was held; an answer that is not is left for a read of the
   * project selected now to replace.
   */
  accept(record: PresentationScopeRecord, sentUnder: string | null): boolean;
  /** Forget everything read: the active project changed outside this tab. */
  invalidate(): void;
  /** Ms until `ensureFresh` would read again; `null` while a read is in flight. */
  msUntilRecheck(): number | null;
  /** The selection a request would carry right now. */
  currentSelection(): string | null;
}

function failureText(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : "the presentation scope could not be read";
}

export function createPresentationScopeStore(
  options: PresentationScopeStoreOptions = {}
): PresentationScopeStore {
  const load =
    options.load ??
    ((signal: AbortSignal) => fetchPresentationScope({ signal }));
  const readSelection = options.readSelection ?? readActiveTenantId;
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? PRESENTATION_SCOPE_MAX_AGE_MS;
  const retryMs = options.retryMs ?? PRESENTATION_SCOPE_RETRY_MS;
  const watchStorage = options.watchStorage ?? typeof window !== "undefined";

  let snapshot = NOTHING_READ;
  let inflight: Promise<PresentationScopeReread> | null = null;
  let controller: AbortController | null = null;
  // Bumped by `accept` and `invalidate`: a read started before either answers
  // for a world that no longer exists, and is discarded.
  let generation = 0;
  const listeners = new Set<() => void>();
  let unwatch: (() => void) | null = null;

  const set = (next: PresentationScopeSnapshot) => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  const abandonRead = () => {
    generation += 1;
    controller?.abort();
    controller = null;
    inflight = null;
  };

  const read = (): Promise<PresentationScopeReread> => {
    if (inflight) return inflight;
    const selection = readSelection();
    const mine = generation;
    const ac = new AbortController();
    controller = ac;
    const held = snapshot;
    const sameProject = held.selection === selection;
    // A refresh of a ready scope for the same project keeps serving it.
    if (!(held.state.status === "ready" && sameProject)) {
      set({
        ...(sameProject ? held : NOTHING_READ),
        state: LOADING,
        selection,
      });
    }
    inflight = (async (): Promise<PresentationScopeReread> => {
      try {
        const record = await load(ac.signal);
        if (mine !== generation) return SUPERSEDED;
        set({
          state: presentationScopeStateOf(record),
          record,
          selection,
          loadedAt: now(),
          failedAt: null,
          failure: null,
        });
        return { status: "read", record };
      } catch (err) {
        if (mine !== generation) return SUPERSEDED;
        const failure = failureText(err);
        set({
          ...snapshot,
          state: { status: "error", reason: failure },
          selection,
          failedAt: now(),
          failure,
        });
        return { status: "failed", failure };
      } finally {
        if (mine === generation) {
          inflight = null;
          controller = null;
        }
      }
    })();
    return inflight;
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === ACTIVE_TENANT_STORAGE_KEY) {
      store.invalidate();
    }
  };

  const store: PresentationScopeStore = {
    subscribe(listener) {
      listeners.add(listener);
      if (watchStorage && unwatch === null && typeof window !== "undefined") {
        window.addEventListener("storage", onStorage);
        unwatch = () => window.removeEventListener("storage", onStorage);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && unwatch !== null) {
          unwatch();
          unwatch = null;
        }
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => NOTHING_READ,
    currentSelection: () => readSelection(),
    msUntilRecheck() {
      if (inflight) return null;
      const held = snapshot;
      if (held.selection !== readSelection()) return 0;
      const t = now();
      if (held.failedAt !== null) {
        return Math.max(0, held.failedAt + retryMs - t);
      }
      if (held.loadedAt === null) return 0;
      return Math.max(0, held.loadedAt + maxAgeMs - t);
    },
    ensureFresh() {
      if (store.msUntilRecheck() === 0) void read();
    },
    reload: async () => {
      await read();
    },
    rereadNow() {
      abandonRead();
      return read();
    },
    accept(record, sentUnder) {
      if (sentUnder !== readSelection()) return false;
      abandonRead();
      set({
        state: presentationScopeStateOf(record),
        record,
        selection: sentUnder,
        loadedAt: now(),
        failedAt: null,
        failure: null,
      });
      return true;
    },
    invalidate() {
      abandonRead();
      set(NOTHING_READ);
    },
  };
  return store;
}

/** The tab's store: every lens tree and the tenant-policy form share it. */
export const defaultPresentationScopeStore: PresentationScopeStore =
  createPresentationScopeStore();

/** Everything the store holds, re-rendering on change. */
export function usePresentationScopeSnapshot(
  store: PresentationScopeStore = defaultPresentationScopeStore
): PresentationScopeSnapshot {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  );
}

/**
 * The scope the redaction primitives apply, read while — and only while —
 * the lens is presenting. Mounted once, by `PresentationLens`.
 */
export function usePresentationScope(
  store: PresentationScopeStore = defaultPresentationScopeStore
): PresentationScopeState {
  const { presenting, source } = usePresentationMode();
  const snapshot = usePresentationScopeSnapshot(store);
  // `unresolved` is presenting for every guard, but the mode may yet resolve
  // to off: reading on it would spend a request an operator never needed.
  const active = presenting && source !== "unresolved";

  useEffect(() => {
    if (!active) return;
    store.ensureFresh();
    const delay = store.msUntilRecheck();
    if (delay === null) return;
    const timer = setTimeout(() => store.ensureFresh(), delay);
    return () => clearTimeout(timer);
  }, [active, store, snapshot]);

  // A scope read under another project selection is not this page's.
  if (
    snapshot.state.status === "ready" &&
    snapshot.selection !== store.currentSelection()
  ) {
    return LOADING;
  }
  return snapshot.state;
}
