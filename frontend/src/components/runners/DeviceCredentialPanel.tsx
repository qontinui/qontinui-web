"use client";

/**
 * DeviceCredentialPanel — one runner's credential posture and the operator's
 * two controls over it, rendered inside its `/runners` Devices-tab row.
 *
 * Plan `2026-09-26-authenticate-and-perpetually-renew-a-specific-runner-from-qontinui-web`
 * Phases 1, 2.4 and 4.
 *
 * - **Posture** comes from coord's `GET /coord/status` stream through the one
 *   shared renderer (`StatusBadge` + `COORD_CREDENTIAL_PALETTE`, resolved by
 *   `resolveCoordCredential`). No row, a pruned row or a stale row is
 *   `credential unknown` — never authenticated.
 * - **Machine key** comes from web's own `device_machine_credentials` row via
 *   `GET /devices/credential-overview`. When that read failed or has no row
 *   for this device the key is UNKNOWN, not "none".
 * - **Authenticate** (any runner not `live`, or any device carrying the
 *   device-scoped deny) lifts that deny immediately and records an
 *   authorization the runner picks up on its next refresher tick. The 202 proves only that the
 *   authorization was recorded, so the panel says *pending*, never success;
 *   success is the posture badge turning `live` once the runner reports it.
 * - **Revoke** (any device whose deny is not set, key or no key) sets the
 *   device-scoped deny and withdraws any machine key, behind a confirmation.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDestructiveDialog } from "@/components/ui/confirm-destructive-dialog";
import { Loader2, ShieldCheck, ShieldOff, KeyRound, Clock } from "lucide-react";
import { StatusBadge } from "@/components/console/statusRow";
import { absoluteTime, relativeTime } from "@/components/console/time";
import { COORD_CREDENTIAL_PALETTE } from "@/components/operations/coordCredentialStatus";
import {
  authorizeDeviceRedeem,
  revokeDeviceMachineCredential,
  type DeviceCredentialOverviewRow,
} from "@/lib/api/device_credentials";
import {
  canAuthenticate,
  canRevoke,
  holdsActiveMachineKey,
  isPendingLive,
  type DevicePosture,
} from "./deviceCredentialPosture";

/** How the credential-overview read for the whole list went. */
export type OverviewState = "loading" | "error" | "ok";

export interface DeviceCredentialPanelProps {
  deviceId: string;
  posture: DevicePosture;
  /** This device's overview row, or undefined when the read had none. */
  overview: DeviceCredentialOverviewRow | undefined;
  overviewState: OverviewState;
  now: number;
  /** Called after a successful authorize or revoke so the list re-reads. */
  onChanged?: () => void;
}

/** "in 12 days" / "in 5 hours" / "expired", for a FUTURE timestamp. */
export function untilLabel(iso: string | null, now: number): string {
  if (!iso) return "at an unknown time";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "at an unknown time";
  const diff = ms - now;
  if (diff <= 0) return `expired ${relativeTime(iso, { now })}`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 48) return `in ${Math.floor(hours / 24)} days`;
  if (hours >= 1) return `in ${hours}h`;
  return `in ${Math.max(1, Math.floor(diff / 60_000))}m`;
}

function MachineKeyLine({
  overview,
  overviewState,
  now,
}: {
  overview: DeviceCredentialOverviewRow | undefined;
  overviewState: OverviewState;
  now: number;
}) {
  let state: "loading" | "unknown" | "none" | "revoked" | "held";
  let text: string;
  let title: string | undefined;
  if (overviewState === "loading") {
    state = "loading";
    text = "loading…";
  } else if (overviewState === "error" || !overview) {
    state = "unknown";
    text = "unknown";
    title =
      overviewState === "error"
        ? "The credential overview could not be read. UNKNOWN, not 'no key'."
        : "The credential overview carried no row for this device. UNKNOWN, not 'no key'.";
  } else if (!overview.machine_key.present) {
    state = "none";
    text = "none — this runner cannot renew itself";
  } else if (overview.machine_key.revoked_at) {
    state = "revoked";
    text = `revoked ${relativeTime(overview.machine_key.revoked_at, { now })}`;
    title = absoluteTime(overview.machine_key.revoked_at);
  } else {
    state = "held";
    text = `held — renews automatically until revoked; current key expires ${untilLabel(
      overview.machine_key.expires_at,
      now
    )}`;
    title = absoluteTime(overview.machine_key.expires_at);
  }
  return (
    <p
      className="text-xs text-text-muted flex items-center gap-1.5"
      data-testid="device-machine-key"
      data-machine-key-state={state}
      title={title}
    >
      <KeyRound className="w-3.5 h-3.5 shrink-0" />
      <span>
        Machine key: <span className="text-white">{text}</span>
      </span>
    </p>
  );
}

