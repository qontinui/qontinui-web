"use client";

/**
 * Where the text a spawned session receives actually comes from — the ONE
 * provenance surface for this corpus. Extended, not duplicated: this is the
 * badge the `/settings/agent-commands` editor carried, widened from the
 * two-value "customized vs default" it could express when the backend stored
 * only an account layer.
 *
 * It now renders the runner's real three-layer chain,
 * `account override → fleet default → embedded default`, plus the one state
 * that defeats it (`account-pinned`).
 *
 * Rule references — `frontend/docs/console-ui-style-guide.md`:
 * **R3/§4.2** (colour encodes who must act; the class comes from
 * `STATUS_BADGE_CLASS`, which is keyed off `ATTENTION_BY_KIND` and asserted
 * against it by `unitRows.test.ts`) and the colourblind glyph rule
 * (red ⇔ `✕`).
 */

import {
  AUTHOR_GLYPH_KINDS,
  STATUS_BADGE_CLASS,
  type UnitStatus,
} from "../_lib/unitRows";

export function ProvenanceBadge({
  status,
  className = "",
}: {
  status: UnitStatus;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${STATUS_BADGE_CLASS[status.kind]} ${className}`}
      title={status.reason}
      data-status-kind={status.kind}
      data-testid={`unit-provenance-${status.kind}`}
    >
      {AUTHOR_GLYPH_KINDS.has(status.kind) && (
        <span aria-hidden className="select-none">
          ✕
        </span>
      )}
      {status.label}
    </span>
  );
}

/**
 * Where the text was IMPORTED from — a different question from which layer
 * served it, which is why it is a second badge beside `ProvenanceBadge` rather
 * than another value inside it. A unit can be a fleet default that was imported
 * and a fleet default that was typed here, and only this says which.
 *
 * Renders nothing when there is no `source_path`, and that absence is
 * meaningful: the text was authored in the console — either from scratch, or by
 * editing an imported unit, which clears provenance rather than let it go
 * stale.
 *
 * `sourceCommit` can be null on its own (an import from a dirty source tree,
 * where no commit honestly describes the bytes). It is shown abbreviated
 * because a 40-char SHA in a badge is unreadable, with the full value in the
 * native title.
 */
export function ImportedFromBadge({
  sourcePath,
  sourceCommit,
}: {
  sourcePath: string | null;
  sourceCommit: string | null;
}) {
  if (!sourcePath) return null;
  const shortCommit = sourceCommit ? sourceCommit.slice(0, 12) : null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
      title={
        sourceCommit
          ? `Imported from ${sourcePath} at commit ${sourceCommit}. Saving here replaces the text and clears this.`
          : `Imported from ${sourcePath}. No commit was recorded — the source tree had uncommitted changes, so no commit describes these bytes.`
      }
      data-testid="unit-imported-from"
    >
      {sourcePath}
      {shortCommit ? ` @ ${shortCommit}` : " @ uncommitted"}
    </span>
  );
}

/**
 * The orthogonal marker for a copy-source spec (`_gate-registration`,
 * `_loop-control`): carried by the corpus and provisioned to the same
 * directory so a unit citing it by path still resolves it, but never offered
 * to the harness as an invocable unit. It cuts across every layer, so it is a
 * second badge rather than another value of the one above.
 */
export function CopySourceBadge() {
  return (
    <span
      className="inline-flex items-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
      title="Copy-source spec: the leading underscore marks text other units paste from. It is carried and provisioned, but the harness never offers it as a slash command."
      data-testid="unit-copy-source-badge"
    >
      copy-source
    </span>
  );
}
