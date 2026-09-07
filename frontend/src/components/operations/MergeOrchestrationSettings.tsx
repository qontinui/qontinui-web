"use client";

/**
 * Merge Orchestrator → Settings — per-tenant calibration knobs.
 *
 * Phase 2 D2.4 of the PR Merge Orchestrator
 * (`D:/qontinui-root/plans/2026-05-21-pr-merge-orchestrator-design.md`).
 *
 * Sibling of {@link MergePipeline}. Renders two sections:
 *
 * 1. **Tenant defaults** — the row in `coord.tenant_merge_settings`.
 *    Inline edits PATCH `/api/v1/operations/pr-merge/settings`.
 * 2. **Per-repo overrides** — one card per repo in
 *    `coord.tenant_repos`, with NULL=inherit display + edit per field.
 *    Inline edits PATCH `/api/v1/operations/pr-merge/repos/:repo/profile`.
 *
 * Merge enablement is a BOOLEAN (`merge_enabled`), not the retired
 * `rollout_state` tri-state, and it is written through the audited
 * `POST /pr-merge/merge-enabled` route rather than either PATCH. Every
 * control that renders it also renders whether the value is PINNED at that
 * scope or inherited — coord serves `merge_enabled_override` (the raw pin)
 * beside the resolved boolean precisely so this page can stop guessing.
 *
 * This page is a **calibration** surface, secondary to the Phase 8 onboarding
 * flow — most users shouldn't have a reason to visit. The emergency stop is
 * not here; it lives on the fleet page's merge-train view, which is the
 * surface an operator is actually on during an incident.
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
  Activity,
} from "lucide-react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { CoordAdminOnly } from "@/components/admin/coord/CoordAdminOnly";
import { OPERATIONS_API } from "./utils";
import type { MergeEnabledResponse } from "./mergeTypes";

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
  // The RESOLVED merge-enablement boolean — per-repo pin, else the tenant
  // value, else coord's `true` default, with the tenant-wide `merge_paused`
  // latch dominating all of it. Writes go through
  // POST /pr-merge/merge-enabled (never the settings PATCH).
  //
  // Resolved-only: it cannot tell you whether this repo is PINNED or merely
  // inheriting. That distinction lives in `merge_enabled_override` on the
  // per-repo reads below, and rendering only this field is exactly the bug
  // that made a whole fleet's pinned state invisible from this dashboard.
  merge_enabled: boolean;
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
  // ff-land head-ref sync (plan
  // `2026-08-26-coord-ff-land-records-merged-on-github`, Phase 1) — resolved
  // opt-in for updating the PR's head ref to the rebased tip as part of the
  // land, so GitHub records the PR as **Merged** instead of grey Closed.
  //
  // OPTIONAL, and the `?` is load-bearing — see `ffLandHeadSyncSupported`.
  ff_land_head_sync_enabled?: boolean;
}

/**
 * Whether the coord build behind this dashboard carries the ff-land head-sync
 * dial on its **settings wire** — i.e. whether the controls below may write it.
 *
 * The storage and the wire landed apart, and the gap is still open:
 * `qontinui-web#1092` added the two nullable BOOLEAN columns
 * (`coord.tenant_merge_settings.ff_land_head_sync_enabled` and
 * `coord.tenant_repo_profiles.ff_land_head_sync_enabled`), and
 * `qontinui-coord#1660` added the RESOLVER that reads them — but neither added
 * the field to `PatchTenantSettings` / `PatchRepoProfile` or to the
 * `EffectiveProfile` those routes serve. So for now the columns have **no
 * writer anywhere in the fleet** and this dial can only be set by hand-SQL.
 *
 * That is why this probe exists rather than an unconditional send, and why it
 * is a probe on the READ shape. Both PATCH structs carry
 * `#[serde(deny_unknown_fields)]` (`qontinui-coord/crates/coord/src/pr_merge/
 * settings_wire.rs`), so posting a field coord does not know **400s the entire
 * save** — every other field on the card with it, not just this dial. The
 * `line_budget_override` note in `RepoOverrideCard.handleSave` is the same trap,
 * already paid for once.
 *
 * The probe is the field's PRESENCE in the profile coord serves back, because a
 * coord build that serves it is by construction one that accepts it: the two
 * halves live in the same struct pair, and the sibling dial `auto_fix_red_main`
 * shipped them together. Until such a build is deployed the controls render
 * disabled and say why, and the moment one is, they go live with no further
 * change here.
 */
function ffLandHeadSyncSupported(profile: EffectiveProfile | null): boolean {
  return typeof profile?.ff_land_head_sync_enabled === "boolean";
}

