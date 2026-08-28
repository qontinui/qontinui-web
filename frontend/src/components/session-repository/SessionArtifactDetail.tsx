"use client";

/**
 * One archived session, in full.
 *
 * Composition, top to bottom, in the order an operator uses it:
 *
 * 1. **Identity + the three honesty chips** — attribution, digest claim,
 *    closeout. Stated before anything else, because each one qualifies
 *    everything below it.
 * 2. **Provenance** — the fields a relaunch is reconstructed from.
 * 3. **Transcript** — paged (`TurnsPane`), never the whole body.
 * 4. **Archived body** — the digest's actual meaning and the verbatim export.
 * 5. **Run this session again** — relaunch vs transfer, with the §3.5 tiers.
 * 6. **Live in coord** — the SHIPPED `TranscriptPane` and `ResumePanel`,
 *    rendered only while coord still holds this session.
 *
 * Section 6 is real reuse rather than a copy: for a session coord has not yet
 * GC'd, the live transcript stream and the shipped handoff-based "Resume
 * here…" flow are exactly right, and reimplementing them here would fork two
 * surfaces over one coord session. It is also clearly labelled as a DIFFERENT
 * copy of the transcript — coord's is redacted on the way in and disappears 7
 * days after close, which is the whole reason this archive exists.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { relativeTime } from "@/components/operations/utils";
import { ResumePanel } from "@/components/sessions/ResumePanel";
import { TranscriptPane } from "@/components/sessions/TranscriptPane";
import {
  CloseoutBadge,
  DigestBadge,
  SecretFindingsBadge,
  TenantAttributionBadge,
} from "./HonestyBadges";
import { BodyPanel } from "./BodyPanel";
import { RelaunchPanel } from "./RelaunchPanel";
import { TurnsPane } from "./TurnsPane";
import { getSessionArtifact, SessionRepositoryApiError } from "./api";
import {
  displayName,
  displayNameSource,
  tenantSourceExplanation,
  type SessionArtifactDetailResponse,
} from "./types";

type DetailState =
  | { phase: "loading" }
  | { phase: "unauthorized" }
  | { phase: "not-found" }
  | { phase: "error"; message: string }
  | { phase: "ready"; artifact: SessionArtifactDetailResponse };

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all font-mono">
        {value ?? <span className="font-sans italic">not recorded</span>}
      </dd>
    </div>
  );
}

export function SessionArtifactDetail({ artifactId }: { artifactId: string }) {
  const [state, setState] = useState<DetailState>({ phase: "loading" });

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const artifact = await getSessionArtifact(artifactId);
      setState({ phase: "ready", artifact });
    } catch (err) {
      if (err instanceof SessionRepositoryApiError) {
        if (err.status === 401 || err.status === 403) {
          setState({ phase: "unauthorized" });
          return;
        }
        if (err.status === 404) {
          setState({ phase: "not-found" });
          return;
        }
      }
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "failed to load",
      });
    }
  }, [artifactId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === "loading") {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state.phase === "unauthorized" || state.phase === "not-found") {
    return (
      <div
        className="space-y-3 rounded-lg border border-dashed border-border py-10 text-center"
        data-testid="session-detail-unavailable"
      >
        <p className="text-sm text-muted-foreground">
          {state.phase === "unauthorized"
            ? "You are not authorized to read this archived session."
            : "No archived session with that id. It may belong to another tenant, or it may never have been archived — this is unknown, not proof it never existed."}
        </p>
        <Link href="/sessions/repository">
          <Button variant="outline" size="sm">
            <ArrowLeft className="size-4" />
            Back to the repository
          </Button>
        </Link>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div
        className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-4"
        data-testid="session-detail-error"
      >
        <p className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Couldn&apos;t load this session: {state.message}. Nothing is shown
          below — that is unknown, not empty.
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="size-4" />
          Retry
        </Button>
      </div>
    );
  }

  const artifact = state.artifact;
  const hasBody =
    artifact.content_sha256 !== null || artifact.body_object_key !== null;
  const coordSessionId = artifact.coord_session_id;

  return (
    <div
      className="space-y-5"
      data-testid="session-repository-detail"
      data-session-artifact-id={artifact.id}
      data-tenant-source={artifact.tenant_source}
      data-body-source={artifact.body_source ?? "none"}
    >
      {/* ── 1. Identity + the three honesty chips ─────────────────────── */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Bot className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <h2 className="text-base font-semibold">{displayName(artifact)}</h2>
          <span className="text-[11px] text-muted-foreground">
            (name from: {displayNameSource(artifact)})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" data-testid="session-detail-state">
            {artifact.state}
          </Badge>
          <CloseoutBadge closeoutState={artifact.closeout_state} />
          <TenantAttributionBadge
            tenantSource={artifact.tenant_source}
            tenantId={artifact.tenant_id}
          />
          <DigestBadge
            bodySource={artifact.body_source}
            contentSha256={artifact.content_sha256}
          />
          <SecretFindingsBadge
            count={artifact.secret_finding_count}
            kinds={artifact.secret_finding_kinds}
          />
        </div>

        {/* The attribution explained in words on the page, not only on hover
            — a guessed tenant must be legible without discovery. */}
        <p
          className="max-w-3xl text-xs text-muted-foreground"
          data-testid="session-detail-tenant-explanation"
        >
          {tenantSourceExplanation(artifact.tenant_source)}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono" title={artifact.claude_session_id}>
            {artifact.claude_session_id}
          </span>
          <span>
            started{" "}
            {artifact.started_at
              ? relativeTime(artifact.started_at)
              : "at an unrecorded time"}
          </span>
          <span>
            last active{" "}
            {artifact.last_activity_at
              ? relativeTime(artifact.last_activity_at)
              : "— not recorded"}
          </span>
          <span>
            {artifact.ended_at
              ? `ended ${relativeTime(artifact.ended_at)}`
              : "no end recorded"}
          </span>
        </div>
      </header>

      <Separator />

      {/* ── 2. Provenance ─────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Provenance</h3>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-1 text-xs sm:grid-cols-2">
          <Field label="Account home" value={artifact.account_label} />
          <Field label="Machine" value={artifact.machine_hostname ?? artifact.machine_id} />
          <Field label="Repo" value={artifact.repo} />
          <Field label="Branch" value={artifact.git_branch} />
          <Field label="Working dir" value={artifact.working_dir} />
          <Field label="Config dir" value={artifact.config_dir} />
          <Field label="Provider" value={artifact.provider} />
          <Field label="Permission mode" value={artifact.permission_mode} />
          <Field label="Work unit" value={artifact.work_unit_slug} />
          <Field label="Task run" value={artifact.task_run_id} />
        </dl>
        <p className="text-[11px] text-muted-foreground">
          The coord links above are soft and may dangle: coord deletes a closed
          session&apos;s rows after 7 days, which is why this archive exists. A
          missing link is normal, not an error.
        </p>
      </section>

      <Separator />

      {/* ── 3. Transcript (paged) ─────────────────────────────────────── */}
      <TurnsPane
        artifactId={artifact.id}
        expectedTurns={artifact.turn_count}
        hasBody={hasBody}
      />

      <Separator />

      {/* ── 4. Body + export ──────────────────────────────────────────── */}
      <BodyPanel
        artifact={artifact}
        serverDigestVerifiable={artifact.digest_verifiable}
      />

      <Separator />

      {/* ── 5. Relaunch / transfer ────────────────────────────────────── */}
      <RelaunchPanel artifact={artifact} />

      {/* ── 6. The live coord view, while it still exists ─────────────── */}
      {coordSessionId && (
        <>
          <Separator />
          <section className="space-y-3" data-testid="session-detail-coord">
            <div>
              <h3 className="text-sm font-semibold">
                Still live in the coordination layer
              </h3>
              <p className="max-w-3xl text-xs text-muted-foreground">
                Coord still holds a row for this session, so the shipped live
                surfaces work on it. Two things this view is not: coord&apos;s
                transcript stream is <strong>redacted</strong> on the way in
                and is a different copy from the archived body above, and its
                rows are deleted 7 days after the session closes. Prefer the
                archive for anything you need to keep.
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                <Link
                  href={`/sessions/${coordSessionId}`}
                  className="underline underline-offset-2"
                >
                  Open the live session page
                </Link>
              </p>
            </div>
            <ResumePanel
              sessionId={coordSessionId}
              sessionClosed={artifact.state !== "open"}
              currentDeviceId={artifact.device_id}
            />
            <TranscriptPane
              sessionId={coordSessionId}
              sessionClosed={artifact.state !== "open"}
            />
          </section>
        </>
      )}
    </div>
  );
}
