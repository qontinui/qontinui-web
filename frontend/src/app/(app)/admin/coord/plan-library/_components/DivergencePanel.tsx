"use client";

import { AlertTriangle, GitFork, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDivergentArtifacts } from "../_hooks/usePlanLibrary";
import { kindLabel, type DivergentVariant } from "../types";

function VariantRow({
  variant,
  onOpen,
  showKind,
}: {
  variant: DivergentVariant;
  onOpen: (id: string) => void;
  /** Kind-fork groups differ BY kind, so the kind is the salient column. */
  showKind?: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-t border-border/60 px-3 py-2 text-xs"
      data-testid={`divergent-variant-${variant.id}`}
    >
      {showKind && (
        <Badge variant="outline" className="shrink-0">
          {kindLabel(variant.kind)}
        </Badge>
      )}
      {variant.kind_locked && (
        <Lock
          className="size-3 shrink-0 text-muted-foreground"
          aria-label="kind locked"
        />
      )}
      <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">
        {variant.content_sha256.slice(0, 10)}
      </code>
      <span className="truncate text-muted-foreground">
        {variant.source_repo ?? "no source repo"}
        {variant.source_path ? ` · ${variant.source_path}` : ""}
      </span>
      <span className="ml-auto shrink-0 text-muted-foreground">
        v{variant.current_version}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 px-2 text-xs"
        onClick={() => onOpen(variant.id)}
        data-testid={`divergent-open-${variant.id}`}
      >
        Open
      </Button>
    </div>
  );
}

/**
 * The two divergence classes, reported side by side and never merged.
 *
 * **Content drift** — same `(kind, slug)`, different digest. The same document
 * captured from two checkouts that have drifted apart.
 *
 * **Kind forks** — same `(slug, source_repo)`, disagreeing `kind`. A different
 * failure, and one that grouping by `(kind, slug)` structurally cannot see:
 * the whole distinguishing feature IS the kind. `resolvable: false` means no
 * single corrected row exists to prefer, so the scanner refuses to pick a
 * winner (it 409s) and an operator must correct one from the detail view.
 */
export function DivergencePanel({
  onOpenArtifact,
}: {
  onOpenArtifact: (id: string) => void;
}) {
  const { data, loading, error } = useDivergentArtifacts();

  const nothing =
    data != null && data.total === 0 && data.kind_fork_total === 0;

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="divergence-panel"
    >
      <div className="flex items-start gap-3">
        <GitFork className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold">Divergent copies</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Documents the library holds more than one version of — either the
            same document with drifted content, or the same document filed
            under two different kinds.
          </p>
        </div>
      </div>

      {error && (
        <div
          className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          data-testid="divergence-error"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Couldn&apos;t read divergent copies: {error}. This is unknown, not
            &quot;none&quot;.
          </p>
        </div>
      )}

      {loading && !data ? (
        <Skeleton className="mt-4 h-20 w-full" />
      ) : nothing ? (
        <p
          className="mt-4 text-xs text-muted-foreground"
          data-testid="divergence-empty"
        >
          No divergent copies. Every document has one agreed content digest and
          one kind.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {data != null && data.total > 0 && (
            <div data-testid="divergence-content-groups">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Content drift · {data.total}
              </h3>
              <div className="space-y-2">
                {data.groups.map((group) => (
                  <div
                    key={`${group.kind}/${group.slug}`}
                    className="rounded-md border border-border"
                    data-testid={`divergent-group-${group.slug}`}
                  >
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <Badge variant="outline">{kindLabel(group.kind)}</Badge>
                      <span className="truncate text-sm font-medium">
                        {group.slug}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {group.variant_count} copies
                      </span>
                    </div>
                    {group.variants.map((v) => (
                      <VariantRow
                        key={v.id}
                        variant={v}
                        onOpen={onOpenArtifact}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {data != null && data.kind_fork_total > 0 && (
            <div data-testid="divergence-kind-forks">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Kind forks · {data.kind_fork_total}
              </h3>
              <div className="space-y-2">
                {data.kind_forks.map((fork) => (
                  <div
                    key={`${fork.slug}/${fork.source_repo ?? ""}`}
                    className="rounded-md border border-border"
                    data-testid={`kind-fork-${fork.slug}`}
                  >
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="truncate text-sm font-medium">
                        {fork.slug}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fork.source_repo ?? "no source repo"}
                      </span>
                      <Badge
                        variant={fork.resolvable ? "outline" : "destructive"}
                        className="ml-auto"
                        data-testid={`kind-fork-resolvable-${fork.slug}`}
                      >
                        {fork.resolvable
                          ? "Self-healing"
                          : "Needs an operator"}
                      </Badge>
                    </div>
                    <p className="px-3 pb-2 text-[11px] text-muted-foreground">
                      Filed as {fork.kinds.map(kindLabel).join(" and ")}.{" "}
                      {/*
                        `resolvable` is `sum(kind_locked) === 1`, so `false`
                        covers TWO cases — no locked copy, and several. Saying
                        "no copy is kind-locked" would be a false statement
                        about the second, which is the one where two people
                        each asserted a different kind.
                      */}
                      {fork.resolvable
                        ? "Exactly one copy is kind-locked, so the next scan will prefer it and the fork heals itself."
                        : "There is no single kind-locked copy to prefer, so the scanner refuses to pick a winner. Open one and correct its kind to settle it."}
                    </p>
                    {fork.variants.map((v) => (
                      <VariantRow
                        key={v.id}
                        variant={v}
                        onOpen={onOpenArtifact}
                        showKind
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
