"use client";

import { useCallback, useState } from "react";
import {
  Code2,
  ExternalLink,
  Loader2,
  PackageCheck,
  Search,
} from "lucide-react";
import { useUIElement } from "@qontinui/ui-bridge/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useDeliveryVerdict } from "../_hooks/useDeliveryVerdict";
import { summarizeVerdict } from "../_lib/verdict-formatter";
import { formatRatio, formatStaleness } from "../_lib/status-presentation";
import type {
  DeliveryAnchorKind,
  DeliveryComponents,
  DeliveryEnv,
  DeliveryPr,
} from "../_lib/types";

/**
 * Delivery verdict lookup — the interactive "has this plan/PR landed?" card
 * (Phase 5 of plan 2026-06-15-twin-delivery-verdict-completion-view).
 *
 * Enter a plan slug → the backend proxies coord's parameterized
 * `coord_query_delivery` (the SAME tool an agent calls, force-refreshed
 * server-side), and we render the verdict a human can read: plan lifecycle
 * status ⋈ per-PR merge state ⋈ best-effort deploy state, with the credibility
 * envelope + staleness so a stale answer is visibly stale. This is the UI
 * antidote to the stale-local-checkout incident — no one needs to read a local
 * working tree to answer "is it done?".
 */

/** Visual vocabulary for the canonical delivery drift classes. */
function driftBadgeStyle(driftClass: string | undefined): {
  label: string;
  cls: string;
} {
  switch (driftClass) {
    case "none":
    case "ok":
    case "in_sync":
      return { label: "Landed", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" };
    case "pending":
    case "in_flight":
      return { label: "In flight", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" };
    case "active_negation":
      return { label: "Disagreement", cls: "bg-red-500/15 text-red-600 dark:text-red-400" };
    case "divergent":
      return { label: "Diverged", cls: "bg-red-500/15 text-red-600 dark:text-red-400" };
    case "unknown":
      return { label: "Unknown", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" };
    default:
      return {
        label: driftClass ?? "—",
        cls: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
      };
  }
}

/** GitHub PR URL — repo may be bare (`qontinui-runner`) or owner-qualified. */
function prUrl(repo: string, pr: number): string {
  const slug = repo.includes("/") ? repo : `qontinui/${repo}`;
  return `https://github.com/${slug}/pull/${pr}`;
}

/**
 * Resolve how to present the work anchor, generic over plan vs work-unit.
 * Coord's delivery verdict generalized off the plan vocabulary: a verdict may
 * now anchor to a generic work-unit (`anchor_kind === "work_unit"`, with
 * `plan_id` null and `work_unit_id` populated) instead of a plan. We never
 * crash on a null `plan_id` and key the noun + identifier off `anchor_kind`,
 * not a hard-coded vocabulary word.
 */
function anchorPresentation(components: DeliveryComponents | undefined): {
  noun: string;
  statusLabel: string;
  /** The opaque identifier to show (slug, work-unit id, or "—"). */
  identifier: string;
} {
  const kind: DeliveryAnchorKind = components?.anchor_kind ?? "plan";
  const slug = components?.slug ?? null;
  if (kind === "work_unit") {
    const id = slug ?? components?.work_unit_id ?? null;
    return {
      noun: "work unit",
      statusLabel: "Unit status",
      identifier: id ?? "—",
    };
  }
  // Default / "plan" / "none": fall back to plan-style presentation. For "none"
  // there is no anchor to name, so the generic "Status" label reads correctly.
  const id = slug ?? components?.plan_id ?? null;
  return {
    noun: kind === "none" ? "work" : "plan",
    statusLabel: kind === "none" ? "Status" : "Plan status",
    identifier: id ?? "—",
  };
}

function PrRow({ pr }: { pr: DeliveryPr }) {
  const merged = pr.merged;
  return (
    <li className="flex items-center justify-between gap-2 py-1 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`size-2 shrink-0 rounded-full ${merged ? "bg-emerald-500" : "bg-amber-500"}`}
        />
        <span className="truncate font-mono text-xs">{pr.repo}</span>
        {pr.pr !== null ? (
          <a
            href={prUrl(pr.repo, pr.pr)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
          >
            #{pr.pr}
            <ExternalLink className="size-3" />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">(no PR #)</span>
        )}
      </span>
      <span
        className={`shrink-0 text-xs font-medium ${merged ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
      >
        {merged ? "merged" : "unmerged"}
      </span>
    </li>
  );
}

function EnvRow({ env }: { env: DeliveryEnv }) {
  const inSync = env.in_sync === true;
  return (
    <li className="flex items-center justify-between gap-2 py-1 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`size-2 shrink-0 rounded-full ${inSync ? "bg-emerald-500" : "bg-amber-500"}`}
        />
        <span className="truncate font-mono text-xs">
          {env.surface ?? "?"}
          {env.target ? ` · ${env.target}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {env.drift_class ?? "—"}
        {env.observed_age_seconds !== null
          ? ` · ${formatStaleness(env.observed_age_seconds)}`
          : ""}
      </span>
    </li>
  );
}

export function DeliveryVerdictCard() {
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  const { data, isLoading, isError, error, isFetching } =
    useDeliveryVerdict(submitted);

  const handleSubmit = useCallback(() => {
    const slug = input.trim();
    if (!slug) return;
    setShowRaw(false);
    setSubmitted(slug);
  }, [input]);

  // UI Bridge: stable ids for the lookup controls (automation + spec-checks),
  // mirroring the matrix cells / AskTheTwin instrumentation (web#617).
  const { ref: inputRef } = useUIElement({
    id: "digital-twin-delivery-input",
    label: "Delivery verdict — work-unit slug",
    type: "input",
  });
  const { ref: submitRef } = useUIElement({
    id: "digital-twin-delivery-submit",
    label: "Delivery verdict — look up",
    type: "button",
  });
  const { ref: showRawRef } = useUIElement({
    id: "digital-twin-delivery-show-raw",
    label: "Delivery verdict — toggle raw data",
    type: "button",
  });

  const verdict = data?.verdict;
  const components = (verdict?.components ?? undefined) as
    | DeliveryComponents
    | undefined;
  const summary = verdict ? summarizeVerdict("delivery", verdict) : null;
  const badge = driftBadgeStyle(verdict?.drift_class);
  const prs = components?.prs ?? [];
  const envs = components?.deployed_envs ?? [];
  const anchor = anchorPresentation(components);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <PackageCheck className="size-4" /> Has it landed? — delivery verdict
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Enter a work-unit slug to get the same authoritative answer an AI agent
        gets: the unit&apos;s status joined with each cited PR&apos;s merge state
        and best-effort deploy state — with provenance and staleness, so a stale
        answer is visibly stale. No local working tree required.
      </p>

      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="e.g. 2026-06-13-approach-d-conductor-engine"
          className="flex-1 font-mono text-xs"
          spellCheck={false}
        />
        <Button
          ref={submitRef}
          onClick={handleSubmit}
          disabled={!input.trim() || isFetching}
          className="gap-1.5"
        >
          {isFetching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
          Look up
        </Button>
      </div>

      {isLoading && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Reading the delivery
          verdict…
        </p>
      )}

      {isError && (
        <p className="mt-3 text-sm text-muted-foreground">
          Could not read the delivery verdict
          {error instanceof Error ? `: ${error.message}` : ""}.
        </p>
      )}

      {verdict && summary && (
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}
            >
              {badge.label}
            </span>
            {verdict.drift_subclass && (
              <span className="font-mono text-xs text-muted-foreground">
                {verdict.drift_subclass}
              </span>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {formatStaleness(verdict.staleness_seconds)}
            </span>
          </div>

          <p>{summary.prose}</p>

          {prs.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">
                Cited PRs
              </p>
              <ul className="rounded-md border border-border bg-muted/30 px-3 py-1">
                {prs.map((pr, i) => (
                  <PrRow key={`${pr.repo}-${pr.pr ?? i}`} pr={pr} />
                ))}
              </ul>
            </div>
          )}

          {envs.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">
                Deploy / serving
              </p>
              <ul className="rounded-md border border-border bg-muted/30 px-3 py-1">
                {envs.map((env, i) => (
                  <EnvRow key={`${env.surface}-${env.target}-${i}`} env={env} />
                ))}
              </ul>
            </div>
          )}

          <Separator />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <Fact
              label={`${anchor.noun[0]!.toUpperCase()}${anchor.noun.slice(1)}`}
              value={anchor.identifier}
            />
            <Fact label={anchor.statusLabel} value={components?.status ?? "—"} />
            <Fact
              label="Registered"
              value={
                components?.registered === undefined
                  ? "—"
                  : components.registered
                    ? "yes"
                    : "no"
              }
            />
            <Fact label="Coverage" value={formatRatio(verdict.coverage)} />
            <Fact label="Credibility" value={formatRatio(verdict.credibility)} />
            <Fact
              label="Freshness"
              value={formatStaleness(verdict.staleness_seconds)}
            />
            <Fact label="Source" value={verdict.provenance ?? "—"} />
          </dl>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              The exact JSON an AI agent receives from{" "}
              <code>{data?.tool ?? "coord_query_delivery"}</code>.
            </span>
            <Button
              ref={showRawRef}
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setShowRaw((v) => !v)}
            >
              <Code2 className="size-3.5" />
              {showRaw ? "Hide raw data" : "Show raw data"}
            </Button>
          </div>
          {showRaw && (
            <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/50 p-3 text-[11px] leading-relaxed">
              {JSON.stringify(verdict, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium">{value}</dd>
    </div>
  );
}
