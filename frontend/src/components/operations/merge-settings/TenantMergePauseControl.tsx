"use client";

import { useCallback, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle } from "lucide-react";
import { createLogger } from "@/lib/logger";
import { fireKillSwitch, setMergeEnabled } from "@/lib/api/operations/prMerge";
import { httpFailureText } from "./format";

const log = createLogger("MergeOrchestrationSettings");

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
export function TenantMergePauseControl({
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
        if (nextEnabled) {
          await setMergeEnabled({
            scope: "tenant",
            enabled: true,
            reason: reason.trim(),
          });
        } else {
          await fireKillSwitch({ scope: "tenant", reason: reason.trim() });
        }
        onChanged();
      } catch (err) {
        log.warn("tenant merge pause flip failed", err);
        setError(httpFailureText(err, { withBody: true }));
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
