"use client";

import {
  RecordDetail,
  RecordList,
  RecordRow,
  RowTime,
} from "@/components/console";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TastePair } from "@/lib/api/taste";
import {
  LABEL_CHIP,
  LABEL_TEXT,
  REASON_LABEL,
  pairContext,
} from "../_lib/tasteInbox";

/**
 * The most recent labels, newest first — the undo list (no-surprise
 * reversibility: every answer can be taken back, and the pair returns to the
 * queue). One record per line (R2), detail in place (R5), raw ids last.
 */
export function RecentLabels({
  recent,
  loaded,
  canLabel,
  busy,
  onUndo,
}: {
  recent: TastePair[];
  loaded: boolean;
  canLabel: boolean;
  busy: boolean;
  onUndo: (pairId: string) => void;
}) {
  return (
    <RecordList<TastePair>
      items={recent}
      itemKey={(p) => p.id}
      loaded={loaded}
      empty={
        <p
          className="text-xs text-muted-foreground"
          data-testid="taste-recent-empty"
        >
          No labels yet.
        </p>
      }
      renderRow={(pair, { expanded, onToggle }) => {
        const label = pair.label;
        return (
          <RecordRow
            identity={label ? LABEL_CHIP[label] : "—"}
            label={pairContext(pair)}
            status={
              pair.reasons.length > 0 ? (
                <Badge variant="outline" className="text-[11px]">
                  {pair.reasons.map((r) => REASON_LABEL[r]).join(", ")}
                </Badge>
              ) : undefined
            }
            reason={pair.comment ?? undefined}
            time={<RowTime at={pair.labelled_at} verb="Labelled" />}
            expanded={expanded}
            onToggle={onToggle}
            data-testid={`taste-recent-${pair.id}`}
          >
            <RecordDetail
              why={
                <div className="space-y-1 text-sm">
                  <p>
                    {label ? LABEL_TEXT[label] : "Unlabelled"}
                    {pair.labeller_name ? ` — by ${pair.labeller_name}` : ""}
                  </p>
                  {pair.comment && <p>Comment: {pair.comment}</p>}
                  {pair.edit_note && <p>Would change: {pair.edit_note}</p>}
                </div>
              }
              actions={
                canLabel ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onUndo(pair.id)}
                    data-testid={`taste-undo-${pair.id}`}
                  >
                    Undo this label
                  </Button>
                ) : undefined
              }
              raw={
                <p className="font-mono text-[11px] text-muted-foreground break-all">
                  pair {pair.id} · A {pair.asset_a.sha256.slice(0, 12)} · B{" "}
                  {pair.asset_b.sha256.slice(0, 12)}
                </p>
              }
            />
          </RecordRow>
        );
      }}
    />
  );
}
