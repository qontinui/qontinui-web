"use client";

/**
 * Merge Orchestrator → Settings — per-tenant calibration knobs.
 *
 * Phase 2 D2.4 of the PR Merge Orchestrator
 * (`D:/qontinui-root/plans/2026-05-21-pr-merge-orchestrator-design.md`).
 *
 * Sibling of {@link MergeTrain}. Renders two sections:
 *
 * 1. **Tenant defaults** — the row in `coord.tenant_merge_settings`.
 *    Inline edits PATCH `/api/v1/operations/pr-merge/settings`.
 * 2. **Per-repo overrides** — one card per repo in
 *    `coord.tenant_repos`, with NULL=inherit display + edit per field.
 *    Inline edits PATCH `/api/v1/operations/pr-merge/repos/:repo/profile`.
 *
 * This page is **secondary** to the Phase 8 onboarding flow — most
 * users shouldn't have a reason to visit. The header note makes that
 * obvious; manual edits get stamped `profile_source='user_edit'` so
 * the audit re-run preserves them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  Settings as SettingsIcon,
  Power,
  Activity,
} from "lucide-react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { CoordAdminOnly } from "@/components/admin/coord/CoordAdminOnly";
import { OPERATIONS_API } from "./utils";

const log = createLogger("MergeOrchestrationSettings");

// ----------------------------------------------------------------------------
// Wire types — mirror `qontinui-coord/src/pr_merge/settings.rs` (the resolved
// `EffectiveProfile`) + `settings_wire.rs` (the PATCH bodies).
// ----------------------------------------------------------------------------

// coord's resolved `EffectiveProfile` READS escalate config back as typed
// policies (a glob classified into a hazard category + disposition), NOT as the
// raw `escalate_paths` string[] that the PATCH body WRITES. The read/write
// asymmetry is intentional coord-side: you write raw globs, you read the
// classified result. Mirrors `EscalatePolicy` in
// `qontinui-coord/src/pr_merge/settings.rs`.
type EscalateCategory = "secrets" | "migrations" | "infra" | "other";
type EscalateDisposition =
  | "block_hard"
  | "block_soft"
  | "auto_if_provably_safe";

interface EscalatePolicy {
  glob: string;
  category: EscalateCategory;
  disposition: EscalateDisposition;
}

interface EffectiveProfile {
  tenant_id: string;
  repo: string;
  min_green_dwell: number; // seconds
  confidence_threshold: number;
  auto_merge_enabled: boolean;
  dry_run: boolean;
  rulebook_overrides: Record<string, unknown> | null;
  // The resolved escalate config, read back as typed policies. coord returns
  // `[]` for a default/unconfigured tenant; still guarded with `?? []` at every
  // read site in case a future default omits it. The editor round-trips the
  // `.glob` of each policy against the `escalate_paths` PATCH field on save.
  escalate_policies?: EscalatePolicy[];
  audit_confidence_shadow_floor: number;
  preferred_auditor_device_id: string | null;
  auto_merge_label_budget: number | null;
  framework_signals: string[];
  profile_source: string | null;
  // Red-main auto-remediation Phase 3 (D6) — resolved opt-in for
  // auto-spawning a fix session when this repo's main goes red.
  auto_fix_red_main: boolean;
}

interface TenantSettingsResponse {
  tenant_id: string;
  profile: EffectiveProfile;
}

interface RepoProfileResponse {
  tenant_id: string;
  repo: string;
  profile: EffectiveProfile;
}

interface TenantRepoRow {
  repo: string;
  role: string;
  framework_signals: string[];
  profile_source: string | null;
  profile_version: number | null;
}

interface TenantReposResponse {
  repos: TenantRepoRow[];
  total: number;
}

// ----------------------------------------------------------------------------
// Phase 9 D9.6 — SLO dashboard wire types
// ----------------------------------------------------------------------------

interface SloWindowMetrics {
  auto_merge_success_rate: number | null;
  escalation_rate: number | null;
  post_merge_verification_lag_p95_seconds: number | null;
  author_feedback_latency_p95_seconds: number | null;
  operator_override_rate: number | null;
  shadow_vs_live_agreement_rate: number | null;
  total_decisions: number;
  shadow_decisions: number;
}

interface RepoSlo {
  repo: string;
  current_rollout_state: "dry_run" | "shadow" | "live";
  windows: {
    last_7d: SloWindowMetrics;
    last_30d: SloWindowMetrics;
  };
}

interface KillSwitchHistoryRow {
  fired_at: string;
  scope: string;
  reason: string | null;
  previous_state: string | null;
}

interface SloResponse {
  tenant_id: string;
  repos: RepoSlo[];
  kill_switch_history_last_30d: KillSwitchHistoryRow[];
  generated_at: string;
}

interface KillSwitchResponse {
  scope: string;
  previous_state: string | null;
  new_state: string;
  affected_repos: string[];
}

interface RolloutResponse {
  scope: string;
  state: string;
  affected_repos: string[];
}

// ----------------------------------------------------------------------------
// Tenant defaults card
// ----------------------------------------------------------------------------

function TenantDefaultsCard({
  profile,
  onSaved,
}: {
  profile: EffectiveProfile;
  onSaved: () => void;
}) {
  const [minDwell, setMinDwell] = useState<string>(
    String(profile.min_green_dwell)
  );
  const [confidence, setConfidence] = useState<string>(
    String(profile.confidence_threshold)
  );
  const [autoMerge, setAutoMerge] = useState<boolean>(
    profile.auto_merge_enabled
  );
  const [dryRun, setDryRun] = useState<boolean>(profile.dry_run);
  const [autoFixRedMain, setAutoFixRedMain] = useState<boolean>(
    profile.auto_fix_red_main
  );
  const [escalatePathsText, setEscalatePathsText] = useState<string>(
    (profile.escalate_policies ?? []).map((p) => p.glob).join("\n")
  );
  const [shadowFloor, setShadowFloor] = useState<string>(
    String(profile.audit_confidence_shadow_floor)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync local state when the upstream profile changes
  // (e.g. after the parent re-fetches post-save).
  useEffect(() => {
    setMinDwell(String(profile.min_green_dwell));
    setConfidence(String(profile.confidence_threshold));
    setAutoMerge(profile.auto_merge_enabled);
    setDryRun(profile.dry_run);
    setAutoFixRedMain(profile.auto_fix_red_main);
    setEscalatePathsText(
      (profile.escalate_policies ?? []).map((p) => p.glob).join("\n")
    );
    setShadowFloor(String(profile.audit_confidence_shadow_floor));
  }, [profile]);

  const handleSave = useCallback(async () => {
    setError(null);
    setSaving(true);
    try {
      // Build PATCH body. Each field's PatchField encoding: send the
      // value (= Set), or `null` (= clear to inherit), or omit (= no
      // change). For this dashboard's UX, every editable field is
      // always sent — operator either keeps the previous value
      // (re-sent) or sets a new one. Clearing to inherit happens via
      // a separate "Reset to default" action per-field (not yet
      // wired; the Phase 8 onboarding has the inheritance model).
      const body: Record<string, unknown> = {
        min_green_dwell_secs: parseIntOrThrow("min_green_dwell_secs", minDwell),
        confidence_threshold: parseFloatOrThrow(
          "confidence_threshold",
          confidence
        ),
        auto_merge_enabled: autoMerge,
        dry_run: dryRun,
        auto_fix_red_main: autoFixRedMain,
        audit_confidence_shadow_floor: parseFloatOrThrow(
          "audit_confidence_shadow_floor",
          shadowFloor
        ),
        escalate_paths: escalatePathsText
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      };
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/settings`,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      onSaved();
    } catch (err) {
      log.warn("save tenant settings failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [
    minDwell,
    confidence,
    autoMerge,
    dryRun,
    autoFixRedMain,
    shadowFloor,
    escalatePathsText,
    onSaved,
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SettingsIcon className="h-4 w-4" />
          Tenant defaults
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="min-green-dwell">Min green dwell (s)</Label>
            <Input
              id="min-green-dwell"
              type="number"
              min={0}
              value={minDwell}
              onChange={(e) => setMinDwell(e.target.value)}
              data-testid="settings-min-green-dwell"
            />
            <p className="text-xs text-muted-foreground">
              Seconds CI must stay green before merge-ready.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="confidence-threshold">Confidence threshold</Label>
            <Input
              id="confidence-threshold"
              type="number"
              min={0}
              max={1}
              step="0.01"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
              data-testid="settings-confidence-threshold"
            />
            <p className="text-xs text-muted-foreground">
              Auditor confidence floor (0.00 – 1.00).
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="shadow-floor">Audit shadow floor</Label>
            <Input
              id="shadow-floor"
              type="number"
              min={0}
              max={1}
              step="0.01"
              value={shadowFloor}
              onChange={(e) => setShadowFloor(e.target.value)}
              data-testid="settings-shadow-floor"
            />
            <p className="text-xs text-muted-foreground">
              Lower bound for the audit shadow eval.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <Label htmlFor="auto-merge">Auto-merge enabled</Label>
              <p className="text-xs text-muted-foreground">
                Master kill-switch on the auto-merge path.
              </p>
            </div>
            <Switch
              id="auto-merge"
              checked={autoMerge}
              onCheckedChange={setAutoMerge}
              data-testid="settings-auto-merge"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <Label htmlFor="dry-run">Dry-run mode</Label>
              <p className="text-xs text-muted-foreground">
                Full pipeline, no GitHub mutations.
              </p>
            </div>
            <Switch
              id="dry-run"
              checked={dryRun}
              onCheckedChange={setDryRun}
              data-testid="settings-dry-run"
            />
          </div>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-md border border-amber-500/40 px-3 py-2">
          <div>
            <Label htmlFor="auto-fix-red-main">
              Auto-spawn fix session when main goes red
            </Label>
            <p className="text-xs text-muted-foreground">
              When a repo&apos;s main goes red (a tenant-wide merge outage —
              every green PR is frozen until it&apos;s fixed), coord opens a
              visible terminal session on your device that diagnoses the failing
              check and authors a fix; the fix lands via coord&apos;s audited
              recovery lane. Off by default — turn this on only if you want
              coord to act on its own. Reversible any time; every recovery land
              is audited.
            </p>
          </div>
          <Switch
            id="auto-fix-red-main"
            checked={autoFixRedMain}
            onCheckedChange={setAutoFixRedMain}
            data-testid="settings-auto-fix-red-main"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="escalate-paths">Escalate paths (one per line)</Label>
          <Textarea
            id="escalate-paths"
            value={escalatePathsText}
            onChange={(e) => setEscalatePathsText(e.target.value)}
            placeholder={"alembic/**\nrelease/**"}
            rows={3}
            data-testid="settings-escalate-paths"
          />
          <p className="text-xs text-muted-foreground">
            Globs that auto-escalate any PR touching them.
          </p>
        </div>
        {error && (
          <p className="text-xs text-red-300 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {error}
          </p>
        )}
        <Button
          onClick={handleSave}
          disabled={saving}
          data-testid="settings-save"
        >
          {saving ? "Saving..." : "Save tenant defaults"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Per-repo override card
// ----------------------------------------------------------------------------

function RepoOverrideCard({
  repoRow,
  onSaved,
}: {
  repoRow: TenantRepoRow;
  onSaved: () => void;
}) {
  const [profile, setProfile] = useState<EffectiveProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Local edit state. `""` = inherit (clear/NULL); a numeric/text
  // value = override.
  const [lineBudgetOverride, setLineBudgetOverride] = useState<string>("");
  const [confidenceOverride, setConfidenceOverride] = useState<string>("");
  const [escalatePathsExtraText, setEscalatePathsExtraText] =
    useState<string>("");
  const [labelBudget, setLabelBudget] = useState<string>("");
  const [dryRunOverride, setDryRunOverride] = useState<
    "inherit" | "true" | "false"
  >("inherit");
  const [autoFixRedMainOverride, setAutoFixRedMainOverride] = useState<
    "inherit" | "true" | "false"
  >("inherit");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the resolved profile for THIS repo so the "inherited"
  // values are visible to the operator alongside their overrides.
  // The list-repos response carries framework_signals + provenance,
  // but the layered defaults require an extra fetch per card.
  useEffect(() => {
    let cancelled = false;
    const url = `${OPERATIONS_API}/pr-merge/repos/${repoRow.repo}/profile`;
    httpClient
      .fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as RepoProfileResponse;
      })
      .then((body) => {
        if (cancelled) return;
        setProfile(body.profile);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [repoRow.repo]);

  const handleSave = useCallback(async () => {
    setError(null);
    setSaving(true);
    try {
      // Each field follows the PatchField contract: `null` = clear
      // to inherit, value = set. Empty string in the UI maps to
      // `null` (clear); a parsed value maps to Set.
      const body: Record<string, unknown> = {};
      body.line_budget_override =
        lineBudgetOverride.trim() === ""
          ? null
          : parseIntOrThrow("line_budget_override", lineBudgetOverride);
      body.confidence_threshold_override =
        confidenceOverride.trim() === ""
          ? null
          : parseFloatOrThrow(
              "confidence_threshold_override",
              confidenceOverride
            );
      body.escalate_paths_extra = escalatePathsExtraText
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      body.auto_merge_label_budget =
        labelBudget.trim() === ""
          ? null
          : parseIntOrThrow("auto_merge_label_budget", labelBudget);
      body.dry_run_override =
        dryRunOverride === "inherit" ? null : dryRunOverride === "true";
      body.auto_fix_red_main =
        autoFixRedMainOverride === "inherit"
          ? null
          : autoFixRedMainOverride === "true";

      const url = `${OPERATIONS_API}/pr-merge/repos/${repoRow.repo}/profile`;
      const res = await httpClient.fetch(url, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      onSaved();
    } catch (err) {
      log.warn("save repo profile failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [
    repoRow.repo,
    lineBudgetOverride,
    confidenceOverride,
    escalatePathsExtraText,
    labelBudget,
    dryRunOverride,
    autoFixRedMainOverride,
    onSaved,
  ]);

  return (
    <Card data-testid={`repo-card-${repoRow.repo}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm font-mono">
          <span>{repoRow.repo}</span>
          <div className="flex items-center gap-1">
            {repoRow.role !== "owner" && (
              <Badge variant="outline" className="text-[10px] uppercase">
                {repoRow.role}
              </Badge>
            )}
            {repoRow.profile_source && (
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-wide"
                data-testid={`repo-profile-source-${repoRow.repo}`}
              >
                {repoRow.profile_source}
              </Badge>
            )}
          </div>
        </CardTitle>
        {repoRow.framework_signals.length > 0 && (
          <div className="flex gap-1 flex-wrap mt-1">
            {repoRow.framework_signals.map((s) => (
              <Badge
                key={s}
                variant="secondary"
                className="font-mono text-[10px]"
              >
                {s}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {loadError && (
          <p className="text-xs text-red-300 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {loadError}
          </p>
        )}
        {profile && (
          <p className="text-xs text-muted-foreground">
            Effective: dwell={profile.min_green_dwell}s, dry_run=
            {String(profile.dry_run)}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Line budget override</Label>
            <Input
              type="number"
              min={0}
              value={lineBudgetOverride}
              onChange={(e) => setLineBudgetOverride(e.target.value)}
              placeholder="inherit"
              data-testid={`repo-line-budget-${repoRow.repo}`}
            />
          </div>
          <div className="space-y-1">
            <Label>Confidence override</Label>
            <Input
              type="number"
              min={0}
              max={1}
              step="0.01"
              value={confidenceOverride}
              onChange={(e) => setConfidenceOverride(e.target.value)}
              placeholder="inherit"
              data-testid={`repo-confidence-${repoRow.repo}`}
            />
          </div>
          <div className="space-y-1">
            <Label>Auto-merge label budget</Label>
            <Input
              type="number"
              min={0}
              value={labelBudget}
              onChange={(e) => setLabelBudget(e.target.value)}
              placeholder="inherit"
              data-testid={`repo-label-budget-${repoRow.repo}`}
            />
          </div>
          <div className="space-y-1">
            <Label>Dry-run override</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              value={dryRunOverride}
              onChange={(e) =>
                setDryRunOverride(
                  e.target.value as "inherit" | "true" | "false"
                )
              }
              data-testid={`repo-dry-run-${repoRow.repo}`}
            >
              <option value="inherit">inherit tenant</option>
              <option value="true">true (dry-run)</option>
              <option value="false">false (live)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Auto-fix red main override</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              value={autoFixRedMainOverride}
              onChange={(e) =>
                setAutoFixRedMainOverride(
                  e.target.value as "inherit" | "true" | "false"
                )
              }
              data-testid={`repo-auto-fix-red-main-${repoRow.repo}`}
            >
              <option value="inherit">inherit tenant</option>
              <option value="true">true (auto-spawn fix session)</option>
              <option value="false">false (never auto-spawn)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Per-repo override of the tenant-wide auto-spawn setting. On red
              main, coord opens a visible fix session on your device; the fix
              lands via coord&apos;s audited recovery lane.
            </p>
          </div>
        </div>
        <div className="space-y-1">
          <Label>Escalate paths extra (one per line)</Label>
          <Textarea
            value={escalatePathsExtraText}
            onChange={(e) => setEscalatePathsExtraText(e.target.value)}
            rows={2}
            placeholder={"app/**/page.tsx"}
            data-testid={`repo-escalate-paths-${repoRow.repo}`}
          />
          <p className="text-xs text-muted-foreground">
            UNIONed with the tenant-wide escalate-paths list.
          </p>
        </div>
        {error && (
          <p className="text-xs text-red-300 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {error}
          </p>
        )}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          data-testid={`repo-save-${repoRow.repo}`}
        >
          {saving ? "Saving..." : "Save override"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function parseIntOrThrow(field: string, raw: string): number {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`${field}: not a valid integer`);
  return n;
}

