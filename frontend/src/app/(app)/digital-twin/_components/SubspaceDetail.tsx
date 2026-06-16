"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Code2, Loader2, Sparkles } from "lucide-react";
import { useSubspaceRaw } from "../_hooks/useSubspaceRaw";
import { summarizeVerdict } from "../_lib/verdict-formatter";
import { STATUS_STYLES } from "../_lib/status-presentation";
import type { ResolvedSubspace } from "../_lib/types";

interface SubspaceDetailProps {
  row: ResolvedSubspace | null;
  onOpenChange: (open: boolean) => void;
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

/**
 * Detail drawer for one sub-space. For live snapshot observers it fetches the
 * raw DriftVerdict (the exact JSON an AI agent receives) and renders both a
 * human-digestible summary and the raw JSON on demand. For all rows it shows the
 * backing coord tool / observer module + research doc.
 */
export function SubspaceDetail({ row, onOpenChange }: SubspaceDetailProps) {
  const isSnapshot = row?.query_kind === "snapshot";
  const { data, isLoading, isError, error } = useSubspaceRaw(
    row?.id ?? null,
    !!row && isSnapshot,
  );
  const [showRaw, setShowRaw] = useState(false);

  // Collapse the raw view whenever a different sub-space is opened.
  useEffect(() => {
    setShowRaw(false);
  }, [row?.id]);

  if (!row) return null;
  const style = STATUS_STYLES[row.cellStatus];
  const verdict = data?.verdict;
  const summary = verdict ? summarizeVerdict(row.id, verdict) : null;

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${style.dot}`} />
            <span className="capitalize">{row.id.replace(/_/g, " ")}</span>
            <span className="font-mono text-sm text-muted-foreground">
              {row.symbol}
            </span>
          </DialogTitle>
          <DialogDescription>{row.description}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto pr-1 text-sm">
          {/* Human-digestible summary (snapshot observers only). */}
          {isSnapshot && (
            <div className="mb-3 rounded-md border border-border bg-muted/40 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Sparkles className="size-3.5" /> Summary
              </div>
              {isLoading && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Reading the
                  observer…
                </p>
              )}
              {isError && (
                <p className="text-sm text-muted-foreground">
                  Could not read the live verdict
                  {error instanceof Error ? `: ${error.message}` : ""}.
                </p>
              )}
              {summary && <p className="text-sm">{summary.prose}</p>}
            </div>
          )}

          <Field label="Status" value={style.label} />
          <p className="pb-2 text-xs text-muted-foreground">{style.meaning}</p>
          <Field label="Tier" value={`Tier ${row.tier}`} />
          <Field label="Layer" value={row.layer} />
          <Field label="Research status" value={row.research_status} />
          <Field label="Query kind" value={row.query_kind} />

          {summary && (
            <>
              <Separator className="my-2" />
              <p className="pb-1 text-xs font-semibold text-muted-foreground">
                Live credibility envelope
              </p>
              {summary.facts.map((f) => (
                <Field key={f.label} label={f.label} value={f.value} />
              ))}
            </>
          )}

          {row.error && (
            <>
              <Separator className="my-2" />
              <Field label="Error" value={row.error} />
            </>
          )}

          <Separator className="my-2" />
          <Field
            label="coord tool"
            value={
              row.coord_query_tool ? (
                <code className="text-xs">{row.coord_query_tool}</code>
              ) : (
                "—"
              )
            }
          />
          <Field
            label="Observer"
            value={
              row.observer_module ? (
                <code className="text-xs">{row.observer_module}</code>
              ) : (
                "—"
              )
            }
          />
          <Field
            label="Research"
            value={<code className="text-xs">{row.research_doc}</code>}
          />

          {/* Raw data view — the exact JSON an AI agent receives. */}
          {isSnapshot && verdict && (
            <>
              <Separator className="my-2" />
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">
                  Raw verdict
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => setShowRaw((v) => !v)}
                >
                  <Code2 className="size-3.5" />
                  {showRaw ? "Hide raw data" : "Show raw data"}
                </Button>
              </div>
              <p className="pb-2 text-[11px] text-muted-foreground">
                The exact JSON an AI agent receives from{" "}
                <code>{data?.tool ?? row.coord_query_tool}</code>.
              </p>
              {showRaw && (
                <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/50 p-3 text-[11px] leading-relaxed">
                  {JSON.stringify(verdict, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
