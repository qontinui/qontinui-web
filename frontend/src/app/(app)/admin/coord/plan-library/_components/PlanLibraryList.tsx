"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  FileText,
  Lock,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PAGE_SIZE, usePlanLibrary } from "../_hooks/usePlanLibrary";
import { ArtifactDetailDialog } from "./ArtifactDetailDialog";
import {
  KIND_LABELS,
  WORK_ARTIFACT_KINDS,
  kindLabel,
  type WorkArtifactKind,
  type WorkArtifactSummary,
} from "../types";

/** The `kind` Select uses a sentinel because Radix reserves the empty value. */
const ANY_KIND = "__any__";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function ArtifactRow({
  item,
  onOpen,
}: {
  item: WorkArtifactSummary;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
      data-testid={`artifact-row-${item.id}`}
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">
            {item.title || item.slug}
          </span>
          <Badge variant="outline" className="shrink-0">
            {kindLabel(item.kind)}
          </Badge>
          {item.kind_locked && (
            <Lock
              className="size-3 shrink-0 text-muted-foreground"
              aria-label="kind locked"
            />
          )}
          {item.status && (
            <Badge variant="outline" className="shrink-0">
              {item.status}
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {item.slug} · {item.source_repo ?? "no source repo"} · v
          {item.current_version} · {item.captured_by} ·{" "}
          {formatWhen(item.updated_at)}
        </p>
      </div>
    </button>
  );
}

/**
 * The corpus list, with the kind / status / repo facets and full-text search.
 *
 * `kind` is a dropdown because a Postgres CHECK backs the vocabulary. `status`
 * and `repo` are free-text: status mirrors whatever an operator typed into a
 * plan's front-matter and is deliberately opaque end-to-end (an unknown value
 * returns an empty page, never a 422). The values present on the loaded page
 * are offered as chips, clearly labelled as coming from this page — a
 * dropdown built from them would cap the operator at what page 1 happens to
 * hold, without saying so.
 */
export interface OpenArtifactRequest {
  id: string;
  /** Bumped on every request so re-opening the SAME artifact still fires. */
  nonce: number;
}

/**
 * The detail dialog lives here (it needs this hook's `fetchDetail` /
 * `correctKind`, and a kind correction must refresh THIS list). The divergence
 * panel is a sibling, so it asks for an artifact through `openRequest` rather
 * than owning a second copy of the dialog — two dialogs over the same row
 * would drift the moment one of them wrote.
 */
export function PlanLibraryList({
  openRequest,
}: {
  openRequest?: OpenArtifactRequest | null;
}) {
  const {
    filters,
    updateFilter,
    resetFilters,
    seen,
    items,
    total,
    offset,
    setOffset,
    loading,
    error,
    reload,
    fetchDetail,
    correctKind,
  } = usePlanLibrary();

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const openArtifact = (id: string) => {
    setDetailId(id);
    setDetailOpen(true);
  };

  // A sibling panel asked for an artifact. Keyed on `nonce` so asking twice
  // for the same id re-opens the dialog instead of doing nothing.
  const requestedId = openRequest?.id ?? null;
  const requestedNonce = openRequest?.nonce ?? null;
  useEffect(() => {
    if (requestedId == null) return;
    setDetailId(requestedId);
    setDetailOpen(true);
  }, [requestedId, requestedNonce]);

  const hasFilters =
    filters.kind !== "" ||
    filters.status !== "" ||
    filters.repo !== "" ||
    filters.q !== "";

  return (
    <section className="space-y-3" data-testid="plan-library-list">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search title and body…"
            value={filters.q}
            onChange={(e) => updateFilter("q", e.target.value)}
            data-testid="plan-library-q"
          />
        </div>

        <Select
          value={filters.kind === "" ? ANY_KIND : filters.kind}
          onValueChange={(v) =>
            updateFilter("kind", v === ANY_KIND ? "" : (v as WorkArtifactKind))
          }
        >
          <SelectTrigger
            className="w-[200px]"
            data-testid="plan-library-kind"
          >
            <SelectValue placeholder="All kinds" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_KIND}>All kinds</SelectItem>
            {WORK_ARTIFACT_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          className="w-[160px]"
          placeholder="Status"
          value={filters.status}
          onChange={(e) => updateFilter("status", e.target.value)}
          data-testid="plan-library-status"
        />

        <Input
          className="w-[160px]"
          placeholder="Repo"
          value={filters.repo}
          onChange={(e) => updateFilter("repo", e.target.value)}
          data-testid="plan-library-repo"
        />

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            data-testid="plan-library-clear"
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          disabled={loading}
          data-testid="plan-library-refresh"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Suggestions from the LOADED page — explicitly not the whole corpus. */}
      {(seen.statuses.length > 0 || seen.repos.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>On this page:</span>
          {seen.statuses.map((s) => (
            <button
              key={`status-${s}`}
              type="button"
              className="rounded bg-muted px-1.5 py-0.5 hover:bg-muted/70"
              onClick={() => updateFilter("status", s)}
              data-testid={`facet-status-${s}`}
            >
              {s}
            </button>
          ))}
          {seen.repos.map((r) => (
            <button
              key={`repo-${r}`}
              type="button"
              className="rounded bg-muted px-1.5 py-0.5 hover:bg-muted/70"
              onClick={() => updateFilter("repo", r)}
              data-testid={`facet-repo-${r}`}
            >
              {r}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          data-testid="plan-library-error"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Couldn&apos;t load the library: {error}.{" "}
            {items.length > 0
              ? "Showing the last rows loaded — they may be out of date."
              : "Nothing could be loaded; this is unknown, not empty."}
          </p>
        </div>
      )}

      {loading && items.length === 0 ? (
        <Skeleton className="h-40 w-full" />
      ) : /*
           No rows AND no error is a real empty. No rows WITH an error is
           UNKNOWN — the banner above already says so, and printing "the
           library is empty" underneath it would contradict that sentence in
           the same viewport.
         */
      items.length === 0 && !error ? (
        <p
          className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground"
          data-testid="plan-library-empty"
        >
          {hasFilters
            ? "No artifacts match these filters."
            : "The library is empty. Nothing has been captured yet."}
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <ArtifactRow
              key={item.id}
              item={item}
              onOpen={() => openArtifact(item.id)}
            />
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span data-testid="plan-library-range">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              data-testid="plan-library-prev"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              data-testid="plan-library-next"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <ArtifactDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        artifactId={detailId}
        fetchDetail={fetchDetail}
        correctKind={correctKind}
        onOpenArtifact={openArtifact}
      />
    </section>
  );
}