interface TenantSettingsResponse {
  tenant_id: string;
  profile: EffectiveProfile;
}

interface RepoProfileResponse {
  tenant_id: string;
  repo: string;
  profile: EffectiveProfile;
  // The RAW per-repo pin, alongside the resolved `profile.merge_enabled`:
  //   true  → pinned on
  //   false → pinned off
  //   null  → not pinned; this repo inherits
  //
  // Declared because it is part of this response and a reader needs to know
  // the pin is available here. The per-repo card nonetheless reads the pin off
  // the repo-LIST row (same value, refreshed after every save), because this
  // read is issued once per mount and would go stale — see RepoOverrideCard.
  merge_enabled_override: boolean | null;
}

interface TenantRepoRow {
  repo: string;
  role: string;
  framework_signals: string[];
  profile_source: string | null;
  profile_version: number | null;
  /** Resolved merge enablement for this repo. */
  merge_enabled: boolean;
  /** Raw per-repo pin; `null` = inheriting. */
  merge_enabled_override: boolean | null;
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
  total_decisions: number;
}

interface RepoSlo {
  repo: string;
  /** RESOLVED merge enablement (pin → tenant → default `true`, with the
   *  tenant-wide pause dominating). */
  merge_enabled: boolean;
  /** RAW per-repo pin: `true`/`false` = pinned, `null` = inheriting. */
  merge_enabled_override: boolean | null;
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

// `MergeEnabledResponse` (mergeTypes.ts) is the shared body of both
// `POST /pr-merge/merge-enabled` and `POST /pr-merge/kill-switch`.

// ----------------------------------------------------------------------------
// Tenant merge pause — a LATCH, not a default
// ----------------------------------------------------------------------------

/**
 * The tenant-wide merge pause.
 *
 * **This is the emergency stop wearing a settings-page hat, so it is guarded
 * like one.** coord has no tenant-tier `merge_enabled` column: a tenant-scoped
 * write sets `tenant_merge_settings.merge_paused`, and that latch DOMINATES
 * every per-repo pin by construction. Turning this off therefore stops the
 * entire fleet — including repos an operator has deliberately pinned ON — so
 * it gets the same discipline as `EmergencyStopControl` on the merge-train
 * view: an operator-typed reason, a confirm that names the real blast radius,
 * and no batching into the "Save tenant defaults" button. A latch that fires
 * as a side effect of saving a dwell-time edit is precisely the surprise this
 * plan exists to remove.
 *
 * The OFF direction goes through `/pr-merge/kill-switch`, not
 * `/pr-merge/merge-enabled`, even though both write the same latch: only the
 * kill-switch path writes the `coord.alerts(kind='kill_switch_fired')` row.
 * Two doors to one destructive effect, one of them silent, is how a fleet gets
 * paused with nothing in the audit trail to explain it. The ON direction lifts
 * the latch through the merge-enabled route, which is the non-destructive
 * direction and needs no alert.
 */
function TenantMergePauseControl({
  paused,
  onChanged,
}: {
  paused: boolean;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flip = useCallback(
    async (nextEnabled: boolean) => {
      setError(null);
      const reason = window.prompt(
        nextEnabled
          ? "Lift the tenant-wide merge pause. Reason (required):"
          : "Pause merges for EVERY repo this tenant owns. Reason (required):"
      );
      if (reason === null) return;
      if (reason.trim().length === 0) {
        setError("Reason is required.");
        return;
      }
      const ok = window.confirm(
        nextEnabled
          ? "Lift the tenant-wide pause. Repos pinned OFF stay off; every " +
              "other repo resumes merging as soon as its PRs are green. " +
              "Proceed?"
          : "Pause merges for EVERY repo this tenant owns — INCLUDING repos " +
              "pinned ON, because the tenant pause overrides every per-repo " +
              "setting. In-flight merges drain; nothing new is pushed " +
              "anywhere. Proceed?"
      );
      if (!ok) return;
      setSubmitting(true);
      try {
        // OFF → the audited kill-switch door (writes the alert row).
        // ON  → the merge-enabled door, clearing the latch.
        const res = await httpClient.fetch(
          nextEnabled
            ? `${OPERATIONS_API}/pr-merge/merge-enabled`
            : `${OPERATIONS_API}/pr-merge/kill-switch`,
          {
            method: "POST",
            body: JSON.stringify(
              nextEnabled
                ? { scope: "tenant", enabled: true, reason: reason.trim() }
                : { scope: "tenant", reason: reason.trim() }
            ),
          }
        );
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
        }
        (await res.json()) as MergeEnabledResponse;
        onChanged();
      } catch (err) {
        log.warn("tenant merge pause flip failed", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [onChanged]
  );

  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 ${
        paused ? "border-red-500/60" : ""
      }`}
      data-testid="settings-tenant-pause"
    >
      <div>
        <Label htmlFor="tenant-merge-pause">Merges enabled tenant-wide</Label>
        <p className="text-xs text-muted-foreground">
          A <strong>pause latch</strong>, not a default. Switching it off stops
          merges on <strong>every repo this tenant owns</strong>, including
          repos pinned on — the pause overrides every per-repo setting.
          Switching it back on only lifts the pause: unpinned repos then follow
          coord&apos;s built-in default and pinned repos keep their pin. Both
          directions need a reason and are audited.
        </p>
        {error && (
          <p className="text-xs text-red-300 flex items-center gap-1 mt-1">
            <AlertTriangle className="h-3 w-3" />
            {error}
          </p>
        )}
      </div>
      <Switch
        id="tenant-merge-pause"
        checked={!paused}
        disabled={submitting}
        onCheckedChange={(next) => void flip(next)}
        data-testid="settings-merge-enabled"
      />
    </div>
  );
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
  const [autoFixRedMain, setAutoFixRedMain] = useState<boolean>(
    profile.auto_fix_red_main
  );
  // `?? false` is the RESOLVED default, not a placeholder: coord's
  // `Defaults::FF_LAND_HEAD_SYNC_ENABLED` is `false`, so a build that does not
  // serve the field is a build on which the dial is off. Rendering OFF there is
  // the true answer; what the operator must not be told is that they can CHANGE
  // it, which `ffLandHeadSyncSupported` handles.
  const [ffLandHeadSync, setFfLandHeadSync] = useState<boolean>(
    profile.ff_land_head_sync_enabled ?? false
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
    setAutoFixRedMain(profile.auto_fix_red_main);
    setFfLandHeadSync(profile.ff_land_head_sync_enabled ?? false);
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
      // Conditional, unlike every sibling above it. `PatchTenantSettings` is
      // `deny_unknown_fields`, and this body is sent on EVERY save — so an
      // unconditional key here would 400 the whole tenant-defaults save on any
      // coord build that has not yet grown the field, taking dwell, confidence,
      // auto-merge and the escalate paths down with it.
      if (ffLandHeadSyncSupported(profile)) {
        body.ff_land_head_sync_enabled = ffLandHeadSync;
      }
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
    autoFixRedMain,
    ffLandHeadSync,
    profile,
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
        {/* Full width, and NOT inside the two-up grid with the ordinary
            toggles: this one latches the whole fleet, and sitting it beside a
            calibration switch is what made it read as one. It also acts on
            flip rather than on Save — see TenantMergePauseControl. */}
        <TenantMergePauseControl
          paused={!profile.merge_enabled}
          onChanged={onSaved}
        />
        <div className="flex items-start justify-between gap-3 rounded-md border border-amber-500/40 px-3 py-2">
          <div>
            <Label htmlFor="auto-fix-red-main">
              Auto-spawn fix session when main goes red
            </Label>
            <p className="text-xs text-muted-foreground">
              When a repo&apos;s main goes red (a tenant-wide merge outage —
              every green PR is frozen until it&apos;s fixed), coord consults
              its red-main-fix policy and, where that policy is graduated and
              the fleet flag is armed, opens a visible terminal session on your
              device that diagnoses the failing check and authors a fix; the fix
              lands via coord&apos;s audited recovery lane. On by default — turn
              this off to opt this repo out. Reversible any time; every recovery
              land is audited.
            </p>
          </div>
          <Switch
            id="auto-fix-red-main"
            checked={autoFixRedMain}
            onCheckedChange={setAutoFixRedMain}
            data-testid="settings-auto-fix-red-main"
          />
        </div>
        <div className="flex items-start justify-between gap-3 rounded-md border px-3 py-2">
          <div>
            <Label htmlFor="ff-land-head-sync">
              Record coord&apos;s lands as Merged on GitHub
            </Label>
            <p className="text-xs text-muted-foreground">
              coord lands a PR by rebasing its commits onto the base branch and
              pushing them straight there. When the rebase rewrites the shas —
              69.4% of lands, measured over the 90 days to 2026-08-26 — the PR&apos;s
              head ref is left behind, so GitHub shows grey{" "}
              <span className="font-mono">Closed</span> on work that demonstrably
              landed. With this on, coord also moves the head ref to the rebased
              tip, and GitHub marks the PR{" "}
              <span className="font-mono">Merged</span> by itself. Off by default
              — it is a force-update on a branch coord does not own, so it is
              graduated per repo below rather than flipped fleet-wide.
            </p>
            {!ffLandHeadSyncSupported(profile) && (
              <p
                className="text-xs text-amber-400 mt-1"
                data-testid="settings-ff-land-head-sync-unsupported"
              >
                Not settable on this coord build: the columns exist
                (qontinui-web#1092) and coord&apos;s resolver reads them
                (qontinui-coord#1660), but the settings API does not carry the
                field yet, so there is no writer for it. Shown here so the dial
                is discoverable, and it goes live by itself once coord serves it.
              </p>
            )}
          </div>
          <Switch
            id="ff-land-head-sync"
            checked={ffLandHeadSync}
            onCheckedChange={setFfLandHeadSync}
            disabled={!ffLandHeadSyncSupported(profile)}
            data-testid="settings-ff-land-head-sync"
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
  tenantPaused,
  ffLandHeadSyncWritable,
  onSaved,
}: {
  repoRow: TenantRepoRow;
  tenantPaused: boolean;
  /**
   * Whether coord's settings wire carries `ff_land_head_sync_enabled` — see
   * {@link ffLandHeadSyncSupported}.
   *
   * Threaded down from the TENANT profile rather than probed off this card's
   * own `repoProfile` fetch, deliberately: the capability is a property of the
   * coord BUILD, not of the repo, so deriving it per card would give one answer
   * per in-flight fetch and leave the control briefly enabled-then-disabled on
   * every mount. One read, one answer, every card.
   */
  ffLandHeadSyncWritable: boolean;
  onSaved: () => void;
}) {
  const [repoProfile, setRepoProfile] = useState<RepoProfileResponse | null>(
    null
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  // What coord currently STORES for this repo's merge-enablement pin, and what
  // it currently RESOLVES to — both straight off the repo-list row.
  //
  // Deliberately NOT off the per-repo profile fetch, even though that read
  // carries the same two fields: the fetch is keyed on the repo name and so
  // never re-runs for a card that stays mounted, whereas the parent re-reads
  // `/pr-merge/repos` after every save. Reading the pin from the fetch would
  // leave the control showing the PRE-save pin — the same class of lie this
  // change exists to remove, just one release later.
  const storedPin: PinChoice = pinChoice(repoRow.merge_enabled_override);
  const resolvedMergeEnabled = repoRow.merge_enabled;

  // Local edit state. `""` = leave unchanged; a value = override.
  // Most of this card is still WRITE-ONLY: coord's RepoProfileResponse returns
  // the RESOLVED profile for the numeric/glob fields, not the raw per-repo
  // overrides, so there is nothing to preload those from. To avoid clobbering
  // overrides the operator did NOT touch, we track which fields were edited
  // (`dirty`) and PATCH only those — an omitted field is left unchanged by
  // coord's PatchField(absent). Full visibility/preload of the remaining
  // overrides needs a coord API addition (dev-notes plan
  // 2026-07-22-merge-settings-repo-override-preload, Option A).
  //
  // Merge enablement is the EXCEPTION and no longer write-only: coord serves
  // `merge_enabled_override` (the raw pin) beside `profile.merge_enabled` (the
  // resolved value), so that control below renders what is actually stored.
  const [confidenceOverride, setConfidenceOverride] = useState<string>("");
  const [escalatePathsExtraText, setEscalatePathsExtraText] =
    useState<string>("");
  const [labelBudget, setLabelBudget] = useState<string>("");
  // The pin as the operator has it staged. Starts at whatever is stored, so
  // the rendered control and the database agree until someone changes it —
  // and "changed" is exactly `mergePin !== storedPin`.
  const [mergePin, setMergePin] = useState<PinChoice>(storedPin);
  // Re-sync when coord's stored pin moves under us (this card's own save, or
  // another operator's). Keyed on the stored value, so an operator's staged
  // edit survives an unrelated parent re-render.
  useEffect(() => {
    setMergePin(storedPin);
  }, [storedPin]);
  const [autoFixRedMainOverride, setAutoFixRedMainOverride] = useState<
    "inherit" | "true" | "false"
  >("inherit");
  // Write-only like its siblings above (coord serves the RESOLVED profile, not
  // the raw per-repo override), so it starts at "inherit" — which is also the
  // stored default, every column being NULL until someone graduates a repo.
  const [ffLandHeadSyncOverride, setFfLandHeadSyncOverride] = useState<
    "inherit" | "true" | "false"
  >("inherit");
  // Body keys the operator has edited this session; only these are PATCHed.
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const markDirty = useCallback((field: string) => {
    setDirty((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  }, []);

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
        setRepoProfile(body);
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
      // Send ONLY fields the operator edited. coord's PatchRepoProfile treats
      // an absent field as "leave unchanged", so omitting untouched fields
      // avoids resetting/wiping overrides the operator never touched. A sent
      // field follows the PatchField contract: a value = Set, `null` = clear
      // to inherit. NOTE: coord's PatchRepoProfile does NOT accept
      // `line_budget_override` — sending it trips `deny_unknown_fields` and
      // 400s the whole PATCH — so that field is not sent (and its input was
      // removed; coord neither stores nor resolves a per-repo line budget).
      const body: Record<string, unknown> = {};
      if (dirty.has("confidence_threshold_override")) {
        body.confidence_threshold_override =
          confidenceOverride.trim() === ""
            ? null
            : parseFloatOrThrow(
                "confidence_threshold_override",
                confidenceOverride
              );
      }
      if (dirty.has("escalate_paths_extra")) {
        body.escalate_paths_extra = escalatePathsExtraText
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
      if (dirty.has("auto_merge_label_budget")) {
        body.auto_merge_label_budget =
          labelBudget.trim() === ""
            ? null
            : parseIntOrThrow("auto_merge_label_budget", labelBudget);
      }
      if (dirty.has("auto_fix_red_main")) {
        body.auto_fix_red_main =
          autoFixRedMainOverride === "inherit"
            ? null
            : autoFixRedMainOverride === "true";
      }
      // Guarded on the capability as well as on `dirty`: the control is
      // disabled without it, so this can only be reached by a stale `dirty`
      // entry, and `deny_unknown_fields` would 400 the whole PATCH.
      if (ffLandHeadSyncWritable && dirty.has("ff_land_head_sync_enabled")) {
        body.ff_land_head_sync_enabled =
          ffLandHeadSyncOverride === "inherit"
            ? null
            : ffLandHeadSyncOverride === "true";
      }

      // Skip the PATCH entirely when no profile field changed (e.g. a
      // merge-enablement-only save) — an empty body is a wasted round-trip and
      // needlessly couples the enablement POST to the PATCH succeeding.
      if (Object.keys(body).length > 0) {
        const url = `${OPERATIONS_API}/pr-merge/repos/${repoRow.repo}/profile`;
        const res = await httpClient.fetch(url, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      }
      // Merge enablement is NOT a profile-PATCH field — it POSTs the audited
      // merge-enabled route with a repo scope. Unlike every other field on
      // this card it is not tracked by `dirty`: the control renders the STORED
      // pin, so "the operator changed it" is exactly `mergePin !== storedPin`.
      // All three values write, including `null` — clearing a pin back to
      // inherit is a real action here, not a no-op placeholder.
      if (mergePin !== storedPin) {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/pr-merge/merge-enabled`,
          {
            method: "POST",
            body: JSON.stringify({
              scope: `repo:${repoRow.repo}`,
              enabled: pinValue(mergePin),
              reason: "dashboard: per-repo override save",
            }),
          }
        );
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(
            `merge-enabled: HTTP ${res.status}${detail ? `: ${detail}` : ""}`
          );
        }
      }
      setDirty(new Set());
      onSaved();
    } catch (err) {
      log.warn("save repo profile failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [
    repoRow.repo,
    dirty,
    confidenceOverride,
    escalatePathsExtraText,
    labelBudget,
    mergePin,
    storedPin,
    autoFixRedMainOverride,
    ffLandHeadSyncOverride,
    ffLandHeadSyncWritable,
    onSaved,
  ]);

