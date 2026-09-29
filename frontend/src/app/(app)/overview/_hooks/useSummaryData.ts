"use client";

/**
 * Everything the Summary page reads and writes:
 *
 * - the project's intent documents, through the overview's `intent-documents`
 *   resource (plan `2026-09-20-overview-authoring-layer`) — readable by any
 *   member, writable by whoever the server says may, with version checks and
 *   a change log on every save;
 * - its work units, through `/api/v1/operations/plans`.
 *
 * Each source reports `loading`, `error` or data on its own, so one failing
 * never blanks the other, and neither failure is shown as an empty project.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { httpClient } from "@/services/service-factory";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import { SHEPHERD_SLUG_PREFIX } from "@/app/(app)/admin/coord/work-units/plansHealth";
import {
  useResourceList,
  type SaveResult,
} from "@/components/overview/editing/useResource";
import {
  SUMMARY_INTENT_KINDS,
  positionsAfterMove,
  sortIntentEntries,
  toIntentEntry,
  type IntentDocument,
  type IntentEntry,
  type SummaryIntentKind,
} from "../_lib/intent";
import { summarizeProgress, type Progress } from "../_lib/progress";

const API = "/api/v1/operations";
export const INTENT_RESOURCE = "intent_documents";
const INTENT_PATH = "intent-documents";

/** Same window the Coord Console's plan list reads. */
export const PLAN_FETCH_LIMIT = 500;

export type Loadable<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | ({ state: "ready" } & T);

export interface IntentData {
  entries: IntentEntry[];
  /**
   * Coord answered but cannot see its document store yet. An empty list
   * then means "cannot see", not "nothing written".
   */
  degraded: string | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function loadProgress(): Promise<Progress> {
  const qs = new URLSearchParams({
    limit: String(PLAN_FETCH_LIMIT),
    exclude_slug_prefix: SHEPHERD_SLUG_PREFIX,
  });
  const body = await httpClient.get<{
    work_units?: CoordPlanRow[];
    plans?: CoordPlanRow[];
  }>(`${API}/plans?${qs.toString()}`);
  const rows = body.work_units ?? body.plans ?? [];
  return summarizeProgress(rows, { fetchLimit: PLAN_FETCH_LIMIT });
}

/** Kind order is the page's section order; within a kind, reading order.
 *  Two passes, and the second must not disturb the first: Array#sort has
 *  been stable since ES2019, which keeps the reading order intact while the
 *  kinds are grouped. */
function arrange(docs: IntentDocument[]): IntentEntry[] {
  const order = (k: string) =>
    SUMMARY_INTENT_KINDS.indexOf(k as SummaryIntentKind);
  return sortIntentEntries(docs.map(toIntentEntry)).sort(
    (a, b) => order(a.kind) - order(b.kind)
  );
}

const INTENT_PARAMS = { kind: SUMMARY_INTENT_KINDS };

/**
 * `tenantId` is the active project. Nothing is read while `hold` is true:
 * the caller holds until the project list has resolved (the
 * `X-Qontinui-Active-Tenant` header comes from the same selection, so an
 * earlier read could name a stale project) and while it has failed (the
 * server would answer for a project the page cannot name). Reads re-run when
 * the project changes.
 */
export function useSummaryData(tenantId: string | null, hold: boolean) {
  const documents = useResourceList<IntentDocument>(INTENT_PATH, {
    params: INTENT_PARAMS,
    hold,
    reloadKey: tenantId,
  });
  const [progress, setProgress] = useState<Loadable<{ progress: Progress }>>({
    state: "loading",
  });

  useEffect(() => {
    if (hold) return;
    let live = true;
    setProgress({ state: "loading" });
    loadProgress().then(
      (data) => live && setProgress({ state: "ready", progress: data }),
      (err) =>
        live && setProgress({ state: "error", message: errorMessage(err) })
    );
    return () => {
      live = false;
    };
  }, [tenantId, hold]);

  const intent: Loadable<IntentData> = useMemo(() => {
    const list = documents.list;
    if (list.state !== "ready") return list;
    return {
      state: "ready",
      entries: arrange(list.items),
      degraded: list.degraded,
    };
  }, [documents.list]);

  const { update, create } = documents;
  const findDoc = useCallback(
    (id: string): IntentDocument | null =>
      documents.list.state === "ready"
        ? (documents.list.items.find((d) => d.id === id) ?? null)
        : null,
    [documents.list]
  );

  /** Save a document's prose. The editor edits the prose as stored, opening
   *  heading included; the frontmatter never leaves the server. */
  const saveBody = useCallback(
    async (
      id: string,
      text: string,
      version: number
    ): Promise<SaveResult<IntentDocument>> => {
      const current = findDoc(id);
      if (!current)
        return { ok: false, error: "This document is no longer here." };
      return update(
        { ...current, version },
        { body: text },
        {
          optimistic: (doc) => ({
            ...doc,
            body: text,
            state: doc.state === "skeleton" ? "authored" : doc.state,
          }),
        }
      );
    },
    [findDoc, update]
  );

  /** Move a document within its section: one position write per document
   *  whose position changes. Stops at the first failure and says so; the
   *  writes already made stand, and the list shows the server's copy. */
  const move = useCallback(
    async (
      section: readonly IntentEntry[],
      from: number,
      to: number
    ): Promise<string | null> => {
      for (const { entry, order } of positionsAfterMove(section, from, to)) {
        const current = findDoc(entry.id);
        if (!current) continue;
        const result = await update(
          current,
          { overview_order: order },
          { optimistic: (doc) => ({ ...doc, overview_order: order }) }
        );
        if (!result.ok) {
          return "conflict" in result
            ? "Somebody else changed this section just now. Try again."
            : result.error;
        }
      }
      return null;
    },
    [findDoc, update]
  );

  const createDocument = useCallback(
    (kind: SummaryIntentKind, name: string, body: string) =>
      create({ kind, name, body }),
    [create]
  );

  return { intent, progress, saveBody, move, createDocument };
}
