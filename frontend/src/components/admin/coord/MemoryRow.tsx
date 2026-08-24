"use client";

/**
 * MemoryRow — one `coord.memories` row, on one line, with its detail behind a
 * click.
 *
 * Replaces `MemoryCard` on `/admin/coord/memory`. Plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 2;
 * conventions from `frontend/docs/console-ui-style-guide.md` and from
 * `PlanRow.tsx` / `AlertRow.tsx`.
 *
 * Two things changed and both are the point:
 *
 * 1. **R2 — the card was a `p-4` block of three stacked lines**; it is now one
 *    `px-3 py-2` row. The written-at / written-by cluster moved into the
 *    detail, which costs a click only when the operator wants it.
 * 2. **D1 — the whole card was a `<Link>` to `/admin/coord/memory/[name]`.**
 *    Clicking a row now expands it in place; the detail route survives and is
 *    reached by the explicit "Open full page ↗" action, which keeps the
 *    `coord-memory-card` testid the link always carried on its container.
 *
 * Every `data-testid` `MemoryCard` authored is carried across unchanged (D4a) —
 * `coord-memory-card`, `coord-memory-card-name`, `coord-memory-card-description`
 * — and `coord-memory-card-name` deliberately stays ON THE ROW rather than in
 * the detail, because `tests/e2e/pages/admin.spec.ts` reads it to prove the
 * name-prefix filter narrowed the list.
 */

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  StatusBadge,
  rowAccentClass,
} from "@/components/console";
import {
  MEMORY_STATUS_PALETTE,
  deriveMemoryStatus,
  memoryIdentity,
  type CoordMemoryRow,
} from "@/components/admin/coord/memoryStatus";

export type { CoordMemoryRow };

/**
 * The timestamp the row reports. `written_at` is the event-sourced write time
 * and is the semantically-right one; `updated_at` is the fallback for a
 * projection that omits it.
 */
function rowTimeFor(memory: CoordMemoryRow): { at: string | null; verb: string } {
  if (memory.written_at) return { at: memory.written_at, verb: "Written" };
  return { at: memory.updated_at ?? null, verb: "Updated" };
}

export function MemoryRow({
  memory,
  expanded,
  onToggle,
}: {
  memory: CoordMemoryRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = deriveMemoryStatus(memory);
  const { at, verb } = rowTimeFor(memory);
  const href = `/admin/coord/memory/${encodeURIComponent(memory.name)}`;

  return (
    <RecordRow
      data-testid="coord-memory-card"
      rowKey={memory.name}
      expanded={expanded}
      onToggle={onToggle}
      accent={rowAccentClass(status)}
      identity={
        <span title="version head — memories are event-sourced, so this is the latest version number, not a count">
          {memoryIdentity(memory)}
        </span>
      }
      label={
        <span
          className="font-mono"
          data-testid="coord-memory-card-name"
          title={memory.name}
        >
          {memory.name}
        </span>
      }
      status={<StatusBadge status={status} palette={MEMORY_STATUS_PALETTE} />}
      reason={memory.description ?? undefined}
      // The card's description testid, on the element that now carries the
      // description on the row (D4a). The FULL, untruncated text is in the
      // detail below — the row only ever showed a 160-char truncation.
      reasonTestId="coord-memory-card-description"
      time={<RowTime at={at} verb={verb} />}
    >
      <RecordDetail
        why={
          memory.description ? (
            <p
              className="text-sm text-foreground"
              data-testid="coord-memory-description-full"
            >
              {memory.description}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              coord holds no description for this memory.
            </p>
          )
        }
        problems={
          status.reason ? (
            <p className="text-xs text-amber-300/90">{status.reason}</p>
          ) : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={href} data-testid="coord-memory-card-link">
              <Button variant="outline" size="sm">
                Open full page
                <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </Link>
            {(memory.tags ?? []).map((t) => (
              <Badge key={t} variant="outline" className="text-xs">
                {t}
              </Badge>
            ))}
          </div>
        }
        history={
          <p className="text-xs text-muted-foreground flex flex-wrap gap-x-3">
            <span>
              written <RowTime at={at} verb={verb} className="inline" />
            </span>
            {memory.written_by_agent && (
              <span>by {memory.written_by_agent}</span>
            )}
          </p>
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
            memory name: {memory.name} · version head: {memoryIdentity(memory)}
            {memory.type ? ` · coord type: ${memory.type}` : ""}
          </div>
        }
      />
    </RecordRow>
  );
}
