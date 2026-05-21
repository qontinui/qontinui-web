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
import { AlertTriangle, Settings as SettingsIcon } from "lucide-react";
import { createLogger } from "@/lib/logger";
import { OPERATIONS_API } from "./utils";

const log = createLogger("MergeOrchestrationSettings");

// ----------------------------------------------------------------------------
// Wire types — mirror `qontinui-coord/src/pr_merge/settings_wire.rs`.
// ----------------------------------------------------------------------------

interface EffectiveProfile {
  tenant_id: string;
  repo: string;
  line_budget: number;
  min_green_dwell: number; // seconds
  confidence_threshold: number;
  auto_merge_enabled: boolean;
  dry_run: boolean;
  rulebook_overrides: Record<string, unknown> | null;
  escalate_paths: string[];
  audit_confidence_shadow_floor: number;
  preferred_auditor_device_id: string | null;
  auto_merge_label_budget: number | null;
  framework_signals: string[];
  profile_source: string | null;
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
// Tenant defaults card
// ----------------------------------------------------------------------------

function TenantDefaultsCard({
  profile,
  onSaved,
}: {
  profile: EffectiveProfile;
  onSaved: () => void;
}) {
  const [lineBudget, setLineBudget] = useState<string>(String(profile.line_budget));
  const [minDwell, setMinDwell] = useState<string>(String(profile.min_green_dwell));
  const [confidence, setConfidence] = useState<string>(String(profile.confidence_threshold));
  const [autoMerge, setAutoMerge] = useState<boolean>(profile.auto_merge_enabled);
  const [dryRun, setDryRun] = useState<boolean>(profile.dry_run);
  const [escalatePathsText, setEscalatePathsText] = useState<string>(
    profile.escalate_paths.join("\n")
  );
  const [shadowFloor, setShadowFloor] = useState<string>(
    String(profile.audit_confidence_shadow_floor)
  );
  const [rulebookText, setRulebookText] = useState<string>(
    profile.rulebook_overrides ? JSON.stringify(profile.rulebook_overrides, null, 2) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync local state when the upstream profile changes
  // (e.g. after the parent re-fetches post-save).
  useEffect(() => {
    setLineBudget(String(profile.line_budget));
    setMinDwell(String(profile.min_green_dwell));
    setConfidence(String(profile.confidence_threshold));
    setAutoMerge(profile.auto_merge_enabled);
    setDryRun(profile.dry_run);
    setEscalatePathsText(profile.escalate_paths.join("\n"));
    setShadowFloor(String(profile.audit_confidence_shadow_floor));
    setRulebookText(
      profile.rulebook_overrides ? JSON.stringify(profile.rulebook_overrides, null, 2) : ""
    );
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
        line_budget: parseIntOrThrow("line_budget", lineBudget),
        min_green_dwell_secs: parseIntOrThrow("min_green_dwell_secs", minDwell),
        confidence_threshold: parseFloatOrThrow("confidence_threshold", confidence),
        auto_merge_enabled: autoMerge,
        dry_run: dryRun,
        audit_confidence_shadow_floor: parseFloatOrThrow(
          "audit_confidence_shadow_floor",
          shadowFloor
        ),
        escalate_paths: escalatePathsText
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      };
      const trimmedRulebook = rulebookText.trim();
      if (trimmedRulebook.length > 0) {
        try {
          body.rulebook_overrides = JSON.parse(trimmedRulebook);
        } catch (e) {
          throw new Error(
            `rulebook_overrides must be valid JSON: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      } else {
        body.rulebook_overrides = null;
      }
      const res = await fetch(`${OPERATIONS_API}/pr-merge/settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
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
    lineBudget,
    minDwell,
    confidence,
    autoMerge,
    dryRun,
    shadowFloor,
    escalatePathsText,
    rulebookText,
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
            <Label htmlFor="line-budget">Line budget</Label>
            <Input
              id="line-budget"
              type="number"
              min={0}
              value={lineBudget}
              onChange={(e) => setLineBudget(e.target.value)}
              data-testid="settings-line-budget"
            />
            <p className="text-xs text-muted-foreground">
              Max changed lines before auto-escalation.
            </p>
          </div>
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
        <div className="space-y-1">
          <Label htmlFor="rulebook-overrides">Rulebook overrides (JSON)</Label>
          <Textarea
            id="rulebook-overrides"
            value={rulebookText}
            onChange={(e) => setRulebookText(e.target.value)}
            placeholder="{}"
            rows={4}
            data-testid="settings-rulebook-overrides"
          />
          <p className="text-xs text-muted-foreground">
            Free-form addendum injected into the auditor specialist
            prompt. Blank = no addendum.
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
  const [escalatePathsExtraText, setEscalatePathsExtraText] = useState<string>("");
  const [labelBudget, setLabelBudget] = useState<string>("");
  const [dryRunOverride, setDryRunOverride] = useState<"inherit" | "true" | "false">("inherit");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the resolved profile for THIS repo so the "inherited"
  // values are visible to the operator alongside their overrides.
  // The list-repos response carries framework_signals + provenance,
  // but the layered defaults require an extra fetch per card.
  useEffect(() => {
    let cancelled = false;
    const url = `${OPERATIONS_API}/pr-merge/repos/${repoRow.repo}/profile`;
    fetch(url, { credentials: "include" })
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
      body.line_budget_override = lineBudgetOverride.trim() === ""
        ? null
        : parseIntOrThrow("line_budget_override", lineBudgetOverride);
      body.confidence_threshold_override = confidenceOverride.trim() === ""
        ? null
        : parseFloatOrThrow("confidence_threshold_override", confidenceOverride);
      body.escalate_paths_extra = escalatePathsExtraText
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      body.auto_merge_label_budget = labelBudget.trim() === ""
        ? null
        : parseIntOrThrow("auto_merge_label_budget", labelBudget);
      body.dry_run_override =
        dryRunOverride === "inherit" ? null : dryRunOverride === "true";

      const url = `${OPERATIONS_API}/pr-merge/repos/${repoRow.repo}/profile`;
      const res = await fetch(url, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
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
              <Badge key={s} variant="secondary" className="font-mono text-[10px]">
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
            Effective: line_budget={profile.line_budget}, dwell=
            {profile.min_green_dwell}s, dry_run={String(profile.dry_run)}
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
                setDryRunOverride(e.target.value as "inherit" | "true" | "false")
              }
              data-testid={`repo-dry-run-${repoRow.repo}`}
            >
              <option value="inherit">inherit tenant</option>
              <option value="true">true (dry-run)</option>
              <option value="false">false (live)</option>
            </select>
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
// Top-level component
// ----------------------------------------------------------------------------

export function MergeOrchestrationSettings() {
  const [profile, setProfile] = useState<EffectiveProfile | null>(null);
  const [repos, setRepos] = useState<TenantRepoRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${OPERATIONS_API}/pr-merge/settings`, { credentials: "include" }),
      fetch(`${OPERATIONS_API}/pr-merge/repos`, { credentials: "include" }),
    ])
      .then(async ([s, r]) => {
        if (!s.ok) throw new Error(`settings: HTTP ${s.status}`);
        if (!r.ok) throw new Error(`repos: HTTP ${r.status}`);
        const sb = (await s.json()) as TenantSettingsResponse;
        const rb = (await r.json()) as TenantReposResponse;
        if (cancelled) return;
        setProfile(sb.profile);
        setRepos(rb.repos);
        setError(null);
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
              No repos registered. Repos auto-register on first PATCH of
              their per-repo override.
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
    </div>
  );
}