export function DeviceCredentialPanel({
  deviceId,
  posture,
  overview,
  overviewState,
  now,
  onChanged,
}: DeviceCredentialPanelProps) {
  const [authorizing, setAuthorizing] = useState(false);
  const [localPending, setLocalPending] = useState<{
    expires_at: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const { credential, lastObserved } = posture;
  const keyHeld = holdsActiveMachineKey(overview);
  const pending = localPending ?? overview?.pending_redeem ?? null;
  const showPending = isPendingLive(pending, now) && credential.kind !== "live";

  const handleAuthenticate = async () => {
    setAuthorizing(true);
    setActionError(null);
    try {
      const res = await authorizeDeviceRedeem(deviceId);
      setLocalPending({ expires_at: res.expires_at });
      onChanged?.();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to authorize the runner."
      );
    } finally {
      setAuthorizing(false);
    }
  };

  const handleRevoke = async () => {
    setRevoking(true);
    setActionError(null);
    try {
      await revokeDeviceMachineCredential(deviceId);
      setLocalPending(null);
      setConfirmRevoke(false);
      onChanged?.();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to revoke the machine key."
      );
      setConfirmRevoke(false);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div
      className="mt-4 rounded-md border border-border-subtle p-3 space-y-2"
      data-testid="device-credential-panel"
      data-ui-bridge-id={`runners.device.${deviceId}.credential`}
      data-device-id={deviceId}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-text-muted">Credential</span>
        <span
          className="contents"
          data-testid="device-credential-posture"
          data-posture-kind={credential.kind}
          data-posture-measured={String(credential.measured)}
        >
          <StatusBadge status={credential} palette={COORD_CREDENTIAL_PALETTE} />
        </span>
        <span
          className="text-xs text-text-muted"
          data-testid="device-credential-last-observed"
          title={lastObserved ? absoluteTime(lastObserved) : undefined}
        >
          {lastObserved
            ? `last observed ${relativeTime(lastObserved, { now })}`
            : "no posture report on record"}
        </span>
      </div>

      <MachineKeyLine
        overview={overview}
        overviewState={overviewState}
        now={now}
      />

      {overview?.credential_revoked_at && (
        <p
          className="text-xs text-red-400"
          data-testid="device-credential-revoked"
          title={absoluteTime(overview.credential_revoked_at)}
        >
          Revoked {relativeTime(overview.credential_revoked_at, { now })} — this
          runner&apos;s credentials can no longer be renewed until you
          authenticate it again.
        </p>
      )}

      {showPending && pending && (
        <p
          className="text-xs text-amber-200 flex items-center gap-1.5"
          data-testid="device-authenticate-pending"
          title={`Authorization lapses ${absoluteTime(pending.expires_at)}`}
        >
          <Clock className="w-3.5 h-3.5 shrink-0" />
          Authorization pending — any revocation on this runner is lifted now;
          it collects its new credential at its next check-in (≤5 min). Not yet
          confirmed — the badge turns live once the runner reports it.
          Authorization lapses {untilLabel(pending.expires_at, now)}.
        </p>
      )}

      {actionError && (
        <p
          className="text-xs text-red-400"
          data-testid="device-credential-error"
        >
          {actionError}
        </p>
      )}

      {(canAuthenticate(credential, overview) || canRevoke(overview)) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {canAuthenticate(credential, overview) && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAuthenticate}
              disabled={authorizing}
              className="border-brand-primary/50 text-brand-primary hover:bg-brand-primary/10"
              data-testid="device-authenticate-button"
              data-ui-bridge-id={`runners.device.${deviceId}.authenticate`}
            >
              {authorizing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4 mr-2" />
              )}
              {showPending ? "Authenticate again" : "Authenticate"}
            </Button>
          )}
          {canRevoke(overview) && (
            <Button
              variant="outline"
              size="sm"
              // Opens the confirmation only; the revoke itself is sent by the
              // dialog's DestructiveButton, which carries the synthetic-click gate.
              // eslint-disable-next-line @qontinui-web/no-unwrapped-destructive-handler
              onClick={() => setConfirmRevoke(true)}
              disabled={revoking}
              className="border-red-500/50 text-red-500 hover:bg-red-500/10"
              data-testid="device-revoke-button"
              data-ui-bridge-id={`runners.device.${deviceId}.revoke`}
            >
              <ShieldOff className="w-4 h-4 mr-2" />
              {keyHeld ? "Revoke machine key" : "Revoke credentials"}
            </Button>
          )}
        </div>
      )}

      <ConfirmDestructiveDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title={
          keyHeld
            ? "Revoke this runner's machine key?"
            : "Revoke this runner's credentials?"
        }
        description={
          keyHeld ? (
            <>
              This runner&apos;s machine key renews automatically until revoked.
              Revoking withdraws the key, and this runner&apos;s credentials can
              no longer be renewed until you authenticate it again — it goes
              dark once its current token expires.
            </>
          ) : (
            <>
              This runner holds no machine key. Revoking means its credentials
              can no longer be renewed until you authenticate it again — it goes
              dark once its current token expires.
            </>
          )
        }
        confirmLabel={revoking ? "Revoking…" : "Revoke"}
        busy={revoking}
        onConfirm={handleRevoke}
        testId="device-revoke-dialog"
      >
        <p>
          Device <span className="font-mono">{deviceId}</span>
        </p>
      </ConfirmDestructiveDialog>
    </div>
  );
}
