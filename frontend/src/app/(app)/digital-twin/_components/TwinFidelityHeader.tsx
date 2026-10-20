"use client";

import { Gauge, Lock } from "lucide-react";
import { useSubspaceRaw } from "../_hooks/useSubspaceRaw";
import { formatRatio } from "../_lib/status-presentation";
import { formatAge, formatCount, readFidelity } from "../_lib/twin-fidelity";

/** The sub-space whose raw read carries the twin's self-fidelity report. */
const FIDELITY_SUBSPACE = "twin_fidelity";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      {/* dt before dd in the DOM (a valid <dl>); the number reads first. */}
      <dt className="order-2 text-[11px] leading-tight text-muted-foreground">
        {label}
      </dt>
      <dd className="order-1 text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * "Twin self-fidelity" — how much of itself the twin is actually seeing, and
 * how honestly: coord's twin-fidelity report (observability rate, blind
 * sub-spaces, honesty violations and their stale-evidence and
 * stale-at-decision classes), with the report's age.
 *
 * It reads `/api/v1/digital-twin/subspace/twin_fidelity/raw`. Until coord
 * serves that read (plan `2026-10-11-twin-honesty-and-reachability` Phase 4b
 * caches the report so the probe can answer inside the page's budget), the
 * header says UNKNOWN rather than showing zeros; for a tenant that is not
 * Qontinui's own, it says the report is Qontinui-internal.
 *
 * A 24 h trend needs coord's fidelity tool called with a window argument
 * (`window_hours`, which that plan's Phase 4b adds). coord's twin door
 * dispatches every read with NO arguments, so the trend stays UNKNOWN until a
 * door forwards that argument; the header says so instead of inventing one.
 */
export function TwinFidelityHeader() {
  const query = useSubspaceRaw(FIDELITY_SUBSPACE, true);
  const read = readFidelity(query, Date.now());

  return (
    <section
      data-testid="digital-twin-fidelity-header"
      aria-labelledby="digital-twin-fidelity-heading"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <Gauge className="size-4 text-muted-foreground" aria-hidden />
        <h2
          id="digital-twin-fidelity-heading"
          className="text-sm font-semibold"
        >
          Twin self-fidelity
        </h2>
        {read.kind === "report" && (
          <span className="text-xs text-muted-foreground">
            report {formatAge(read.report.ageSeconds)}
          </span>
        )}
      </div>

      {read.kind === "loading" && (
        <p className="text-xs text-muted-foreground">Reading the report…</p>
      )}

      {read.kind === "internal" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          Qontinui-internal — the twin&apos;s fidelity report covers
          Qontinui&apos;s own infrastructure and is readable only by
          Qontinui&apos;s operators.
        </p>
      )}

      {read.kind === "unknown" && (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold">UNKNOWN</span> — {read.reason}. No
          number is shown rather than a zero that was never measured.
        </p>
      )}

      {read.kind === "report" && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat
              label="observability rate"
              value={
                read.report.observabilityRate === null
                  ? "UNKNOWN"
                  : formatRatio(read.report.observabilityRate)
              }
            />
            <Stat
              label="blind sub-spaces"
              value={formatCount(read.report.blindCount)}
            />
            <Stat
              label="honesty violations"
              value={formatCount(read.report.honestyViolations)}
            />
            <Stat
              label="stale evidence"
              value={formatCount(read.report.staleEvidenceViolations)}
            />
            <Stat
              label="stale at decision"
              value={formatCount(read.report.staleAtDecisionViolations)}
            />
          </dl>
          <p className="text-[11px] text-muted-foreground">
            24 h trend: UNKNOWN — coord&apos;s twin door passes no window
            argument, so no trend reaches this page.
          </p>
        </>
      )}
    </section>
  );
}