function parseFloatOrThrow(field: string, raw: string): number {
  const n = parseFloat(raw);
  if (Number.isNaN(n)) throw new Error(`${field}: not a valid number`);
  return n;
}

// ----------------------------------------------------------------------------
// Phase 9 D9.4 — Emergency kill-switch button
// ----------------------------------------------------------------------------

/// Single-purpose card: a red "Emergency stop" button that POSTs
/// /pr-merge/kill-switch and surfaces the response. Confirmation modal
/// (browser-native confirm()) guards against accidental clicks — the
/// dashboard's primary UI control for D9.4.
function KillSwitchCard({ onKilled }: { onKilled: () => void }) {
  const [reason, setReason] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<KillSwitchResponse | null>(
    null
  );

  const handleClick = useCallback(async () => {
    setError(null);
    if (reason.trim().length === 0) {
      setError("Reason is required.");
      return;
    }
    // Browser-native confirm() — minimal-dependency confirmation modal.
    // Phase 9 D9.4 calls for "confirmation modal" without specifying
    // the implementation; window.confirm() is the smallest-blast-radius
    // path that meets the surface-before-bypass discipline.
    const ok = window.confirm(
      "Flip rollout_state for the entire tenant to dry_run. " +
        "In-flight merges will drain; new PRs will not auto-merge. " +
        "Proceed?"
    );
    if (!ok) return;
    setSubmitting(true);
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/pr-merge/kill-switch`,
        {
          method: "POST",
          body: JSON.stringify({ scope: "tenant", reason: reason.trim() }),
        }
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${body ? `: ${body}` : ""}`);
      }
      const data = (await res.json()) as KillSwitchResponse;
      setLastResponse(data);
      setReason("");
      onKilled();
    } catch (err) {
      log.warn("kill-switch failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [reason, onKilled]);

  return (
    <Card className="border-red-500/60" data-testid="kill-switch-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-red-300">
          <Power className="h-4 w-4" />
          Emergency stop
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Flip every repo this tenant owns to <code>rollout_state=dry_run</code>
          . In-flight merges drain naturally; the orchestrator stops firing new
          merges immediately. Use when a calibration regression is firing
          unwanted merges. The action is auditable + reversible (re-enable via
          tenant settings above).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="kill-switch-reason">Reason (required)</Label>
          <Input
            id="kill-switch-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. specialist confidence calibration regressed; investigating"
            data-testid="kill-switch-reason"
          />
        </div>
        {error && (
          <p className="text-xs text-red-300 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {error}
          </p>
        )}
        {lastResponse && (
          <p
            className="text-xs text-amber-300"
            data-testid="kill-switch-last-response"
          >
            Kill switch fired — previous_state=
            <code>{lastResponse.previous_state ?? "(null)"}</code>, new_state=
            <code>{lastResponse.new_state}</code>, affected_repos=
            {lastResponse.affected_repos.length}.
          </p>
        )}
        <Button
          variant="destructive"
          onClick={handleClick}
          disabled={submitting}
          data-testid="kill-switch-fire"
        >
          {submitting ? "Firing..." : "Fire kill switch"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Phase 9 D9.6 — SLO Dashboard
// ----------------------------------------------------------------------------

/// Color a metric based on threshold bands (green=good, yellow=warn,
/// red=alarm). The plan's §8 success metrics drive the thresholds.
function ratingColor(
  value: number | null,
  goodAtOrAbove: number,
  warnAtOrAbove: number
): string {
  if (value === null) return "text-muted-foreground";
  if (value >= goodAtOrAbove) return "text-green-400";
  if (value >= warnAtOrAbove) return "text-amber-300";
  return "text-red-300";
}

/// Inverse coloring — lower is better (override rate, escalation rate).
function ratingColorInverse(
  value: number | null,
  goodAtOrBelow: number,
  warnAtOrBelow: number
): string {
  if (value === null) return "text-muted-foreground";
  if (value <= goodAtOrBelow) return "text-green-400";
  if (value <= warnAtOrBelow) return "text-amber-300";
  return "text-red-300";
}

function fmtRate(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function fmtSecs(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}s`;
}

function RolloutStateBadge({ state }: { state: string }) {
  const color =
    state === "live"
      ? "border-green-500/60 text-green-300"
      : state === "shadow"
        ? "border-amber-500/60 text-amber-300"
        : "border-red-500/60 text-red-300";
  return (
    <Badge variant="outline" className={`uppercase tracking-wide ${color}`}>
      {state.replace("_", "-")}
    </Badge>
  );
}

/// Per-repo rollout promote/demote control (Phase 9 D9.4 counterpart to
/// the kill-switch). One button per non-current target state, POSTing
/// /pr-merge/rollout with scope=repo:<repo>. Reason is collected via
/// window.prompt + the flip is guarded by window.confirm — the same
/// minimal-dependency confirmation discipline as KillSwitchCard.
/// Promoting to `live` relies on coord's shadow→live guard (a dry_run
/// repo must pass through shadow first; coord 409s otherwise).
function RolloutStateControl({
  repo,
  current,
  onChanged,
}: {
  repo: string;
  current: RepoSlo["current_rollout_state"];
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setState = useCallback(
    async (target: RepoSlo["current_rollout_state"]) => {
      setError(null);
      const reason = window.prompt(
        `Set ${repo} rollout_state ${current} → ${target}. Reason (required):`
      );
      if (reason === null) return;
      if (reason.trim().length === 0) {
        setError("Reason is required.");
        return;
      }
      if (
        target === "live" &&
        !window.confirm(
          `${repo}: the orchestrator will start pushing REAL merges to main ` +
            "for green, unblocked PRs in this repo. Proceed?"
        )
      ) {
        return;
      }
      setSubmitting(true);
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/pr-merge/rollout`,
          {
            method: "POST",
            body: JSON.stringify({
              scope: `repo:${repo}`,
              state: target,
              reason: reason.trim(),
            }),
          }
        );
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${body ? `: ${body}` : ""}`);
        }
        (await res.json()) as RolloutResponse;
        onChanged();
      } catch (err) {
        log.warn("rollout promote failed", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [repo, current, onChanged]
  );

  const targets: RepoSlo["current_rollout_state"][] = [
    "dry_run",
    "shadow",
    "live",
  ];
  return (
    <div className="pt-1 border-t border-border/40 space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Set state:</span>
        {targets.map((t) => (
          <Button
            key={t}
            size="sm"
            variant={t === "live" ? "default" : "outline"}
            className="h-6 px-2 text-xs"
            disabled={submitting || t === current}
            onClick={() => setState(t)}
            data-testid={`rollout-set-${t}-${repo}`}
          >
            {t.replace("_", "-")}
          </Button>
        ))}
      </div>
      {error && (
        <p className="text-red-300 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}

function SloRepoCard({
  slo,
  onChanged,
}: {
  slo: RepoSlo;
  onChanged: () => void;
}) {
  const w = slo.windows.last_7d;
  const w30 = slo.windows.last_30d;
  return (
    <Card data-testid={`slo-repo-card-${slo.repo}`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-mono">
          <span>{slo.repo}</span>
          <RolloutStateBadge state={slo.current_rollout_state} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-muted-foreground">Auto-merge success</p>
            <p className={ratingColor(w.auto_merge_success_rate, 0.95, 0.85)}>
              {fmtRate(w.auto_merge_success_rate)} (7d)
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Operator override</p>
            <p
              className={ratingColorInverse(
                w.operator_override_rate,
                0.05,
                0.1
              )}
            >
              {fmtRate(w.operator_override_rate)} (7d)
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Escalation</p>
            <p className={ratingColorInverse(w.escalation_rate, 0.1, 0.25)}>
              {fmtRate(w.escalation_rate)} (7d)
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Shadow↔live agree</p>
            <p
              className={ratingColor(
                w.shadow_vs_live_agreement_rate,
                0.95,
                0.85
              )}
            >
              {fmtRate(w.shadow_vs_live_agreement_rate)} (7d)
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Verify lag p95</p>
            <p className="text-foreground">
              {fmtSecs(w.post_merge_verification_lag_p95_seconds)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Author feedback p95</p>
            <p className="text-foreground">
              {fmtSecs(w.author_feedback_latency_p95_seconds)}
            </p>
          </div>
        </div>
        <p className="text-muted-foreground pt-1 border-t border-border/40">
          {w.total_decisions} decision(s) in 7d ({w.shadow_decisions} shadow) /{" "}
          {w30.total_decisions} in 30d ({w30.shadow_decisions} shadow).
        </p>
        <CoordAdminOnly>
          <RolloutStateControl
            repo={slo.repo}
            current={slo.current_rollout_state}
            onChanged={onChanged}
          />
        </CoordAdminOnly>
      </CardContent>
    </Card>
  );
}

function SloDashboardCard({
  data,
  onChanged,
}: {
  data: SloResponse | null;
  onChanged: () => void;
}) {
  if (data === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            SLO Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card data-testid="slo-dashboard-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            SLO Dashboard
          </span>
          <Badge variant="outline" className="font-mono text-xs">
            {data.repos.length} repo(s)
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Per-(tenant, repo) rollout metrics, 7-day windows. Thresholds from
          plan §8: ≥95% auto-merge / ≤5% override / ≥95% shadow agreement before
          promoting from <code>shadow</code> to <code>live</code>.
        </p>
      </CardHeader>
      <CardContent>
        {data.repos.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No repos onboarded yet. Connect a repo via the Onboarding wizard.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {data.repos.map((r) => (
              <SloRepoCard key={r.repo} slo={r} onChanged={onChanged} />
            ))}
          </div>
        )}
        {data.kill_switch_history_last_30d.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border/40">
            <p className="text-xs font-medium mb-2">
              Kill switch history (last 30d)
            </p>
            <ul className="space-y-1 text-xs">
              {data.kill_switch_history_last_30d.slice(0, 5).map((h, i) => (
                <li key={i} className="text-muted-foreground">
                  <span className="font-mono text-foreground">
                    {new Date(h.fired_at).toISOString().slice(0, 19)}Z
                  </span>{" "}
                  — scope=<code>{h.scope}</code>
                  {h.reason && ` — ${h.reason}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Top-level component
// ----------------------------------------------------------------------------

export function MergeOrchestrationSettings() {
  const [profile, setProfile] = useState<EffectiveProfile | null>(null);
  const [repos, setRepos] = useState<TenantRepoRow[] | null>(null);
  const [slo, setSlo] = useState<SloResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      httpClient.fetch(`${OPERATIONS_API}/pr-merge/settings`),
      httpClient.fetch(`${OPERATIONS_API}/pr-merge/repos`),
      httpClient.fetch(`${OPERATIONS_API}/pr-merge/slo`),
    ])
      .then(async ([s, r, sl]) => {
        if (!s.ok) throw new Error(`settings: HTTP ${s.status}`);
        if (!r.ok) throw new Error(`repos: HTTP ${r.status}`);
        // SLO is best-effort — a failure (e.g. coord down) shouldn't
        // block the rest of the page from rendering.
        const sb = (await s.json()) as TenantSettingsResponse;
        const rb = (await r.json()) as TenantReposResponse;
        if (cancelled) return;
        setProfile(sb.profile);
        setRepos(rb.repos);
        setError(null);
        if (sl.ok) {
          const slBody = (await sl.json()) as SloResponse;
          if (!cancelled) setSlo(slBody);
        } else {
          // Log but don't propagate to top-level error banner — the
          // SLO card surfaces its own loading state.
          log.warn("slo fetch failed", await sl.text().catch(() => "?"));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadCounter]);

  const triggerReload = useCallback(() => {
    setReloadCounter((c) => c + 1);
  }, []);

  const subtitle = useMemo(
    () =>
      "Settings are managed automatically by the Repo Audit + Drift loop. Manual edits are saved with profile_source='user_edit' and are preserved when the audit re-runs.",
    []
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <SettingsIcon className="h-5 w-5" />
            Merge Orchestrator → Settings
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        </CardHeader>
      </Card>
      {error && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-red-300 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {error}
            </p>
          </CardContent>
        </Card>
      )}
      {/* Phase 9 D9.4 — Emergency kill switch (red border, prominent).
          Admin-only mutation control. */}
      <CoordAdminOnly>
        <KillSwitchCard onKilled={triggerReload} />
      </CoordAdminOnly>
      {/* Phase 9 D9.6 — SLO Dashboard. Read-only metrics render for all
          members; the embedded rollout promote control is itself gated. */}
      <SloDashboardCard data={slo} onChanged={triggerReload} />
      {/* Tenant defaults + per-repo overrides are tenant-config writes —
          admin only. */}
      <CoordAdminOnly>
        {profile === null ? (
          <Card>
            <CardContent className="pt-4">
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ) : (
          <TenantDefaultsCard profile={profile} onSaved={triggerReload} />
        )}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>Per-repo overrides</span>
              {repos !== null && (
                <Badge variant="outline" className="font-mono text-xs">
                  {repos.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {repos === null ? (
              <Skeleton className="h-24 w-full" />
            ) : repos.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No repos registered. Repos auto-register on first PATCH of their
                per-repo override.
              </p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {repos.map((r) => (
                  <RepoOverrideCard
                    key={r.repo}
                    repoRow={r}
                    onSaved={triggerReload}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </CoordAdminOnly>
    </div>
  );
}
