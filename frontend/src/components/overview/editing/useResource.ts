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
  VersionConflictError,
  createResource,
  describeWriteFailure,
  listResource,
  updateResource,
  type VersionedRecord,
} from "./api";

export type ListState<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; items: T[]; degraded: string | null };

export type SaveResult<T> =
  | { ok: true; item: T }
  | { ok: false; conflict: T }
  | { ok: false; error: string };

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
    async (body: Record<string, unknown>): Promise<SaveResult<T>> => {
      try {
        // One key per attempt the reader made; the client's own retries of
        // that attempt reuse it, so a lost response cannot create twice.
        const created = await createResource<T>(path, body, newKey());
        setList((prev) =>
          prev.state === "ready"
            ? { ...prev, items: [...prev.items, created] }
            : prev
        );
        return { ok: true, item: created };
      } catch (err) {
        return { ok: false, error: describeWriteFailure(err) };
      }
    },
    [path]
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { list, update, create, reload };
}
