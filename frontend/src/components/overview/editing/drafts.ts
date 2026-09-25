/**
 * Unsaved text, kept on this device until it is saved or discarded.
 *
 * Keyed per PROJECT, resource, record and VIEWER. The project matters because
 * record ids repeat across projects — coord seeds every project with the same
 * document names — so without it a draft begun in one project would be
 * offered, and could be saved, in another. The viewer matters so two people
 * sharing a browser never see each other's drafts. A draft remembers the version it was
 * started from: restoring one and saving it is refused as a conflict if the
 * document has moved since, rather than quietly overwriting the newer text.
 *
 * Storage can be unavailable (private windows, blocked site data), so every
 * access is guarded and a missing draft is simply no draft.
 */

export interface Draft {
  text: string;
  baseVersion: number;
  savedAt: string;
}

const PREFIX = "qontinui.overview.draft";

export function draftKey(
  projectId: string | null,
  resource: string,
  recordId: string,
  viewerId: string | null
): string {
  return `${PREFIX}:${projectId ?? "no-project"}:${resource}:${recordId}:${viewerId ?? "anonymous"}`;
}

export function readDraft(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (
      typeof parsed.text !== "string" ||
      typeof parsed.baseVersion !== "number"
    )
      return null;
    return {
      text: parsed.text,
      baseVersion: parsed.baseVersion,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
  } catch {
    return null;
  }
}

export function writeDraft(
  key: string,
  text: string,
  baseVersion: number
): void {
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ text, baseVersion, savedAt: new Date().toISOString() })
    );
  } catch {
    // No storage: the draft lives only as long as the page does.
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
