"use client";

/**
 * The four chips that carry this page's correctness requirements.
 *
 * They are grouped in one file on purpose: each encodes a distinction the UI
 * is forbidden to collapse, and keeping them together makes a future change
 * to one of them face the other three.
 *
 * * {@link TenantAttributionBadge} — plan §3.6 rule 2. A DERIVED, AMBIGUOUS or
 *   UNKNOWN tenant must be visibly weaker than a DECLARED one. "Visibly
 *   weaker" is implemented on four independent channels so no single one has
 *   to carry it: the word ("guessed" / "ambiguous" / "unknown" is IN the
 *   label), the icon (shield vs question-mark vs warning), the border (solid
 *   vs dashed) and the value treatment (a declared tenant id renders as a
 *   plain value; a guessed one renders italic behind a `?`).
 * * {@link DigestBadge} — plan §5. A `coord_redacted` body's `content_sha256`
 *   was computed over redacted bytes and can NEVER be verified against the
 *   original file. The chip says "NOT verifiable" in the label itself.
 * * {@link SecretFindingsBadge} — plan §4.1/§5. A recorded audit signal, and
 *   explicitly NOT a visibility gate and NOT a mask. It also keeps NULL and
 *   `[]` apart: "detector never ran" is not "nothing found".
 * * {@link CloseoutBadge} — plan §3.4. `unknown` is not `clean`.
 */

import {
  AlertTriangle,
  CircleHelp,
  FileWarning,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  closeoutExplanation,
  closeoutLabel,
  digestClaim,
  isDeclaredTenant,
  shortDigest,
  tenantSourceExplanation,
  tenantSourceLabel,
  type DigestClaimKind,
} from "./types";

// ───────────────────────── tenant attribution (§3.6) ───────────────────────

/**
 * Per-source chrome. `declared` is the ONLY entry with a solid border and a
 * shield; every other entry is dashed, muted and carries a doubt icon.
 */
const TENANT_CHROME: Record<
  string,
  { className: string; Icon: typeof ShieldCheck }
> = {
  declared: {
    className:
      "border-solid border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    Icon: ShieldCheck,
  },
  derived_repo: {
    className:
      "border-dashed border-amber-500/60 bg-amber-500/5 text-amber-700 dark:text-amber-300",
    Icon: ShieldQuestion,
  },
  derived_sole_binding: {
    className:
      "border-dashed border-amber-500/60 bg-amber-500/5 text-amber-700 dark:text-amber-300",
    Icon: ShieldQuestion,
  },
  ambiguous: {
    className:
      "border-dashed border-orange-600/70 bg-orange-500/10 text-orange-700 dark:text-orange-300",
    Icon: ShieldAlert,
  },
  unknown: {
    className:
      "border-dashed border-border bg-muted/30 text-muted-foreground",
    Icon: CircleHelp,
  },
};

const UNRECOGNISED_TENANT_CHROME = {
  className: "border-dashed border-orange-600/70 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  Icon: ShieldAlert,
};

export function TenantAttributionBadge({
  tenantSource,
  tenantId,
  className,
}: {
  tenantSource: string;
  tenantId: string | null;
  className?: string;
}) {
  const declared = isDeclaredTenant(tenantSource);
  const chrome = TENANT_CHROME[tenantSource] ?? UNRECOGNISED_TENANT_CHROME;
  const { Icon } = chrome;

  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      data-testid="session-tenant-attribution"
      data-tenant-source={tenantSource}
      data-tenant-declared={declared ? "true" : "false"}
    >
      <Badge
        variant="outline"
        className={cn("gap-1 font-medium", chrome.className)}
        title={tenantSourceExplanation(tenantSource)}
      >
        <Icon className="size-3" aria-hidden />
        {tenantSourceLabel(tenantSource)}
      </Badge>
      {tenantId ? (
        declared ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            {tenantId.slice(0, 8)}
          </span>
        ) : (
          // A guessed tenant id never renders as a plain value. The `?` and
          // the italic are the fourth channel: even stripped of colour and
          // icon, the value still reads as a candidate.
          <span
            className="font-mono text-[10px] italic text-muted-foreground/80"
            title="Candidate tenant — this attribution was not declared."
          >
            ?{tenantId.slice(0, 8)}
          </span>
        )
      ) : (
        <span className="text-[10px] text-muted-foreground">no tenant</span>
      )}
    </span>
  );
}

