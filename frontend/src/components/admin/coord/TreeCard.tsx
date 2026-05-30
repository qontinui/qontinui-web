"use client";

/**
 * TreeCard — render a single `coord.primary_trees` row.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2).
 *
 * Visual rules:
 *  - "dirty" badge when row.dirty=true
 *  - Stale-WIP highlighting (24h+ warning, 72h+ critical) keyed off
 *    `last_seen` (or `wip_last_modified` if present).
 */

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch, AlertTriangle, ArrowUp } from "lucide-react";

export interface PrimaryTreeRow {
  device_id?: string;
  hostname?: string;
  repo: string;
  primary_path: string;
  branch?: string | null;
  dirty?: boolean;
  last_seen?: string | null;
  wip_last_modified?: string | null;
  behind_count?: number | null;
  local_ahead?: number | null;
  head_detached?: boolean | null;
  untracked_count?: number | null;
}

/**
 * Client-side pull-safety class — a faithful mirror of the Rust ladder
 * `policies::decide::pull_safety_verdict` in
 * `qontinui-coord/src/policies/decide.rs:800` (the SOURCE OF TRUTH). Keep these
 * two in lockstep; the sibling unit test (`TreeCard.test.ts`) asserts the same
 * 6-case matrix as the Rust verdict tests to catch drift.
 *
 * Timing (Now/Defer) is server-only and deliberately NOT computed here — this
 * is the safety class only; the full timing + outcome live on the Pull
 * Decisions page.
 */
export type PullSafetyClass =
  | { kind: "up_to_date" }
  | { kind: "default_ref_sync" }
  | { kind: "hold"; reason: "wip_on_default" | "detached" }
  | { kind: "diverged" }
  | { kind: "pull" };

const DEFAULT_BRANCHES = new Set(["main", "master"]);

/**
 * Mirrors `pull_safety_verdict` exactly (decide.rs:800). The 6-case order is
 * load-bearing: detached (case 2) outranks feature-branch (case 3), and
 * dirty-on-default (case 4) outranks diverged (case 5).
 */
export function pullSafetyClass(
  row: Pick<
    PrimaryTreeRow,
    "behind_count" | "head_detached" | "branch" | "dirty" | "local_ahead"
  >
): PullSafetyClass {
  // 1. behind_count <= 0 → UpToDate (nothing to pull).
  if ((row.behind_count ?? 0) <= 0) {
    return { kind: "up_to_date" };
  }
  // 2. head_detached → Hold{Detached}.
  if (row.head_detached === true) {
    return { kind: "hold", reason: "detached" };
  }
  // 3. feature branch → DefaultRefSync. A missing/empty branch is treated as a
  //    feature branch (conservative — never auto-pulls into an unknown ref),
  //    matching the Rust default where `is_default_branch=false`.
  const branch = row.branch ?? "";
  if (!DEFAULT_BRANCHES.has(branch)) {
    return { kind: "default_ref_sync" };
  }
  // On the default branch from here.
  // 4. dirty → Hold{WipOnDefault} (never auto-stash).
  if (row.dirty === true) {
    return { kind: "hold", reason: "wip_on_default" };
  }
  // 5. local_ahead > 0 → Diverged (never auto-rebase).
  if ((row.local_ahead ?? 0) > 0) {
    return { kind: "diverged" };
  }
  // 6. else → Pull (ff-only safe).
  return { kind: "pull" };
}

type VerdictBadgeMeta = {
  label: string;
  variant: "success" | "info" | "warning" | "destructive" | "secondary";
  title: string;
  testid: string;
};

