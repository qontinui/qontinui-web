"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  ArrowDownLeft,
  ArrowUpRight,
  HelpCircle,
  Link2,
  Lock,
} from "lucide-react";
import {
  KIND_LABELS,
  WORK_ARTIFACT_KINDS,
  kindLabel,
  type CandidateCoordLink,
  type WorkArtifactDetail,
  type WorkArtifactEdge,
  type WorkArtifactKind,
} from "../types";

function formatWhen(iso: string | null): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Why a `merged: false` can arrive as `unknown` — shown on the badge itself,
 * because the word alone reads like a third merge state rather than an absence
 * of evidence.
 *
 * The backend projects a citation to `state: "unknown"` (and `merged: null`)
 * whenever coord flagged `merged_degraded_reason`: its `merged` predicate is
 * then running without the durable `merge_commit_sha` arm, so every PR coord
 * fast-forward-landed reads `false`. Coord ff-lands routinely, so rendering
 * that `false` as the fact "unmerged" would be wrong far more often than not.
 * A `true` is unaffected — the degraded arm can only produce false negatives.
 */
const UNKNOWN_MERGED_HINT =
  "Coord's merged predicate is running degraded (no merge_commit_sha arm), " +
  "so it cannot tell an unmerged PR from one it fast-forward-landed. This is " +
  'an absence of evidence, not the fact "unmerged".';

/**
 * The linked coord work unit and its PR citations.
 *
 * Four distinct states, and flattening any pair of them would be a
 * correctness bug rather than a cosmetic one:
 *
 * * `unlinked` — this artifact names no work unit. A first-class NORMAL state
 *   (most artifacts have none), not an error and not a warning.
 * * `dangling` — it names one coord does not have. Also normal: the link is
 *   FK-less by design and is allowed to dangle.
 * * `unavailable` — coord could not be read. UNKNOWN.
 * * PRs `unavailable` — the citation read did not happen: coord was
 *   unreachable, refused the door, or answered that it could not read the
 *   relation. An empty list would mean "we could not ask", not "no PRs".
 *
 * One level further down, an individual PR row carries the SAME distinction on
 * its merged state — see {@link UNKNOWN_MERGED_HINT}.
 */
