"use client";

// =============================================================================
// PR Merge Orchestrator Phase 8 D8.0 + D8.3 -- Onboarding wizard.
//
// Three-step wizard:
//   1. Pair a device (calls /coord/devices/pair-start + polls pair-complete).
//   2. Sign into Claude Code on the device (polls precondition-status).
//   3. Audit the first repo (POST /pr-merge/onboarding/audit + STARTER_PROFILE
//      cards with per-item Accept / Edit / Reject + final accept POST).
//
// Per plan D8.0: step 3 is HIDDEN if precondition returns ready=false; the
// dashboard displays "Pair a device to enable PR-merge automation."
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import { OPERATIONS_API } from "./utils";

const log = createLogger("MergeOrchestrationOnboarding");

const PRECONDITION_POLL_MS = 5_000;

// Poll cadence + client-side cap for the async repo audit (coord dispatches
// the auditor + returns 202; the wizard polls audit-status for the
// STARTER_PROFILE write-back). The cap is NON-FATAL — the agent may still
// finish after we stop polling (the repo is already enrolled at dispatch),
// so on exceed we surface a soft "taking longer than usual" message rather
// than an error.
const AUDIT_POLL_MS = 4_000;
const AUDIT_POLL_CAP_MS = 8 * 60_000;

// ----------------------------------------------------------------------------
// Wire types (mirrors coord's pr_merge::onboarding_routes shapes)
// ----------------------------------------------------------------------------

interface PreconditionStatus {
  paired: boolean;
  claude_code_available: boolean;
  ready: boolean;
}

interface PairStartResponse {
  state: string;
  redirect_url: string;
  expires_in: number;
}

interface EscalatePathEntry {
  path: string;
  reason: string;
  memory_citation: string | null;
}

interface StarterProfile {
  framework_signals?: string[];
  escalate_paths?: (string | EscalatePathEntry)[];
  line_budget?: number;
  line_budget_rationale?: string;
  min_green_dwell_secs?: number;
  confidence_threshold?: number;
  auto_merge_enabled_for?: string[];
  tag_push_on_version_bump?: boolean;
  rulebook_addendum?: string;
  audit_confidence?: number;
  audit_notes?: string;
}

interface AuditResponse {
  agent_id: string;
  repo: string;
  starter_profile: StarterProfile;
  audit_confidence: number | null;
  // Legacy synchronous-path field. The async status response no longer
  // carries it (the latency is a process-local Instant in coord, lost across
  // the stateless poll), so it's optional and the cards guard its render.
  audit_latency_secs?: number;
}

// Response of GET /pr-merge/onboarding/audit-status (the async poll). Mirrors
// coord's stateless status wrapper over poll_starter_profile_once.
interface AuditStatusResponse {
  status: "running" | "ready" | "failed";
  agent_id: string;
  starter_profile?: StarterProfile;
  audit_confidence?: number;
  error?: string;
}

// ----------------------------------------------------------------------------
// Step 1 — Pair a device
// ----------------------------------------------------------------------------

