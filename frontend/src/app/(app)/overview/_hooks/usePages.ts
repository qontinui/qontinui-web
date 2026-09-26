"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ResourceError,
  getResource,
  listResource,
  updateResource,
  VersionConflictError,
  describeWriteFailure,
} from "@/components/overview/editing/api";
import type { SaveResult } from "@/components/overview/editing/useResource";
import { slugify } from "@/components/overview/wiki-links";
import { PAGE_LIST_LIMIT, type PageKind, type PageRecord } from "../_lib/pages";

export type PageState =
  | { state: "loading" }
  | { state: "error"; message: string }
  /** Read, and there is no such page in this project. */
  | { state: "missing" }
  | { state: "ready"; page: PageRecord };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One page with its body, found by id — or, for a wiki page, by slug — and
 * the writes that keep it current on screen. Nothing is read while `hold`.
 */
export function usePage(
  target: { id: string } | { kind: PageKind; slug: string },
  { hold, reloadKey }: { hold: boolean; reloadKey: unknown }
) {
  const [state, setState] = useState<PageState>({ state: "loading" });
  const key =
    "id" in target ? `id:${target.id}` : `${target.kind}:${target.slug}`;

  useEffect(() => {
    if (hold) return;
    let live = true;
    setState({ state: "loading" });
    (async (): Promise<PageState> => {
      let id: string;
      if ("id" in target) {
        id = target.id;
      } else {
        // The list filters by slug exactly; bodies come only from a get.
        // The server folds the filter to a slug; compare the same way, so a
        // hand-typed `Getting Started` still finds `getting-started`.
        const wanted = slugify(target.slug);
        if (!wanted) return { state: "missing" };
        const found = await listResource<PageRecord>("pages", {
          kind: target.kind,
          slug: wanted,
        });
        const match = found.items.find((p) => p.slug === wanted);
        if (!match) return { state: "missing" };
        id = match.id;
      }
      try {
        const { item } = await getResource<PageRecord>("pages", id);
        return { state: "ready", page: item };
      } catch (err) {
        if (err instanceof ResourceError && err.status === 404) {
          return { state: "missing" };
        }
        throw err;
      }
    })().then(
      (next) => live && setState(next),
      (err: unknown) =>
        live && setState({ state: "error", message: errorText(err) })
    );
    return () => {
      live = false;
    };
    // `key` stands for `target`, which is usually a fresh literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hold, reloadKey]);

  /** Show this copy of the page (a save's, a restore's, or theirs). */
  const replace = useCallback((page: PageRecord) => {
    setState({ state: "ready", page });
  }, []);

  /** Write fields of the page. A conflict shows THEIR copy and hands it back. */
  const save = useCallback(
    async (
      page: PageRecord,
      patch: Record<string, unknown>,
      version = page.version
    ): Promise<SaveResult<PageRecord>> => {
      try {
        const saved = await updateResource<PageRecord>(
          "pages",
          page.id,
          patch,
          version
        );
        replace(saved);
        return { ok: true, item: saved };
      } catch (err) {
        if (err instanceof VersionConflictError) {
          const theirs = err.current as PageRecord;
          replace(theirs);
          return { ok: false, conflict: theirs };
        }
        return { ok: false, error: describeWriteFailure(err) };
      }
    },
    [replace]
  );

  return { state, replace, save };
}

/**
 * The slugs of the project's wiki pages, for rendering `[[links]]`. `null`
 * while unknown (loading, or the read failed): links are then drawn as if
 * their pages exist, since saying "nobody wrote this" would be a guess.
 */
export function useWikiSlugs({
  hold,
  reloadKey,
}: {
  hold: boolean;
  reloadKey: unknown;
}): ReadonlySet<string> | null {
  const [slugs, setSlugs] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (hold) return;
    let live = true;
    setSlugs(null);
    listResource<PageRecord>("pages", { kind: "wiki" }).then(
      (list) =>
        live &&
        // A full page may be cut short, and a page past the cut would be
        // drawn as unwritten: treat the set as unknown instead.
        setSlugs(
          list.items.length >= PAGE_LIST_LIMIT
            ? null
            : new Set(list.items.map((p) => p.slug))
        ),
      () => live && setSlugs(null)
    );
    return () => {
      live = false;
    };
  }, [hold, reloadKey]);
  return slugs;
}