// ───────────────────────── digest / body source (§5) ───────────────────────

const DIGEST_CHROME: Record<DigestClaimKind, string> = {
  verifiable:
    "border-solid border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  unverifiable_redacted:
    "border-dashed border-amber-500/70 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  no_body: "border-dashed border-border bg-muted/30 text-muted-foreground",
  provenance_unknown:
    "border-dashed border-orange-600/70 bg-orange-500/10 text-orange-700 dark:text-orange-300",
};

const DIGEST_ICON: Record<DigestClaimKind, typeof ShieldCheck> = {
  verifiable: ShieldCheck,
  unverifiable_redacted: FileWarning,
  no_body: CircleHelp,
  provenance_unknown: AlertTriangle,
};

export function DigestBadge({
  bodySource,
  contentSha256,
  className,
}: {
  bodySource: string | null;
  contentSha256: string | null;
  className?: string;
}) {
  const claim = digestClaim(bodySource, contentSha256);
  const Icon = DIGEST_ICON[claim.kind];

  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      data-testid="session-digest-claim"
      data-digest-claim={claim.kind}
      data-body-source={bodySource ?? "none"}
    >
      <Badge
        variant="outline"
        className={cn("gap-1 font-medium", DIGEST_CHROME[claim.kind])}
        title={claim.detail}
      >
        <Icon className="size-3" aria-hidden />
        {claim.label}
      </Badge>
      {contentSha256 && (
        <span
          className="font-mono text-[10px] text-muted-foreground"
          title={contentSha256}
        >
          {shortDigest(contentSha256)}
        </span>
      )}
    </span>
  );
}

// ───────────────────────── secret findings (§4.1) ──────────────────────────

/**
 * The audit signal. Three distinct states, and the third is the one that gets
 * collapsed by accident:
 *
 * * `count > 0` — the detector flagged long-lived-credential shapes.
 * * `kinds === []` — it ran and found nothing.
 * * `kinds === null` — it NEVER RAN. Rendering that as "clean" would turn an
 *   un-scanned backfill row into a false assurance.
 */
export function SecretFindingsBadge({
  count,
  kinds,
  className,
}: {
  count: number;
  kinds: string[] | null;
  className?: string;
}) {
  if (kinds === null && count === 0) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "gap-1 border-dashed border-border bg-muted/30 text-muted-foreground",
          className
        )}
        title="The secret detector has never run over this row. This is unknown — NOT 'no findings'."
        data-testid="session-secret-findings"
        data-secret-state="never-scanned"
      >
        <CircleHelp className="size-3" aria-hidden />
        Not scanned
      </Badge>
    );
  }

  if (count === 0) {
    return (
      <Badge
        variant="outline"
        className={cn("gap-1 text-muted-foreground", className)}
        title="The detector ran over this transcript and matched no long-lived-credential shapes."
        data-testid="session-secret-findings"
        data-secret-state="scanned-clean"
      >
        <ScanSearch className="size-3" aria-hidden />
        Scanned, 0 findings
      </Badge>
    );
  }

  const kindList = kinds && kinds.length > 0 ? kinds.join(", ") : "unlisted kinds";
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        className
      )}
      title={`Recorded audit signal — ${kindList}. Nothing is hidden or masked: the archived body is byte-verbatim and this row is no less visible than any other. Bodies are controlled by ACCESS, not by redaction.`}
      data-testid="session-secret-findings"
      data-secret-state="findings"
      data-secret-count={count}
    >
      <ScanSearch className="size-3" aria-hidden />
      {count} secret finding{count === 1 ? "" : "s"}
    </Badge>
  );
}

// ───────────────────────── closeout state (§3.4) ───────────────────────────

const CLOSEOUT_CHROME: Record<string, string> = {
  clean:
    "border-solid border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  unfinished:
    "border-solid border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  unknown: "border-dashed border-border bg-muted/30 text-muted-foreground",
};

export function CloseoutBadge({
  closeoutState,
  className,
}: {
  closeoutState: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1",
        CLOSEOUT_CHROME[closeoutState] ??
          "border-dashed border-border bg-muted/30 text-muted-foreground",
        className
      )}
      title={closeoutExplanation(closeoutState)}
      data-testid="session-closeout-state"
      data-closeout-state={closeoutState}
    >
      {closeoutLabel(closeoutState)}
    </Badge>
  );
}
