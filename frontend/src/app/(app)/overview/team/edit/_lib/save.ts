/**
 * Save the estimate's content, then — when it is being built from a
 * document that is not yet its recorded source — record that document.
 *
 * One Save, two writes, in this order: the content is what the writer is
 * looking at, so it goes first; the source link then names the version that
 * content just produced, so a concurrent writer's save between the two is a
 * conflict rather than an overwrite. A failed link does not undo the saved
 * content: it comes back as `sourceError` beside it.
 */

import type {
  EstimateDetail,
  EstimateSummary,
} from "../../../_lib/estimate-api";

export async function saveThenRecordSource({
  save,
  patch,
  sourceId,
  errorText,
}: {
  save: () => Promise<EstimateDetail>;
  patch: (
    id: string,
    body: { source_page_id: string; expected_version: number }
  ) => Promise<EstimateSummary>;
  /** The document to record, or null when there is none to record. */
  sourceId: string | null;
  errorText: (err: unknown) => string;
}): Promise<{ fresh: EstimateDetail; sourceError?: string }> {
  const fresh = await save();
  if (sourceId === null || fresh.estimate.source_page_id === sourceId) {
    return { fresh };
  }
  try {
    const linked = await patch(fresh.estimate.id, {
      source_page_id: sourceId,
      expected_version: fresh.estimate.version,
    });
    return { fresh: { ...fresh, estimate: linked } };
  } catch (err) {
    return { fresh, sourceError: errorText(err) };
  }
}
