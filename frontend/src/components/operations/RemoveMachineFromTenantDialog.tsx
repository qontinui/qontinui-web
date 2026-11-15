"use client";

/**
 * "Remove from this tenant…" — the per-row control on the Roles panel, its
 * confirm dialog, and the inline acknowledgement.
 *
 * Plan `2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console`
 * Phase 3. Calls `unbindFleetDevices` (through `useUnbindFleetDevices`) with
 * every device row the roster groups under the machine; coord removes THIS
 * tenant's binding of each and nothing else (D1, D3). Every rule about what the
 * dialog says and what an answer means is in `./removeMachineFromTenant.ts`.
 *
 * Built on `ConfirmDestructiveDialog`: the blast radius lists each device row
 * with its age (the full stamp in a `title`, never truncated away), and a
 * machine that is alive — or whose liveness coord does not report — needs its
 * name typed before the confirm enables. The confirm is a `DestructiveButton`,
 * so a synthetic click (the UI Bridge included) cannot fire the removal: the
 * bridge registration below declares the action `destructive` and its handler
 * only OPENS the dialog.
 *
 * Rendered by its caller inside `OperatorOnly` + `CoordAdminOnly`, so neither
 * the control nor its UI Bridge registration exists in presentation mode.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useUIElement } from "@qontinui/ui-bridge/react";
import { Button } from "@/components/ui/button";
import { ConfirmDestructiveDialog } from "@/components/ui/confirm-destructive-dialog";
import {
  BackendErrorMessage,
  absoluteTime,
  relativeTime,
} from "@/components/console";
import type { RoleMachine } from "./fleetDispatchRoles";
import {
  LAST_CI_HOST_TEXT,
  POINTER_UNREPORTED_TEXT,
  STILL_LISTED_TEXT,
  STILL_LISTED_VIA_POINTER_TEXT,
  WORKSTATION_TEXT,
  confirmPhraseFor,
  isLastCiHost,
  listingText,
  livenessText,
  removalEffect,
  removalRows,
  type UnbindRowResult,
  type UnbindSummary,
} from "./removeMachineFromTenant";
import {
  useUnbindFleetDevices,
  type UnbindState,
} from "./useUnbindFleetDevices";

const ROW_OUTCOME_TEXT: Record<UnbindRowResult["outcome"], string> = {
  removed: "removed",
  still_listed_via_pointer: STILL_LISTED_VIA_POINTER_TEXT,
  unbound_pointer_unknown: POINTER_UNREPORTED_TEXT,
  already_absent: "already absent",
  failed: "failed",
  unreported: "not reported",
};

/** The per-id outcome list, with coord's refusal under each failed id. */
function OutcomeRows({ summary }: { summary: UnbindSummary }) {
  return (
    <ul
      className="space-y-1 text-xs"
      data-testid="fleet-roles-remove-outcome-rows"
    >
      {summary.rows.map((r) => (
        <li
          key={r.deviceId}
          className="break-words"
          data-outcome={r.outcome}
          data-testid="fleet-roles-remove-outcome-row"
        >
          <span className="font-mono break-all">{r.deviceId}</span>:{" "}
          {ROW_OUTCOME_TEXT[r.outcome]}
          {r.error !== null && (
            <BackendErrorMessage
              error={r.error}
              className="mt-0.5"
              data-testid="fleet-roles-remove-row-error"
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/** The dialog's result block: kept visible while anything failed. */
function ResultBlock({ status }: { status: UnbindState }) {
  if (status.state === "answered") {
    return (
      <div
        className="space-y-1.5 rounded-md border border-red-500/40 p-2"
        role="alert"
        data-testid="fleet-roles-remove-result"
      >
        <p className="text-xs font-medium break-words">
          {status.summary.sentence}
        </p>
        <OutcomeRows summary={status.summary} />
      </div>
    );
  }
  if (status.state === "refused") {
    const { refusal } = status;
    return (
      <div
        className="space-y-1.5 rounded-md border border-red-500/40 p-2"
        role="alert"
        data-testid="fleet-roles-remove-result"
        data-refused={refusal.auth ? "auth" : "other"}
      >
        <BackendErrorMessage
          error={refusal.reading}
          data-testid="fleet-roles-remove-refusal"
        />
        {refusal.partial !== null && (
          <>
            <p className="text-xs font-medium break-words">
              {refusal.partial.sentence}
            </p>
            <OutcomeRows summary={refusal.partial} />
          </>
        )}
      </div>
    );
  }
  return null;
}

export function RemoveMachineFromTenantControl({
  machine: m,
  machines,
  refresh,
}: {
  machine: RoleMachine;
  /** Every roster row — to tell whether this is the tenant's last CI host. */
  machines: readonly RoleMachine[];
  /** The roster's re-read, called once each removal settles. */
  refresh: () => Promise<void>;
}) {
  const { status, unbind, reset } = useUnbindFleetDevices(refresh);
  const [open, setOpen] = useState(false);
  /** The last settled answer, shown in the row after the dialog closes. */
  const [ack, setAck] = useState<string | null>(null);
  const ids = m.deviceIds;
  const effect = removalEffect(ids.length);
  const busy = status.state === "busy";

  const openDialog = useCallback(() => {
    reset();
    setOpen(true);
  }, [reset]);

  const { ref } = useUIElement({
    id: `fleet-roles-remove:${m.key}`,
    label: `Remove ${m.name} from this tenant`,
    type: "button",
    customActions: {
      "remove-from-tenant": {
        id: "remove-from-tenant",
        label: "Remove from this tenant",
        description:
          `Opens the confirmation that ${effect} (${m.name}). ` +
          "The removal itself needs a real click on the dialog's confirm " +
          "button, which refuses synthetic clicks.",
        // Declared, not re-derived: the action this control leads to removes
        // bindings, so an autonomous walk must exclude it.
        effect: "destructive",
        handler: async () => {
          openDialog();
          return { opened: true, effect };
        },
      },
    },
  });

  const confirm = useCallback(async () => {
    const outcome = await unbind(ids);
    if (outcome.state === "in_flight") return;
    if (outcome.state === "answered") {
      setAck(outcome.summary.sentence);
      if (outcome.summary.allSettled) {
        toast.success(`${m.name}: ${outcome.summary.sentence}`);
        setOpen(false);
      }
      return;
    }
    setAck(
      outcome.refusal.partial !== null
        ? outcome.refusal.partial.sentence
        : outcome.refusal.reading.sentence
    );
  }, [ids, m.name, unbind]);

  if (ids.length === 0) return null;

  const rows = removalRows(m);
  const liveness = livenessText(m);
  const lastCiHost = isLastCiHost(machines, m);
  const anyListed = rows.some((r) => r.listing?.registrarListing === "listed");

  return (
    <div className="space-y-1" data-testid="fleet-roles-remove">
      <Button
        ref={ref}
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={openDialog}
        title={`Opens a confirmation; ${effect}.`}
        data-testid="fleet-roles-remove-open"
        data-ui-bridge-id={`fleet-roles-remove:${m.key}`}
      >
        Remove from this tenant…
      </Button>
      {ack !== null && (
        <p
          className="text-[11px] break-words text-muted-foreground"
          role="status"
          data-testid="fleet-roles-remove-ack"
        >
          {ack}
        </p>
      )}

      <ConfirmDestructiveDialog
        open={open}
        onOpenChange={(o) => {
          if (!o && busy) return;
          setOpen(o);
        }}
        title={`Remove ${m.name} from this tenant?`}
        description={
          <p className="break-words">
            This {effect}. Coord stops sending this machine this tenant&apos;s
            work. The device itself is not deleted, and other tenants&apos;
            bindings are untouched.
          </p>
        }
        confirmLabel="Remove from this tenant"
        confirmPhrase={confirmPhraseFor(m)}
        busy={busy}
        onConfirm={() => void confirm()}
        testId="fleet-roles-remove-dialog"
      >
        <ul
          className="space-y-1.5 text-xs"
          data-testid="fleet-roles-remove-rows"
        >
          {rows.map((r) => (
            <li
              key={r.deviceId}
              className="break-words"
              data-testid="fleet-roles-remove-row"
              data-listing={r.listing?.registrarListing ?? "workstation"}
            >
              <span className="font-medium">{m.name}</span>{" "}
              <span className="font-mono break-all">{r.deviceId}</span>
              {r.listing?.scope ? ` · ${r.listing.scope}` : ""} · last seen{" "}
              <span
                title={
                  r.lastSeenAt ? absoluteTime(r.lastSeenAt) : "not reported"
                }
                data-testid="fleet-roles-remove-row-seen"
              >
                {relativeTime(r.lastSeenAt, { absent: "not reported" })}
              </span>
              {r.listing !== null && (
                <span
                  className="block text-muted-foreground"
                  data-testid="fleet-roles-remove-row-listing"
                >
                  {listingText(r.listing)}
                </span>
              )}
            </li>
          ))}
        </ul>
        {liveness !== null && (
          <p
            className="break-words text-amber-600 dark:text-amber-500"
            data-testid="fleet-roles-remove-liveness"
          >
            {liveness}
          </p>
        )}
        {lastCiHost && (
          <p
            className="break-words text-amber-600 dark:text-amber-500"
            data-testid="fleet-roles-remove-last-ci-host"
          >
            {LAST_CI_HOST_TEXT}
          </p>
        )}
        {anyListed && (
          <p
            className="break-words text-amber-600 dark:text-amber-500"
            data-testid="fleet-roles-remove-still-listed"
          >
            {STILL_LISTED_TEXT}
          </p>
        )}
        {!m.hostOnly && (
          <p
            className="break-words"
            data-testid="fleet-roles-remove-workstation"
          >
            {WORKSTATION_TEXT}{" "}
            <Link href="/runners" className="underline">
              /runners
            </Link>
            .
          </p>
        )}
        <ResultBlock status={status} />
      </ConfirmDestructiveDialog>
    </div>
  );
}
