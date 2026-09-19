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
} from "@/app/(app)/admin/coord/prompt-documents/types";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import { SHEPHERD_SLUG_PREFIX } from "@/app/(app)/admin/coord/plans/plansHealth";
import {
  SUMMARY_INTENT_KINDS,
  toIntentEntry,
  type IntentEntry,
  type SummaryIntentKind,
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
  const list = await httpClient.get<ListPromptDocumentsResponse>(
    `${API}/coord/prompt-documents`
  );
  const wanted = (list.documents ?? []).filter((d) =>
    (SUMMARY_INTENT_KINDS as readonly string[]).includes(d.kind)
  );
  const docs = await Promise.all(
    wanted.map((d) =>
      httpClient.get<PromptDocument & { unedited_seed?: boolean | null }>(
        `${API}/coord/prompt-documents/${encodeURIComponent(
          d.kind
        )}/${encodeURIComponent(d.name)}`
      )
    )
  );
  const order = (k: string) =>
    SUMMARY_INTENT_KINDS.indexOf(k as SummaryIntentKind);
  return {
    entries: docs
      .map(toIntentEntry)
      .sort((a, b) => order(a.kind) - order(b.kind)),
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

export function useSummaryData() {
  const [intent, setIntent] = useState<Loadable<IntentData>>({
    state: "loading",
  });
  const [progress, setProgress] = useState<Loadable<{ progress: Progress }>>({
    state: "loading",
  });

  useEffect(() => {
    let live = true;
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
  }, []);

  return { intent, progress };
}
