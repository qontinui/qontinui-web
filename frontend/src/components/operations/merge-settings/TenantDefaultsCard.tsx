"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Settings as SettingsIcon } from "lucide-react";
import { createLogger } from "@/lib/logger";
import { patchTenantMergeSettings } from "@/lib/api/operations/prMerge";
import { httpErrorText } from "./httpError";
import { TenantMergePauseControl } from "./TenantMergePauseControl";
import {
  ffLandHeadSyncSupported,
  parseFloatOrThrow,
  parseIntOrThrow,
} from "./format";
import type { EffectiveProfile } from "./types";

const log = createLogger("MergeOrchestrationSettings");

// ----------------------------------------------------------------------------
// Tenant defaults card
// ----------------------------------------------------------------------------

export function TenantDefaultsCard({
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
      await patchTenantMergeSettings(body);
      onSaved();
    } catch (err) {
      log.warn("save tenant settings failed", err);
      setError(httpErrorText(err));
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
              When a repo&apos;s main goes red (candidates rebased onto it
              generally fail CI until it&apos;s fixed), coord consults its
              red-main-fix policy and, where that policy is graduated and the
              fleet flag is armed, opens a visible terminal session on your
              device that diagnoses the failing check and authors a fix; the fix
              lands through coord&apos;s ordinary merge path. On by default —
              turn this off to opt this repo out. Reversible any time.
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
              69.4% of lands, measured over the 90 days to 2026-08-26 — the
              PR&apos;s head ref is left behind, so GitHub shows grey{" "}
              <span className="font-mono">Closed</span> on work that
              demonstrably landed. With this on, coord also moves the head ref
              to the rebased tip, and GitHub marks the PR{" "}
              <span className="font-mono">Merged</span> by itself. Off by
              default — it is a force-update on a branch coord does not own, so
              it is graduated per repo below rather than flipped fleet-wide.
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
                is discoverable, and it goes live by itself once coord serves
                it.
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