function verdictBadgeMeta(cls: PullSafetyClass): VerdictBadgeMeta {
  switch (cls.kind) {
    case "pull":
      return {
        label: "pull",
        variant: "success",
        title: "would auto-pull ff-only",
        testid: "coord-tree-verdict-pull",
      };
    case "default_ref_sync":
      return {
        label: "ref-sync",
        variant: "info",
        title: "feature branch — local default ref ff-sync",
        testid: "coord-tree-verdict-default_ref_sync",
      };
    case "hold":
      return {
        label: cls.reason === "detached" ? "hold: detached" : "hold: WIP",
        variant: "warning",
        title:
          cls.reason === "detached"
            ? "held — detached HEAD"
            : "held — WIP on default branch",
        testid: "coord-tree-verdict-hold",
      };
    case "diverged":
      return {
        label: "diverged",
        variant: "destructive",
        title: "diverged — unpushed local commits, manual rebase",
        testid: "coord-tree-verdict-diverged",
      };
    case "up_to_date":
      return {
        label: "up to date",
        variant: "secondary",
        title: "up to date with origin — nothing to pull",
        testid: "coord-tree-verdict-up_to_date",
      };
  }
}

function hoursAgo(iso?: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / 3_600_000;
}

function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const h = hoursAgo(iso);
  if (h === null) return "—";
  if (h < 1) return `${Math.max(0, Math.floor(h * 60))}m ago`;
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function TreeCard({ tree }: { tree: PrimaryTreeRow }) {
  const wipHours =
    hoursAgo(tree.wip_last_modified ?? null) ?? hoursAgo(tree.last_seen ?? null);
  const isCritical = tree.dirty && wipHours !== null && wipHours >= 72;
  const isWarning =
    tree.dirty && wipHours !== null && wipHours >= 24 && wipHours < 72;

  const localAhead = tree.local_ahead ?? 0;
  const verdict = pullSafetyClass(tree);
  const verdictMeta = verdictBadgeMeta(verdict);
  const verdictHref = tree.device_id
    ? `/admin/coord/pull-decisions?device_id=${encodeURIComponent(
        tree.device_id
      )}&repo=${encodeURIComponent(tree.repo)}`
    : `/admin/coord/pull-decisions?repo=${encodeURIComponent(tree.repo)}`;

  return (
    <Card
      data-testid="coord-tree-card"
      className={
        isCritical
          ? "border-destructive"
          : isWarning
            ? "border-amber-500"
            : undefined
      }
    >
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-sm font-medium">{tree.repo}</span>
          {tree.dirty && (
            <Badge variant="destructive" data-testid="coord-tree-dirty-badge">
              dirty
            </Badge>
          )}
          {isCritical && (
            <Badge
              variant="destructive"
              className="gap-1"
              data-testid="coord-tree-stale-critical"
            >
              <AlertTriangle className="h-3 w-3" />
              stale 72h+
            </Badge>
          )}
          {isWarning && (
            <Badge
              variant="secondary"
              className="gap-1"
              data-testid="coord-tree-stale-warning"
            >
              <AlertTriangle className="h-3 w-3" />
              stale 24h+
            </Badge>
          )}
          {tree.branch && (
            <Badge variant="outline" className="font-mono text-xs">
              {tree.branch}
            </Badge>
          )}
          {localAhead > 0 && (
            <Badge
              variant="warning"
              className="gap-1"
              title="unpushed local commits ahead of origin"
              data-testid="coord-tree-ahead-badge"
            >
              <ArrowUp className="h-3 w-3" />
              {localAhead} ahead
            </Badge>
          )}
          <Link href={verdictHref} title={verdictMeta.title}>
            <Badge
              variant={verdictMeta.variant}
              className="cursor-pointer"
              data-testid={verdictMeta.testid}
            >
              {verdictMeta.label}
            </Badge>
          </Link>
        </div>
        <p className="text-xs text-muted-foreground font-mono break-all">
          {tree.primary_path}
        </p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {tree.hostname && <span>host: {tree.hostname}</span>}
          {tree.device_id && (
            <Link
              href={`/admin/coord/fleet`}
              className="hover:text-foreground"
            >
              device: {tree.device_id.slice(0, 8)}…
            </Link>
          )}
          <span>last_seen: {relativeTime(tree.last_seen)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