  return (
    <Card data-testid={`repo-card-${repoRow.repo}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm font-mono">
          <span>{repoRow.repo}</span>
          <div className="flex items-center gap-1">
            <MergeEnabledBadge
              enabled={resolvedMergeEnabled}
              pin={storedPin}
              tenantPaused={tenantPaused}
              testId={`repo-merge-enabled-badge-${repoRow.repo}`}
            />
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
        {repoProfile && (
          // Merge posture deliberately NOT repeated here. This read is issued
          // once per mount (dep array `[repoRow.repo]`), so a posture rendered
          // from it would freeze at its pre-save value and then contradict the
          // badge above — two answers on one card, which is the bug this
          // change exists to kill. The badge is the single place it is stated.
          <p className="text-xs text-muted-foreground">
            Effective: dwell={repoProfile.profile.min_green_dwell}s
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Confidence override</Label>
            <Input
              type="number"
              min={0}
              max={1}
              step="0.01"
              value={confidenceOverride}
              onChange={(e) => {
                setConfidenceOverride(e.target.value);
                markDirty("confidence_threshold_override");
              }}
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
              onChange={(e) => {
                setLabelBudget(e.target.value);
                markDirty("auto_merge_label_budget");
              }}
              placeholder="inherit"
              data-testid={`repo-label-budget-${repoRow.repo}`}
            />
          </div>
          <div className="space-y-1">
            <Label>Merge enabled override</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              value={mergePin}
              onChange={(e) => setMergePin(e.target.value as PinChoice)}
              data-testid={`repo-merge-enabled-${repoRow.repo}`}
            >
              <option value="inherit">
                inherit tenant (currently{" "}
                {resolvedMergeEnabled ? "enabled" : "paused"})
              </option>
              <option value="true">pin on (merges enabled)</option>
              <option value="false">pin off (merges paused)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {pinSentence(storedPin, resolvedMergeEnabled, tenantPaused)} Saved
              via the audited merge-enabled route. Choosing &quot;inherit
              tenant&quot; CLEARS the pin, so this repo follows the tenant
              default again.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Auto-fix red main override</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              value={autoFixRedMainOverride}
              onChange={(e) => {
                setAutoFixRedMainOverride(
                  e.target.value as "inherit" | "true" | "false"
                );
                markDirty("auto_fix_red_main");
              }}
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
          <div className="space-y-1">
            <Label>Merged-on-GitHub override</Label>
            <select
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              value={ffLandHeadSyncOverride}
              disabled={!ffLandHeadSyncWritable}
              onChange={(e) => {
                setFfLandHeadSyncOverride(
                  e.target.value as "inherit" | "true" | "false"
                );
                markDirty("ff_land_head_sync_enabled");
              }}
              data-testid={`repo-ff-land-head-sync-${repoRow.repo}`}
            >
              <option value="inherit">inherit tenant</option>
              <option value="true">true (sync the head ref on a land)</option>
              <option value="false">false (leave the head ref behind)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {ffLandHeadSyncWritable
                ? "This is the per-repo graduation knob: turn it on for one repo, watch a window of lands, then move to the next. The benefit is very uneven per repo — 87.0% of qontinui-runner's lands rewrite shas against 9.7% of ui-bridge's — which is why it is graduated here and not tenant-wide."
                : "Not settable on this coord build — coord's settings API does not carry the field yet, so nothing can write it. See the tenant switch above."}
            </p>
          </div>
        </div>
        <div className="space-y-1">
          <Label>Escalate paths extra (one per line)</Label>
          <Textarea
            value={escalatePathsExtraText}
            onChange={(e) => {
              setEscalatePathsExtraText(e.target.value);
              markDirty("escalate_paths_extra");
            }}
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
// Merge-enablement: pinned vs inherited
// ----------------------------------------------------------------------------
//
// coord stores a per-repo `merge_enabled_override` that is `true`, `false`, or
// `null`, and separately RESOLVES `merge_enabled` from it. Those are two
// different facts and this dashboard used to render only the second one, so
// every per-repo control read "inherit" no matter what was actually pinned —
// a switch whose position did not match the database.
//
// `PinChoice` is the raw pin as a form value; the resolved boolean is always
// carried alongside it, never in place of it.

type PinChoice = "inherit" | "true" | "false";

/** Wire pin (`true` | `false` | `null`) → form value. */
function pinChoice(override: boolean | null | undefined): PinChoice {
  if (override === true) return "true";
  if (override === false) return "false";
  return "inherit";
}

/** Form value → wire pin. `null` is the clear-to-inherit form. */
function pinValue(choice: PinChoice): boolean | null {
  if (choice === "true") return true;
  if (choice === "false") return false;
  return null;
}

/**
 * One sentence stating what is STORED and what it currently resolves to.
 *
 * Inheriting is reported as inheriting — never silently as its resolved value
 * — because "off because this repo is pinned off" and "off because the tenant
 * is paused" call for different fixes.
 *
 * The pinned arms state the resolved value too **whenever it disagrees with
 * the pin**, which is exactly when the operator most needs to be told. A repo
 * pinned ON under a tenant-wide pause resolves OFF: saying only "Pinned ON"
 * there would let an operator who just stopped the fleet read the page as
 * confirmation that it is still running.
 */
function pinSentence(
  pin: PinChoice,
  resolved: boolean,
  tenantPaused = false
): string {
  if (pin === "inherit") {
    return `Not pinned — inheriting, and currently ${
      resolved ? "enabled" : "paused"
    }.`;
  }
  const pinned = pin === "true";
  if (pinned === resolved) {
    return pinned ? "Pinned ON for this repo." : "Pinned OFF for this repo.";
  }
  // Pin and reality disagree. Name the cause when we can prove it (the tenant
  // pause is the only tier that outranks a pin); otherwise say only what is
  // observed rather than guessing at a reason.
  const because = tenantPaused ? " because the tenant is paused" : "";
  return pinned
    ? `Pinned ON — but merges are OFF here${because}.`
    : `Pinned OFF — but merges currently resolve ON${because}.`;
}

/**
 * The resolved merge posture, with the pin's provenance on it.
 *
 * Green/red is the resolved answer to "will this repo merge?"; the dashed
 * outline and the "inherited" word are the answer to "is that pinned here, or
 * is it just what the tier above says today?".
 */
function MergeEnabledBadge({
  enabled,
  pin,
  tenantPaused = false,
  testId,
}: {
  enabled: boolean;
  pin: PinChoice;
  tenantPaused?: boolean;
  testId?: string;
}) {
  const inherited = pin === "inherit";
  const color = enabled
    ? "border-green-500/60 text-green-300"
    : "border-red-500/60 text-red-300";
  return (
    <Badge
      variant="outline"
      className={`uppercase tracking-wide ${color} ${
        inherited ? "border-dashed" : ""
      }`}
      title={pinSentence(pin, enabled, tenantPaused)}
      data-testid={testId}
      data-pin={pin}
    >
      {enabled ? "merges on" : "merges off"}
      <span className="ml-1 normal-case opacity-70">
        {inherited ? "· inherited" : "· pinned"}
      </span>
    </Badge>
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
// Phase 9 D9.6 — SLO Dashboard
// ----------------------------------------------------------------------------

/// Color a metric based on threshold bands (green=good, yellow=warn,
/// red=alarm). The plan's §8 success metrics drive the thresholds.
function ratingColor(
  value: number | null,
  goodAtOrAbove: number,
  warnAtOrAbove: number
): string {
  if (value == null) return "text-muted-foreground";
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
  if (value == null) return "text-muted-foreground";
  if (value <= goodAtOrBelow) return "text-green-400";
  if (value <= warnAtOrBelow) return "text-amber-300";
  return "text-red-300";
}

function fmtRate(value: number | null): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function fmtSecs(value: number | null): string {
  if (value == null) return "—";
  return `${value.toFixed(1)}s`;
}

/**
 * Per-repo merge-enablement control: one switch, plus a clear-the-pin action.
 *
 * The switch position is the PIN when there is one and the resolved value when
 * there is not, and the line under it always says which of those you are
 * looking at — an operator flipping this must never be surprised about what
 * they were flipping FROM.
 *
 * Reason is collected via window.prompt and enabling is guarded by
 * window.confirm — the same minimal-dependency confirmation discipline the
 * emergency stop uses.
 */
function MergeEnabledControl({
  repo,
  resolved,
  pin,
  tenantPaused = false,
  onChanged,
}: {
  repo: string;
  resolved: boolean;
  pin: PinChoice;
  tenantPaused?: boolean;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const write = useCallback(
    async (enabled: boolean | null, promptLabel: string) => {
      setError(null);
      const reason = window.prompt(
        `${repo}: ${promptLabel} Reason (required):`
      );
      if (reason === null) return;
      if (reason.trim().length === 0) {
        setError("Reason is required.");
        return;
      }
      if (
        enabled === true &&
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
          `${OPERATIONS_API}/pr-merge/merge-enabled`,
          {
            method: "POST",
            body: JSON.stringify({
              scope: `repo:${repo}`,
              enabled,
              reason: reason.trim(),
            }),
          }
        );
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${body ? `: ${body}` : ""}`);
        }
        (await res.json()) as MergeEnabledResponse;
        onChanged();
      } catch (err) {
        log.warn("merge-enabled write failed", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [repo, onChanged]
  );

  // Pinned → show the PIN (this switch edits the pin, so it must show the
  // thing it edits). Not pinned → show what it resolves to. Either way the
  // sentence below carries the resolved value whenever the two disagree, so a
  // pinned-ON switch under a tenant pause never reads as "merges are running".
  const checked = pin === "inherit" ? resolved : pin === "true";
  return (
    <div className="pt-1 border-t border-border/40 space-y-1">
      <div className="flex items-center gap-2">
        <Label htmlFor={`merge-enabled-${repo}`} className="text-xs">
          Merge enabled
        </Label>
        <Switch
          id={`merge-enabled-${repo}`}
          checked={checked}
          disabled={submitting}
          onCheckedChange={(next) =>
            void write(
              next,
              next
                ? "pin merges ON for this repo."
                : "pin merges OFF for this repo."
            )
          }
          data-testid={`merge-enabled-switch-${repo}`}
        />
        {pin !== "inherit" && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs"
            disabled={submitting}
            onClick={() =>
              void write(null, "clear the pin and inherit the tenant default.")
            }
            data-testid={`merge-enabled-clear-${repo}`}
          >
            Clear pin
          </Button>
        )}
      </div>
      <p
        className="text-muted-foreground"
        data-testid={`merge-enabled-provenance-${repo}`}
      >
        {pinSentence(pin, resolved, tenantPaused)}
      </p>
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
  tenantPaused,
  onChanged,
}: {
  slo: RepoSlo;
  tenantPaused: boolean;
  onChanged: () => void;
}) {
  const w = slo.windows.last_7d;
  const w30 = slo.windows.last_30d;
  return (
    <Card data-testid={`slo-repo-card-${slo.repo}`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-mono">
          <span>{slo.repo}</span>
          <MergeEnabledBadge
            enabled={slo.merge_enabled}
            pin={pinChoice(slo.merge_enabled_override)}
            tenantPaused={tenantPaused}
            testId={`slo-merge-enabled-badge-${slo.repo}`}
          />
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
          {w.total_decisions} decision(s) in 7d / {w30.total_decisions} in 30d.
        </p>
        <CoordAdminOnly>
          <MergeEnabledControl
            repo={slo.repo}
            resolved={slo.merge_enabled}
            pin={pinChoice(slo.merge_enabled_override)}
            tenantPaused={tenantPaused}
            onChanged={onChanged}
          />
        </CoordAdminOnly>
      </CardContent>
    </Card>
  );
}

function SloDashboardCard({
  data,
  tenantPaused,
  onChanged,
}: {
  data: SloResponse | null;
  tenantPaused: boolean;
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
          Per-(tenant, repo) merge metrics, 7-day windows. Thresholds from plan
          §8: ≥95% auto-merge success / ≤5% operator override. Each card&apos;s
          badge is the repo&apos;s resolved merge posture, marked{" "}
          <em>pinned</em> or <em>inherited</em>.
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
              <SloRepoCard
                key={r.repo}
                slo={r}
                tenantPaused={tenantPaused}
                onChanged={onChanged}
              />
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

  // Is the tenant-wide pause latched?
  //
  // coord has no tenant-tier `merge_enabled` column, and the per-repo default
  // is `true`, so the TENANT profile (repo="") can only resolve false when
  // `tenant_merge_settings.merge_paused` is set. That makes this a sound
  // reading of the latch rather than a guess — and it is the only signal for
  // it the dashboard gets. `null` profile is UNKNOWN, not "not paused": the
  // banner stays silent rather than asserting the fleet is running.
  const tenantPaused = profile !== null && !profile.merge_enabled;

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
      {/* The tenant pause, stated ONCE and above everything.

          Without this the latch has no indicator anywhere: an operator who
          has just stopped the fleet opens this page, sees per-repo switches
          still reading ON (they show the PIN, which the pause outranks), and
          concludes the stop did not take. Read-only and ungated — every
          member should be able to see that merging is off, even though only
          an admin can lift it. */}
      {tenantPaused && (
        <Card className="border-red-500/60" data-testid="tenant-paused-banner">
          <CardContent className="pt-4">
            <p className="text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>Merges are paused tenant-wide.</strong> Nothing lands on
                any repo this tenant owns, including repos pinned on — the pause
                overrides every per-repo setting below. Lift it with the
                &ldquo;Merges enabled tenant-wide&rdquo; switch in Tenant
                defaults.
              </span>
            </p>
          </CardContent>
        </Card>
      )}
      {/* The emergency stop does NOT live here. A destructive, tenant-wide
          red button at the top of a calibration page is the wrong blast
          radius in the wrong place: this page is where you tune dwell times,
          not where you go mid-incident. It now sits per-repo on the merge
          train's incident view (MergeTrainActivity), still CoordAdminOnly.
          The tenant pause LATCH is still reachable from Tenant defaults below
          — it is a settings-shaped control with an incident-shaped blast
          radius, so it carries the same confirm + typed-reason discipline. */}
      {/* Phase 9 D9.6 — SLO Dashboard. Read-only metrics render for all
          members; the embedded merge-enabled control is itself gated. */}
      <SloDashboardCard
        data={slo}
        tenantPaused={tenantPaused}
        onChanged={triggerReload}
      />
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
                    tenantPaused={tenantPaused}
                    // `profile` is null while the tenant read is in flight, and
                    // these cards render anyway (only the tenant card gets a
                    // skeleton). Unknown capability reads as NOT writable —
                    // fail-closed, since the cost of guessing wrong is a 400
                    // that takes the whole per-repo save with it.
                    ffLandHeadSyncWritable={ffLandHeadSyncSupported(profile)}
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
