/**
 * Save a measure's prose from its Objectives card (plan
 * `2026-10-06-overview-objectives-view` D2) — through the SAME door the
 * Summary's editor writes: the `intent_documents` resource update
 * (`IntentDocumentStore.update`), with its version check, its change log, and
 * the frontmatter re-attached server-side from a fresh read. No new write
 * path: only the body is sent, never the frontmatter.
 */

import {
  VersionConflictError,
  describeWriteFailure,
  updateResource,
} from "@/components/overview/editing/api";
import type { SaveResult } from "@/components/overview/editing/useResource";
import type { IntentDocument } from "./intent";

/** The `intent-documents` route segment the Summary's list reads too. */
const INTENT_PATH = "intent-documents";

export function metricDocumentId(name: string): string {
  return `success_metric:${name}`;
}

export async function saveMetricText(
  name: string,
  text: string,
  version: number
): Promise<SaveResult<IntentDocument>> {
  try {
    const saved = await updateResource<IntentDocument>(
      INTENT_PATH,
      metricDocumentId(name),
      { body: text },
      version,
      "ui"
    );
    return { ok: true, item: saved };
  } catch (err) {
    if (err instanceof VersionConflictError) {
      return { ok: false, conflict: err.current as IntentDocument };
    }
    return { ok: false, error: describeWriteFailure(err) };
  }
}
