"use client";

/**
 * Everything the Summary page reads, from two existing tenant-scoped doors:
 *
 * - the project's intent documents, through the coord prompt-document proxy
 *   (`/api/v1/operations/coord/prompt-documents`, readable by any member);
 * - its work units, through `/api/v1/operations/plans`.
 *
 * Each source reports `loading`, `error` or data on its own, so one failing
 * never blanks the other, and neither failure is shown as an empty project.
 */

import { useEffect, useState } from "react";
import { httpClient } from "@/services/service-factory";
import type {
  ListPromptDocumentsResponse,
  PromptDocument,
  PromptDocumentSummary,
} from "@/app/(app)/admin/coord/prompt-documents/types";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import { SHEPHERD_SLUG_PREFIX } from "@/app/(app)/admin/coord/work-units/plansHealth";
import {
  SUMMARY_INTENT_KINDS,
  classifyIntent,
  sortIntentEntries,
  skeletonEntry,
  toIntentEntry,
  unreadableEntry,
  type IntentEntry,
  type SummaryIntentKind,
  type WithSeedVerdict,
} from "../_lib/intent";
import { summarizeProgress, type Progress } from "../_lib/progress";

const API = "/api/v1/operations";

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

async function loadIntent(): Promise<IntentData> {
  const list = await httpClient.get<
    Omit<ListPromptDocumentsResponse, "documents"> & {
      documents: WithSeedVerdict<PromptDocumentSummary>[];
    }
  >(`${API}/coord/prompt-documents`);
  const wanted = (list.documents ?? []).filter((d) =>
    (SUMMARY_INTENT_KINDS as readonly string[]).includes(d.kind)
  );
  // A document the list already shows is an untouched skeleton is never
  // fetched: its body is template text the page would not show anyway. Each
  // remaining body is fetched independently, so one failure marks only its
  // own section as unreadable.
  const entries = await Promise.all(
    wanted.map(async (d): Promise<IntentEntry> => {
      if (classifyIntent(d) === "skeleton") return skeletonEntry(d);
      try {
        const doc = await httpClient.get<WithSeedVerdict<PromptDocument>>(
          `${API}/coord/prompt-documents/${encodeURIComponent(
            d.kind
          )}/${encodeURIComponent(d.name)}`
        );
        return toIntentEntry(doc);
      } catch (err) {
        return unreadableEntry(d, errorMessage(err));
      }
    })
  );
  // Kind order is the page's section order; within a kind, reading order.
  const order = (k: string) =>
    SUMMARY_INTENT_KINDS.indexOf(k as SummaryIntentKind);
  return {
    entries: sortIntentEntries(entries).sort(
      (a, b) => order(a.kind) - order(b.kind)
    ),
    degraded: list.degraded ?? null,
  };
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

/**
 * `tenantId` is the active project. Nothing is read while `hold` is true:
 * the caller holds until the project list has resolved (the
 * `X-Qontinui-Active-Tenant` header comes from the same selection, so an
 * earlier read could name a stale project) and while it has failed (the
 * server would answer for a project the page cannot name). Reads re-run when
 * the project changes.
 */
export function useSummaryData(tenantId: string | null, hold: boolean) {
  const [intent, setIntent] = useState<Loadable<IntentData>>({
    state: "loading",
  });
  const [progress, setProgress] = useState<Loadable<{ progress: Progress }>>({
    state: "loading",
  });

  useEffect(() => {
    if (hold) return;
    let live = true;
    setIntent({ state: "loading" });
    setProgress({ state: "loading" });
    loadIntent().then(
      (data) => live && setIntent({ state: "ready", ...data }),
      (err) => live && setIntent({ state: "error", message: errorMessage(err) })
    );
    loadProgress().then(
      (data) => live && setProgress({ state: "ready", progress: data }),
      (err) =>
        live && setProgress({ state: "error", message: errorMessage(err) })
    );
    return () => {
      live = false;
    };
  }, [tenantId, hold]);

  return { intent, progress };
}
