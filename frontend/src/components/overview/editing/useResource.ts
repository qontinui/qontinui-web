"use client";

/**
 * Read a resource's records and write them back through the contract.
 *
 * - **Optimistic apply.** A save shows its result immediately; the server's
 *   answer then replaces it.
 * - **Rollback.** A failed save puts the record back as it was and reports a
 *   sentence the reader can act on.
 * - **Conflict.** A save built on a version somebody else has moved past puts
 *   THEIR copy in the list and hands it back, so the caller can show both
 *   sides (`ConflictDialog`) instead of silently overwriting either.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ResourceError,
  VersionConflictError,
  createResource,
  describeWriteFailure,
  getResource,
  listResource,
  updateResource,
  type VersionedRecord,
  type WriteSource,
} from "./api";

export type ListState<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; items: T[]; degraded: string | null };

export type SaveResult<T> =
  | { ok: true; item: T }
  | { ok: false; conflict: T }
  /** `code` is the server's machine reason when it gave one (e.g.
   *  `source_page_not_found`), so a caller can offer the fix it implies. */
  | { ok: false; error: string; code?: string | null };

export interface UpdateOptions<T> {
  /** What the record will look like once saved, shown until the server
   *  answers. Omit to show nothing until then. */
  optimistic?: (item: T) => T;
}

function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * `path` is the resource's route segment (`intent-documents`). Nothing is
 * read while `hold` is true (the active project is not yet known); `reloadKey`
 * re-reads when it changes — pass the active project id.
 */
export function useResourceList<T extends VersionedRecord>(
  path: string,
  {
    params,
    hold,
    reloadKey,
  }: {
    params?: Record<string, string | readonly string[]>;
    hold: boolean;
    reloadKey: unknown;
  }
) {
  const [list, setList] = useState<ListState<T>>({ state: "loading" });
  const [nonce, setNonce] = useState(0);
  // The list as last rendered, for rolling a failed save back to what was
  // actually on screen — not to the caller's copy, which may carry a draft's
  // older version.
  const listRef = useRef(list);
  useEffect(() => {
    listRef.current = list;
  }, [list]);
  // The params object is usually a literal; compare by value, not identity.
  const paramsKey = JSON.stringify(params ?? {});

  useEffect(() => {
    if (hold) return;
    let live = true;
    setList({ state: "loading" });
    listResource<T>(
      path,
      JSON.parse(paramsKey) as Record<string, string | readonly string[]>
    ).then(
      (body) =>
        live &&
        setList({ state: "ready", items: body.items, degraded: body.degraded }),
      (err: unknown) =>
        live &&
        setList({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        })
    );
    return () => {
      live = false;
    };
  }, [path, paramsKey, hold, reloadKey, nonce]);

  const replace = useCallback((item: T) => {
    setList((prev) =>
      prev.state === "ready"
        ? {
            ...prev,
            items: prev.items.map((i) => (i.id === item.id ? item : i)),
          }
        : prev
    );
  }, []);

  const update = useCallback(
    async (
      current: T,
      patch: Record<string, unknown>,
      options: UpdateOptions<T> = {}
    ): Promise<SaveResult<T>> => {
      const shown = listRef.current;
      const previous =
        (shown.state === "ready"
          ? shown.items.find((i) => i.id === current.id)
          : undefined) ?? current;
      if (options.optimistic) replace(options.optimistic(previous));
      try {
        const saved = await updateResource<T>(
          path,
          current.id,
          patch,
          current.version
        );
        replace(saved);
        return { ok: true, item: saved };
      } catch (err) {
        if (err instanceof VersionConflictError) {
          const theirs = err.current as T;
          replace(theirs);
          return { ok: false, conflict: theirs };
        }
        replace(previous);
        return { ok: false, error: describeWriteFailure(err) };
      }
    },
    [path, replace]
  );

  const create = useCallback(
    async (
      body: Record<string, unknown>,
      { source = "ui" }: { source?: WriteSource } = {}
    ): Promise<SaveResult<T>> => {
      try {
        // One key per attempt the reader made; the client's own retries of
        // that attempt reuse it, so a lost response cannot create twice.
        const created = await createResource<T>(path, body, newKey(), source);
        setList((prev) =>
          prev.state === "ready"
            ? { ...prev, items: [...prev.items, created] }
            : prev
        );
        return { ok: true, item: created };
      } catch (err) {
        return {
          ok: false,
          error: describeWriteFailure(err),
          code: err instanceof ResourceError ? err.code : null,
        };
      }
    },
    [path]
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { list, update, create, reload };
}

export type RecordState<T> =
  | { state: "loading" }
  /** `status` is the HTTP status when the server answered (404: no such
   *  record here), null when it could not be asked. */
  | { state: "error"; message: string; status: number | null }
  | { state: "ready"; item: T; canEdit: boolean };

/**
 * One record of a resource, read with its served `version` and written back
 * through the contract — the single-record twin of {@link useResourceList}.
 *
 * `update` names the version the write was BUILT on (a working copy's base,
 * which may be older than the record on screen), so a peer's save in between
 * is a conflict, never an overwrite. On a conflict the hook holds THEIR copy
 * — it is now the server's truth — and hands it back for the caller to show
 * beside the writer's; the writer's working copy is the caller's and is
 * never touched here.
 */
export function useResourceRecord<T extends VersionedRecord>(
  path: string,
  id: string | null,
  { hold, reloadKey }: { hold: boolean; reloadKey: unknown }
) {
  const [record, setRecord] = useState<RecordState<T>>({ state: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (hold || id === null) return;
    let live = true;
    setRecord({ state: "loading" });
    getResource<T>(path, id).then(
      (body) =>
        live &&
        setRecord({ state: "ready", item: body.item, canEdit: body.can_edit }),
      (err: unknown) =>
        live &&
        setRecord({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
          status: err instanceof ResourceError ? err.status : null,
        })
    );
    return () => {
      live = false;
    };
  }, [path, id, hold, reloadKey, nonce]);

  const replace = useCallback((item: T) => {
    setRecord((prev) => (prev.state === "ready" ? { ...prev, item } : prev));
  }, []);

  const update = useCallback(
    async (
      patch: Record<string, unknown>,
      baseVersion: number,
      { source = "ui" }: { source?: WriteSource } = {}
    ): Promise<SaveResult<T>> => {
      if (id === null) return { ok: false, error: "Nothing is loaded." };
      try {
        const saved = await updateResource<T>(
          path,
          id,
          patch,
          baseVersion,
          source
        );
        replace(saved);
        return { ok: true, item: saved };
      } catch (err) {
        if (err instanceof VersionConflictError) {
          const theirs = err.current as T;
          replace(theirs);
          return { ok: false, conflict: theirs };
        }
        return {
          ok: false,
          error: describeWriteFailure(err),
          code: err instanceof ResourceError ? err.code : null,
        };
      }
    },
    [path, id, replace]
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { record, update, replace, reload };
}