function CoordLinkBlock({ coord }: { coord: CandidateCoordLink }) {
  if (coord.work_unit_state === "unlinked") {
    return (
      <p className="text-xs text-muted-foreground" data-testid="coord-unlinked">
        No linked work unit. The link is optional — most artifacts have none.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="coord-link">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
        <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
          {coord.work_unit_slug}
        </code>
        {coord.work_unit_state === "linked" && (
          <>
            <Badge variant="outline">
              {coord.work_unit_status ?? "no status"}
            </Badge>
            {coord.work_unit_title && (
              <span className="truncate text-xs text-muted-foreground">
                {coord.work_unit_title}
              </span>
            )}
          </>
        )}
      </div>

      {coord.work_unit_state === "dangling" && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-dangling"
        >
          Coord has no work unit with this slug. The link carries no foreign key
          and is allowed to dangle — this is a normal result, not an error.
        </p>
      )}

      {coord.work_unit_state === "unavailable" && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          data-testid="coord-unavailable"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Coord could not be read ({coord.unavailable_reason ?? "no reason"}).
            Whether this work unit exists is <strong>unknown</strong> — not
            &quot;it doesn&apos;t&quot;.
          </p>
        </div>
      )}

      {/* PR citations — their own state, tracked separately on purpose. */}
      {coord.linked_prs_state === "available" ? (
        coord.linked_prs.length > 0 ? (
          <ul className="space-y-1" data-testid="coord-prs">
            {coord.linked_prs.map((pr, i) => (
              <li
                key={`${pr.repo}#${pr.pr_number}-${i}`}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                  {pr.repo ?? "?"}#{pr.pr_number ?? "?"}
                </code>
                <Badge
                  variant={pr.state === "merged" ? "default" : "outline"}
                  className={
                    pr.state === "unknown"
                      ? "border-dashed border-amber-500/60 text-amber-700 dark:text-amber-300"
                      : undefined
                  }
                  data-testid={`coord-pr-state-${pr.state}`}
                  title={
                    pr.state === "unknown" ? UNKNOWN_MERGED_HINT : undefined
                  }
                >
                  {pr.state}
                </Badge>
                {pr.state === "unknown" && (
                  <span
                    className="text-muted-foreground"
                    data-testid="coord-pr-unknown-hint"
                  >
                    not &quot;unmerged&quot; — coord could not decide
                  </span>
                )}
                {pr.branch && (
                  <span className="truncate text-muted-foreground">
                    {pr.branch}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p
            className="text-xs text-muted-foreground"
            data-testid="coord-prs-none"
          >
            Coord answered: this work unit has no PR citations.
          </p>
        )
      ) : coord.linked_prs_state === "unavailable" ? (
        <div
          className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2"
          data-testid="coord-prs-unavailable"
        >
          <HelpCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            <strong>PR citations unavailable</strong> —{" "}
            {coord.unavailable_reason ??
              "coord did not answer the citation read"}
            . This is not an empty list: the citations could not be asked for,
            so how many exist is unknown.
          </p>
        </div>
      ) : (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coord-prs-unlinked"
        >
          No work unit to hang citations off, so there are genuinely none.
        </p>
      )}
    </div>
  );
}

/** Provenance edges, split by direction — both are rendered, always. */
function EdgeList({
  edges,
  direction,
  onOpen,
}: {
  edges: WorkArtifactEdge[];
  direction: "incoming" | "outgoing";
  onOpen: (id: string) => void;
}) {
  const filtered = edges.filter((e) => e.direction === direction);
  const Icon = direction === "outgoing" ? ArrowUpRight : ArrowDownLeft;
  const heading =
    direction === "outgoing"
      ? "Leads to (this artifact → …)"
      : "Came from (… → this artifact)";

  return (
    <div data-testid={`edges-${direction}`}>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />
        {heading}
      </h4>
      {filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing recorded in this direction.
        </p>
      ) : (
        <ul className="space-y-1">
          {filtered.map((edge) => {
            const peerId = direction === "outgoing" ? edge.to_id : edge.from_id;
            return (
              <li
                key={edge.id}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <Badge variant="outline" className="shrink-0">
                  {edge.relation}
                </Badge>
                <button
                  type="button"
                  className="truncate text-left underline-offset-2 hover:underline"
                  onClick={() => onOpen(peerId)}
                  data-testid={`edge-peer-${edge.id}`}
                >
                  {edge.peer_title || edge.peer_slug || peerId}
                </button>
                {edge.peer_kind && (
                  <span className="shrink-0 text-muted-foreground">
                    {kindLabel(edge.peer_kind)}
                  </span>
                )}
                {edge.note && (
                  <span className="truncate text-muted-foreground">
                    — {edge.note}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface ArtifactDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifactId: string | null;
  fetchDetail: (id: string) => Promise<WorkArtifactDetail | null>;
  correctKind: (id: string, kind: WorkArtifactKind) => Promise<boolean>;
  /** Follow a provenance edge to the artifact at the other end. */
  onOpenArtifact: (id: string) => void;
}

/**
 * One artifact in full: the rendered body, the version log, the provenance
 * chain in BOTH directions, the coord link, and an inline kind correction.
 *
 * The kind correction is a real write, not a display toggle: it sets
 * `kind_locked`, which is what stops the next runner scan from putting its
 * heuristic guess back. Because `kind` is part of the artifact's identity, a
 * correction without the lock would fork the document into a second row
 * rather than re-label it — which is the exact failure the "Kind forks"
 * section of the divergence panel reports.
 */
export function ArtifactDetailDialog({
  open,
  onOpenChange,
  artifactId,
  fetchDetail,
  correctKind,
  onOpenArtifact,
}: ArtifactDetailDialogProps) {
  const [detail, setDetail] = useState<WorkArtifactDetail | null>(null);
  const [loading, setLoading] = useState(false);
  /** The fetch came back empty. Distinct from `loading` — see the render. */
  const [failed, setFailed] = useState(false);
  const [savingKind, setSavingKind] = useState(false);

  /**
   * Monotonic id of the newest detail request. Every `setState` in [`load`] is
   * gated on still owning it.
   *
   * A boolean `cancelled` captured by the effect cannot do this job: the writes
   * live INSIDE `load` (so the retry button can reuse it), which the effect's
   * closure cannot reach — it only gets to look after `load` has already
   * painted. Following an edge from artifact A to B while A is in flight then
   * inverts: `load(B)` paints B, the late `load(A)` overwrites it and clears
   * `loading`, and a post-hoc guard can only null the detail out — leaving
   * `detail=null, failed=false, loading=false`, i.e. a permanent skeleton for
   * an artifact that fetched fine. Out-of-order resolution is easy here,
   * because the detail read makes up to two 5s coord round-trips when
   * `work_unit_slug` is set. So drop stale resolutions BEFORE they write.
   */
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (id: string) => {
      const reqId = ++requestIdRef.current;
      setLoading(true);
      setFailed(false);
      const full = await fetchDetail(id);
      // Stale: a newer request superseded this one. Write nothing at all —
      // not the detail, not `failed`, and not `loading` (the live request
      // owns that and will clear it when it lands).
      if (reqId !== requestIdRef.current) return full;
      setDetail(full);
      setFailed(full === null);
      setLoading(false);
      return full;
    },
    [fetchDetail]
  );

  useEffect(() => {
    if (!open || !artifactId) {
      // Invalidate anything in flight so it cannot paint into a closed dialog.
      requestIdRef.current += 1;
      setDetail(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    setDetail(null);
    void load(artifactId);
    return () => {
      // Param changed or unmounted — the in-flight request is now stale.
      requestIdRef.current += 1;
    };
  }, [open, artifactId, load]);

  /**
   * Apply an operator's kind correction, then re-read the artifact.
   *
   * The refresh goes through [`load`], NOT through `fetchDetail` directly.
   * Two reasons, and the second is the one that bites:
   *
   * 1. `load` owns `requestIdRef`. A raw `fetchDetail` neither bumps the
   *    generation nor checks it, so its result paints unconditionally — and
   *    this read makes up to two 5s coord round-trips. Correct A's kind,
   *    follow a provenance edge to B while the refresh is in flight, and A
   *    lands on top of B.
   * 2. `handleKind` keys off `detail.id`. Once A has overwritten B, the
   *    operator's NEXT correction PATCHes A while the dialog is showing B —
   *    locking the kind on the wrong row, which `kind_locked` then defends
   *    against the scan that would have fixed it.
   *
   * The id is captured BEFORE the await for the same reason: `detail` may be
   * a different artifact by the time the PATCH resolves.
   *
   * A failed refresh is surfaced rather than swallowed. `if (refreshed)
   * setDetail(refreshed)` left the success toast on screen next to a Select
   * still showing the old kind — the one reading of the screen that is
   * definitely wrong, because it says both that the write happened and that
   * it did not. `load` writes `failed` on a null result, which renders the
   * error panel and its retry.
   */
  const handleKind = async (next: string) => {
    if (!detail) return;
    const id = detail.id;
    setSavingKind(true);
    const ok = await correctKind(id, next as WorkArtifactKind);
    if (ok) await load(id);
    setSavingKind(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] max-w-3xl overflow-y-auto"
        data-testid="artifact-detail-dialog"
      >
        <DialogHeader>
          <DialogTitle className="truncate">
            {detail?.title || detail?.slug || "Artifact"}
          </DialogTitle>
          <DialogDescription>
            {detail
              ? `${detail.slug} · v${detail.current_version} · captured by ${detail.captured_by}`
              : failed
                ? "Could not be loaded"
                : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {/*
          `failed` is checked BEFORE the skeleton. A failed fetch leaves
          `detail` null and `loading` false, so a `loading || !detail` guard
          would render the skeleton forever and describe a dead dialog as one
          that is still working.
        */}
        {failed ? (
          <div
            className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5"
            data-testid="artifact-detail-error"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-xs text-amber-800 dark:text-amber-200">
              <p>This artifact could not be loaded.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => artifactId && load(artifactId)}
                data-testid="artifact-detail-retry"
              >
                Try again
              </Button>
            </div>
          </div>
        ) : loading || !detail ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-5">
            {/* ── identity + inline kind correction ── */}
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={detail.kind}
                onValueChange={handleKind}
                disabled={savingKind}
              >
                <SelectTrigger
                  className="w-[220px]"
                  data-testid="artifact-kind-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORK_ARTIFACT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {detail.kind_locked ? (
                <span
                  className="flex items-center gap-1 text-[11px] text-muted-foreground"
                  data-testid="artifact-kind-locked"
                >
                  <Lock className="size-3" />
                  Locked — a re-scan cannot move this kind.
                </span>
              ) : (
                <span
                  className="text-[11px] text-muted-foreground"
                  data-testid="artifact-kind-unlocked"
                >
                  Guessed by a scan. Confirming it here locks it.
                </span>
              )}
              {detail.status && (
                <Badge variant="outline">{detail.status}</Badge>
              )}
              {detail.repos.map((r) => (
                <Badge key={r} variant="outline">
                  {r}
                </Badge>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              {detail.source_repo ?? "no source repo"}
              {detail.source_path ? ` · ${detail.source_path}` : ""} · authored{" "}
              {formatWhen(detail.authored_at)} · updated{" "}
              {formatWhen(detail.updated_at)}
            </p>

            {/* ── coord link ── */}
            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Coord work unit
              </h4>
              <CoordLinkBlock coord={detail.coord} />
            </div>

            {/* ── provenance, both directions ── */}
            <div className="grid gap-4 sm:grid-cols-2">
              <EdgeList
                edges={detail.edges}
                direction="incoming"
                onOpen={onOpenArtifact}
              />
              <EdgeList
                edges={detail.edges}
                direction="outgoing"
                onOpen={onOpenArtifact}
              />
            </div>

            {/* ── body ── */}
            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Body
              </h4>
              <pre
                className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed"
                data-testid="artifact-body"
              >
                {detail.body || "(empty)"}
              </pre>
            </div>

            {/* ── version history ── */}
            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Version history · {detail.versions.length}
              </h4>
              {detail.versions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No version snapshots recorded.
                </p>
              ) : (
                <ul className="space-y-1" data-testid="artifact-versions">
                  {detail.versions.map((v) => (
                    <li
                      key={v.id}
                      className="flex flex-wrap items-center gap-2 text-xs"
                    >
                      <Badge variant="outline" className="shrink-0">
                        v{v.version_number}
                      </Badge>
                      <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                        {v.content_sha256.slice(0, 10)}
                      </code>
                      <span className="text-muted-foreground">
                        {formatWhen(v.created_at)}
                      </span>
                      {v.created_by && (
                        <span className="truncate text-muted-foreground">
                          by {v.created_by}
                        </span>
                      )}
                      {v.change_description && (
                        <span className="truncate text-muted-foreground">
                          — {v.change_description}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
