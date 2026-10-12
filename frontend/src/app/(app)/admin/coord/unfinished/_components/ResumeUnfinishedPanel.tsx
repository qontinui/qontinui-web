"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { useResumeUnfinishedPolicy } from "../_hooks/useResumeUnfinishedPolicy";

/**
 * "Resume unfinished sessions automatically" —
 * `coord.tenant_policies.resume_unfinished_enabled`.
 *
 * `resume_unfinished_enabled: null` is UNKNOWN (coord did not report a
 * boolean, or the read failed with nothing read before). It is rendered as
 * unknown with NEITHER button highlighted — it never resolves to On.
 */
export function ResumeUnfinishedPanel({
  state,
}: {
  /** Owned by the page, which also needs `can_edit` for the row actions. */
  state: ReturnType<typeof useResumeUnfinishedPolicy>;
}) {
  const [pending, setPending] = useState<boolean | null>(null);
  const { policy, loading, saving, error, readbackError, setEnabled } = state;

  const current = policy?.resume_unfinished_enabled ?? null;
  const canEdit = policy?.can_edit === true;

  return (
    <section
      className="rounded-lg border border-border bg-card p-3"
      data-testid="resume-unfinished-policy"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">
          Resume unfinished sessions automatically
        </h2>
        {([true, false] as const).map((value) => (
          <Button
            key={String(value)}
            size="sm"
            variant={current === value ? "default" : "outline"}
            disabled={saving || loading || !canEdit}
            onClick={() => {
              setPending(value);
              setEnabled(value).finally(() => setPending(null));
            }}
            data-testid={`resume-unfinished-${value ? "on" : "off"}`}
          >
            {saving && pending === value && (
              <Loader2 className="size-3.5 animate-spin" />
            )}
            {value ? "On" : "Off"}
          </Button>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Coord enforces
          <Badge
            variant={current === true ? "default" : "outline"}
            data-testid="resume-unfinished-effective"
          >
            {current === null ? "unknown" : current ? "on" : "off"}
          </Badge>
        </span>
      </div>
      <p className="mt-2 max-w-3xl text-xs text-muted-foreground">
        When on, each runner&apos;s sweep resumes a closed session whose work
        was never declared finished, after reading the session to decide it is
        still owed work. Off leaves them here for you to Resume or Dismiss by
        hand.
      </p>
      {!canEdit && (
        <p
          className="mt-1 text-xs text-muted-foreground"
          data-testid="resume-unfinished-readonly"
        >
          {policy
            ? "Read-only: you are not an admin of this tenant."
            : "Read-only: your role could not be read, so whether a write would be accepted is unknown."}
        </p>
      )}
      {policy && current === null && (
        <p
          className="mt-1 text-xs text-muted-foreground"
          data-testid="resume-unfinished-unreported"
        >
          Coord did not report this setting, so whether it resumes sessions
          automatically is unknown — not off.
        </p>
      )}
      {readbackError && (
        <p
          className="mt-2 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200"
          data-testid="resume-unfinished-readback-error"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          After the last write, {readbackError}. The value shown is the last one
          confirmed and may be stale.
        </p>
      )}
      {error && (
        <p
          className="mt-2 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200"
          data-testid="resume-unfinished-error"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Couldn&apos;t read the setting: {error}.{" "}
          {policy
            ? "Showing the last value read, which may be out of date."
            : "The current value is unknown."}
        </p>
      )}
    </section>
  );
}