function PairDeviceStep({
  onPaired,
}: {
  onPaired: () => void;
}) {
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startPairing = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // The pair-start body needs callback_url, web_pair_url, and
      // device_hostname per src/routes_phase3.rs::PairStartRequest. The
      // dashboard wizard provides reasonable defaults — operators can
      // run the matching `qontinui_profile device pair` on their host.
      const body = {
        callback_url: "http://localhost:9876/pair-callback",
        device_hostname: "operator-workstation",
        web_pair_url: `${window.location.origin}/operations/pair-runner`,
      };
      const res = await httpClient.fetch(`${OPERATIONS_API}/coord/devices/pair-start`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ""}`);
      }
      const data = (await res.json()) as PairStartResponse;
      setPairCode(data.state);
      setRedirectUrl(data.redirect_url);
    } catch (err) {
      log.warn("pair-start failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Pair a device running the Qontinui runner with Claude Code installed.
        On your device, run <code>qontinui_profile device pair</code> and paste
        the pair code below.
      </p>
      {error && (
        <p className="text-xs text-red-300 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> {error}
        </p>
      )}
      {!pairCode ? (
        <Button onClick={startPairing} disabled={busy} size="sm">
          {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          Start pairing
        </Button>
      ) : (
        <div className="space-y-2">
          <Label className="text-xs">Pair code (valid for 5 minutes)</Label>
          <code
            className="block px-3 py-2 bg-muted rounded text-sm font-mono select-all"
            data-pair-code={pairCode}
          >
            {pairCode}
          </code>
          {redirectUrl && (
            <p className="text-xs text-muted-foreground">
              Or open{" "}
              <a
                href={redirectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                this URL
              </a>{" "}
              on the device&apos;s browser to complete pairing.
            </p>
          )}
          <Button onClick={onPaired} variant="outline" size="sm">
            I&apos;ve completed pairing
          </Button>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Step 2 — Sign into Claude Code (poll precondition)
// ----------------------------------------------------------------------------

function ClaudeCodeStep({
  status,
  onReady,
}: {
  status: PreconditionStatus | null;
  onReady: () => void;
}) {
  // Auto-advance when ready.
  useEffect(() => {
    if (status?.ready) {
      onReady();
    }
  }, [status, onReady]);

  return (
    <div className="space-y-3">
      <p className="text-sm">
        On the paired device, run <code>claude --version</code> to confirm
        Claude Code is installed and signed in. The runner self-probes every
        60s and reports availability to coord.
      </p>
      <div className="flex items-center gap-3 text-xs">
        <div className="flex items-center gap-1">
          {status?.paired ? (
            <CheckCircle2 className="h-3 w-3 text-green-400" />
          ) : (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
          <span data-testid="paired-indicator">
            Device paired:{" "}
            <span className="font-mono">
              {status?.paired ? "yes" : "waiting"}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          {status?.claude_code_available ? (
            <CheckCircle2 className="h-3 w-3 text-green-400" />
          ) : (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
          <span data-testid="claude-code-indicator">
            Claude Code:{" "}
            <span className="font-mono">
              {status?.claude_code_available ? "available" : "waiting"}
            </span>
          </span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Polling every 5s. Step 3 unlocks when both indicators are green.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Step 3 — Audit a repo + accept the starter profile
// ----------------------------------------------------------------------------

interface AuditStepProps {
  ready: boolean;
}

function escalateString(e: string | EscalatePathEntry): string {
  if (typeof e === "string") return e;
  return e.path;
}

function AuditStep({ ready }: AuditStepProps) {
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<AuditResponse | null>(null);
  const [editedProfile, setEditedProfile] = useState<StarterProfile | null>(
    null
  );
  // The async audit's agent_id, set from the 202 response. While set (and no
  // auditResult yet) the poll useEffect runs, GETting audit-status every ~4s.
  const [auditAgentId, setAuditAgentId] = useState<string | null>(null);
  const [acceptBusy, setAcceptBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const runAudit = useCallback(async () => {
    if (!repo.trim()) {
      setError("Enter a repo in owner/name form.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The audit is now async: coord dispatches the auditor + returns 202
      // {agent_id, repo, status:"running"} immediately. The POST is fast, so
      // the default client-side timeout is correct — the slow audit work
      // happens off-connection and we poll audit-status for the result.
      const res = await httpClient.fetch(`${OPERATIONS_API}/pr-merge/onboarding/audit`, {
        method: "POST",
        body: JSON.stringify({ repo: repo.trim() }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          const body = await res.json().catch(() => ({} as Record<string, unknown>));
          if ((body as { next_step?: string }).next_step === "pair_device") {
            setError(
              "No audit-capable device. Complete step 1 (pair) and step 2 (sign into Claude Code) first."
            );
            return;
          }
        }
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const data = (await res.json()) as Partial<AuditResponse> & {
        agent_id?: string;
        status?: string;
      };
      // Defensive: if a synchronous 200 with a profile ever comes back (legacy
      // coord), use it directly — not the primary path.
      if (res.status === 200 && data.starter_profile) {
        setAuditResult(data as AuditResponse);
        setEditedProfile(data.starter_profile);
        return;
      }
      // Primary path: 202 {agent_id, repo, status:"running"}. Store the
      // agent_id (the poll useEffect takes over) and keep the spinner busy.
      if (data.agent_id) {
        setAuditAgentId(data.agent_id);
      } else {
        throw new Error("audit dispatch returned no agent_id");
      }
    } catch (err) {
      log.warn("audit failed", err);
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
    // NOTE: busy stays true on the 202 path — the poll useEffect clears it
    // when a terminal status (ready/failed) or the cap lands.
  }, [repo]);

  // Poll the async audit status while an agent_id is in flight and no result
  // has landed. Mirrors the top-level precondition pollStatus pattern, with a
  // client-side cap so a never-completing audit degrades to a soft message
  // instead of spinning forever.
  useEffect(() => {
    if (!auditAgentId || auditResult) return;
    let cancelled = false;
    const startedAt = Date.now();

    const poll = async () => {
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/pr-merge/onboarding/audit-status?agent_id=${encodeURIComponent(
            auditAgentId
          )}`
        );
        if (cancelled) return;
        if (!res.ok) {
          // Transient proxy/coord hiccup — keep polling rather than fail.
          log.warn("audit-status poll non-ok", res.status);
          return;
        }
        const data = (await res.json()) as AuditStatusResponse;
        if (cancelled) return;
        if (data.status === "ready" && data.starter_profile) {
          setAuditResult({
            agent_id: data.agent_id,
            repo,
            starter_profile: data.starter_profile,
            audit_confidence: data.audit_confidence ?? null,
          });
          setEditedProfile(data.starter_profile);
          setAuditAgentId(null);
          setBusy(false);
        } else if (data.status === "failed") {
          setError(data.error ?? "Audit failed on the device.");
          setAuditAgentId(null);
          setBusy(false);
        }
        // status === "running" → keep polling.
      } catch (err) {
        if (cancelled) return;
        // Network blip — keep polling; the cap will eventually stop us.
        log.warn("audit-status poll error", err);
      }
    };

    poll();
    const id = setInterval(() => {
      if (Date.now() - startedAt > AUDIT_POLL_CAP_MS) {
        clearInterval(id);
        if (cancelled) return;
        setError(
          "Audit is taking longer than usual; it may still finish — retry or check the device."
        );
        setAuditAgentId(null);
        setBusy(false);
        return;
      }
      poll();
    }, AUDIT_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [auditAgentId, auditResult, repo]);

  const acceptProfile = useCallback(async () => {
    if (!auditResult || !editedProfile) return;
    setAcceptBusy(true);
    setError(null);
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/onboarding/accept`,
        {
          method: "POST",
          body: JSON.stringify({
            repo: auditResult.repo,
            profile: editedProfile,
          }),
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      setAccepted(true);
    } catch (err) {
      log.warn("accept failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcceptBusy(false);
    }
  }, [auditResult, editedProfile]);

  const removeEscalatePath = useCallback(
    (idx: number) => {
      if (!editedProfile) return;
      const next = { ...editedProfile };
      next.escalate_paths = (editedProfile.escalate_paths ?? []).filter(
        (_, i) => i !== idx
      );
      setEditedProfile(next);
    },
    [editedProfile]
  );

  const updateLineBudget = useCallback(
    (v: string) => {
      if (!editedProfile) return;
      const n = Number.parseInt(v, 10);
      if (Number.isNaN(n)) return;
      setEditedProfile({ ...editedProfile, line_budget: n });
    },
    [editedProfile]
  );

  if (!ready) {
    return (
      <p className="text-sm text-muted-foreground">
        Complete steps 1 + 2 first to enable repo audit.
      </p>
    );
  }

  if (accepted) {
    return (
      <div className="space-y-2">
        <p className="text-sm flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-green-400" />
          Profile saved for <code className="font-mono">{auditResult?.repo}</code>.
        </p>
        <p className="text-xs text-muted-foreground">
          The orchestrator now uses this profile when evaluating PRs in
          that repo. Use the &ldquo;Merge Orchestrator → Settings&rdquo; page to edit
          later, or accept drift suggestions in the Suggestions inbox as
          coord learns from your overrides.
        </p>
      </div>
    );
  }

  if (!auditResult || !editedProfile) {
    return (
      <div className="space-y-2">
        <Label htmlFor="repo-input" className="text-xs">
          Repo to audit (owner/name)
        </Label>
        <div className="flex gap-2">
          <Input
            id="repo-input"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="qontinui/qontinui-coord"
            disabled={busy}
            className="font-mono text-sm"
          />
          <Button onClick={runAudit} disabled={busy} size="sm">
            {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            {busy ? "Auditing…" : "Audit"}
          </Button>
        </div>
        {busy && auditAgentId && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Auditing on your device —
            this can take a few minutes. You can leave this open.
          </p>
        )}
        {error && (
          <p className="text-xs text-red-300 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> {error}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          The auditor inspects your repo&apos;s framework, CI workflows, recent PR
          distribution, and branch protection. It runs on your paired device
          using your Claude Code subscription — Qontinui spends zero compute.
        </p>
      </div>
    );
  }

  // STARTER_PROFILE cards.
  const confidence = auditResult.audit_confidence ?? 0;
  return (
    <div className="space-y-3" data-testid="starter-profile-cards">
      <div className="flex items-center gap-2 text-xs">
        <CheckCircle2 className="h-3 w-3 text-green-400" />
        <span>
          Audit complete
          {auditResult.audit_latency_secs !== undefined && (
            <>
              {" in "}
              <span className="font-mono">
                {auditResult.audit_latency_secs.toFixed(1)}s
              </span>
            </>
          )}
        </span>
        <Badge
          variant={confidence >= 0.85 ? "default" : "outline"}
          className="font-mono ml-2"
        >
          confidence {confidence.toFixed(2)}
        </Badge>
      </div>

      <div className="border border-border rounded-md p-3 space-y-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide">
          Framework signals
        </h5>
        <div className="flex flex-wrap gap-1">
          {(editedProfile.framework_signals ?? []).map((sig) => (
            <Badge key={sig} variant="outline" className="font-mono text-[10px]">
              {sig}
            </Badge>
          ))}
          {(editedProfile.framework_signals ?? []).length === 0 && (
            <span className="text-xs text-muted-foreground">
              No frameworks detected.
            </span>
          )}
        </div>
      </div>

      <div className="border border-border rounded-md p-3 space-y-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide">
          Escalate paths
        </h5>
        {(editedProfile.escalate_paths ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground">None.</p>
        )}
        {(editedProfile.escalate_paths ?? []).map((p, idx) => {
          const path = escalateString(p);
          const reason = typeof p === "string" ? "" : p.reason;
          const cite = typeof p === "string" ? null : p.memory_citation;
          return (
            <div
              key={`${path}-${idx}`}
              className="flex items-start gap-2 text-xs"
              data-escalate-path={path}
            >
              <Badge variant="outline" className="font-mono">
                {path}
              </Badge>
              <div className="flex-1">
                {reason && <p className="text-muted-foreground">{reason}</p>}
                {cite && (
                  <p className="text-[10px] text-muted-foreground font-mono">
                    cite: {cite}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeEscalatePath(idx)}
              >
                Remove
              </Button>
            </div>
          );
        })}
      </div>

      <div className="border border-border rounded-md p-3 space-y-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide">
          Line budget
        </h5>
        <div className="flex gap-2 items-center">
          <Input
            type="number"
            value={editedProfile.line_budget ?? 500}
            onChange={(e) => updateLineBudget(e.target.value)}
            className="w-24 font-mono"
          />
          <span className="text-xs text-muted-foreground">lines</span>
        </div>
        {editedProfile.line_budget_rationale && (
          <p className="text-[11px] text-muted-foreground">
            {editedProfile.line_budget_rationale}
          </p>
        )}
      </div>

      {editedProfile.rulebook_addendum && (
        <div className="border border-border rounded-md p-3 space-y-2">
          <h5 className="text-xs font-semibold uppercase tracking-wide">
            Rulebook addendum
          </h5>
          <Textarea
            value={editedProfile.rulebook_addendum}
            onChange={(e) =>
              setEditedProfile({
                ...editedProfile,
                rulebook_addendum: e.target.value,
              })
            }
            rows={3}
            className="font-mono text-xs"
          />
        </div>
      )}

      {error && (
        <p className="text-xs text-red-300 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={acceptProfile} disabled={acceptBusy} size="sm">
          {acceptBusy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          Accept &amp; save
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setAuditResult(null);
            setEditedProfile(null);
          }}
          size="sm"
        >
          Discard &amp; retry
        </Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Top-level wizard
// ----------------------------------------------------------------------------

export function MergeOrchestrationOnboarding() {
  const [status, setStatus] = useState<PreconditionStatus | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pollErr, setPollErr] = useState<string | null>(null);

  const pollStatus = useCallback(async () => {
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/onboarding/precondition-status`
      );
      if (!res.ok) {
        if (res.status === 404) {
          // Coord doesn't have the Phase 8 endpoint yet — degrade
          // gracefully. The wizard is still usable; step 3 will 404
          // its own audit call.
          setStatus({
            paired: false,
            claude_code_available: false,
            ready: false,
          });
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as PreconditionStatus;
      setStatus(data);
      setPollErr(null);
    } catch (err) {
      log.warn("precondition poll failed", err);
      setPollErr(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    pollStatus();
    const id = setInterval(pollStatus, PRECONDITION_POLL_MS);
    return () => clearInterval(id);
  }, [pollStatus]);

  // Auto-advance the step indicator. Operators can navigate back via
  // the step badges below.
  const computedStep = useMemo(() => {
    if (status?.ready) return 3;
    if (status?.paired) return 2;
    return 1;
  }, [status]);
  useEffect(() => {
    setStep(computedStep);
  }, [computedStep]);

  return (
    <Card className="mb-4" data-testid="merge-onboarding-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Merge Orchestrator onboarding</CardTitle>
      </CardHeader>
      <CardContent>
        {pollErr && (
          <p className="text-xs text-red-300 mb-3 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> {pollErr}
          </p>
        )}
        <div className="flex gap-2 mb-4">
          <StepBadge n={1} active={step === 1} done={step > 1}>
            Pair device
          </StepBadge>
          <StepBadge n={2} active={step === 2} done={step > 2}>
            Sign into Claude Code
          </StepBadge>
          <StepBadge n={3} active={step === 3} done={false}>
            Audit first repo
          </StepBadge>
        </div>
        {/* Steps 1 + 2 (pair your own device, sign into Claude Code) are
            available to all tenant members — a Developer pairs their own
            runner. Step 3 (repo audit) WRITES coord.tenant_repos, a
            tenant-config action, so it is admin-gated. */}
        {step === 1 && <PairDeviceStep onPaired={() => pollStatus()} />}
        {step === 2 && (
          <ClaudeCodeStep status={status} onReady={() => setStep(3)} />
        )}
        {step === 3 && (
          <CoordAdminOnly
            fallback={
              <ReadOnlyNotice label="Repo onboarding (the audit + accept step) is administrator only. Your device is paired and ready." />
            }
          >
            <AuditStep ready={status?.ready ?? false} />
          </CoordAdminOnly>
        )}
      </CardContent>
    </Card>
  );
}

function StepBadge({
  n,
  active,
  done,
  children,
}: {
  n: number;
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  let tint = "bg-muted text-muted-foreground border-border";
  if (done) tint = "bg-green-500/15 text-green-200 border-green-500/30";
  if (active) tint = "bg-blue-500/15 text-blue-200 border-blue-500/30";
  return (
    <div
      className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs ${tint}`}
      data-step={n}
      data-step-active={active}
      data-step-done={done}
    >
      <span className="font-mono">{n}</span>
      <span>{children}</span>
    </div>
  );
}
