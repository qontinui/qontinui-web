"use client";

/**
 * "Remove from this tenant…" — the per-row button, the confirm dialog, and the
 * acknowledgements.
 *
 * Plan `2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console`
 * Phase 3. Calls `unbindFleetDevices` (through `useUnbindFleetDevices`) with
 * every device row the roster groups under the machine; coord removes THIS
 * tenant's binding of each and nothing else (D1, D3). Every rule about what the
 * dialog says and what an answer means is in `./removeMachineFromTenant.ts`.
 *
 * ## Why the state lives at the section, not in the row
 *
 * A removal ends in a roster re-read, and that re-read can drop the row (the
 * removal worked) or fail (the whole list turns UNKNOWN). Either unmounts the
 * row — so a dialog or an acknowledgement owned by the row would vanish with
 * the very answer it exists to show. `useRemoveMachineFromTenant` therefore
 * lives in `FleetRolesSection`, the dialog renders from a SNAPSHOT of the
 * machine taken when it opened, and each machine's last outcome is kept by its
 * machine key: shown in its row while the row exists, and in a section-level
 * list (`DetachedRemovalAcks`) when it does not.
 *
 * ## The confirm cannot be synthesised
 *
 * The confirm is a `DestructiveButton`, so a synthetic click (the UI Bridge
 * included) cannot fire the removal. The button's UI Bridge registration
 * declares its action `destructive` and its handler only OPENS the dialog.
 *
 * Rendered by its caller inside `OperatorOnly` + `CoordAdminOnly`, so neither
 * the controls nor their UI Bridge registration exist in presentation mode.
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
  MAYBE_LAST_CI_HOST_TEXT,
  MAY_HAVE_APPLIED_TEXT,
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
  unsettledIds,
  type RosterCompleteness,
  type UnbindRefusal,
  type UnbindRowResult,
  type UnbindSummary,
} from "./removeMachineFromTenant";
import {
  useUnbindFleetDevices,
  type UnbindOutcome,
  type UnbindState,
} from "./useUnbindFleetDevices";

const ROW_OUTCOME_TEXT: Record<UnbindRowResult["outcome"], string> = {
  removed: "removed",
  still_listed_via_pointer: STILL_LISTED_VIA_POINTER_TEXT,
  unbound_pointer_unknown: POINTER_UNREPORTED_TEXT,
  already_absent: "already absent",
  failed: "failed",
  refused_auth: "refused (auth)",
  not_attempted: "not attempted",
  unreported: "not reported",
};

/** A refusal in one sentence, for the acknowledgement. */
function refusalSentence(r: UnbindRefusal): string {
  return [
    r.reading.sentence,
    r.partial?.sentence ?? null,
    r.mayHaveApplied ? MAY_HAVE_APPLIED_TEXT : null,
  ]
    .filter((x): x is string => x !== null && x !== "")
    .join(" ");
}

/** One machine's last removal outcome, kept by its machine key. */
export interface RemovalAck {
  name: string;
  sentence: string;
  /** Every id read `unbound` or `already_absent`. */
  settled: boolean;
}

/** What the dialog acts on: a snapshot taken when it opened. */
interface RemovalTarget {
  machine: RoleMachine;
  lastCiHost: "yes" | "maybe" | "no";
}

export interface RemoveMachineController {
  target: RemovalTarget | null;
  open: boolean;
  status: UnbindState;
  busy: boolean;
  /** Ids a retry will send (only those not yet settled); `null` = all. */
  retryIds: string[] | null;
  /** The previous attempt's sentence, while retrying. */
  previous: string | null;
  acks: Readonly<Record<string, RemovalAck>>;
  openFor: (
    m: RoleMachine,
    machines: readonly RoleMachine[],
    roster: RosterCompleteness
  ) => void;
  setOpen: (open: boolean) => void;
  confirm: () => Promise<void>;
}

/** The section-level state of every removal (see the module doc). */
export function useRemoveMachineFromTenant(
  /** The roster's re-read, called once each removal settles. */
  refresh: () => Promise<void>
): RemoveMachineController {
  const { status, unbind, reset } = useUnbindFleetDevices(refresh);
  const [target, setTarget] = useState<RemovalTarget | null>(null);
  const [open, setOpenState] = useState(false);
  const [retryIds, setRetryIds] = useState<string[] | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [acks, setAcks] = useState<Record<string, RemovalAck>>({});
  const busy = status.state === "busy";

  const openFor = useCallback(
    (
      m: RoleMachine,
      machines: readonly RoleMachine[],
      roster: RosterCompleteness
    ) => {
      reset();
      setRetryIds(null);
      setPrevious(null);
      setTarget({ machine: m, lastCiHost: isLastCiHost(machines, m, roster) });
      setOpenState(true);
    },
    [reset]
  );

  const setOpen = useCallback(
    (o: boolean) => {
      if (!o && busy) return;
      setOpenState(o);
    },
    [busy]
  );

  const confirm = useCallback(async () => {
    if (target === null) return;
    const m = target.machine;
    const ids = retryIds ?? m.deviceIds;
    if (ids.length === 0) return;
    if (status.state === "answered") setPrevious(status.summary.sentence);
    else if (status.state === "refused")
      setPrevious(refusalSentence(status.refusal));
    const outcome: UnbindOutcome = await unbind(ids);
    if (outcome.state === "in_flight") return;
    if (outcome.state === "answered") {
      const s = outcome.summary;
      setAcks((prev) => ({
        ...prev,
        [m.key]: { name: m.name, sentence: s.sentence, settled: s.allSettled },
      }));
      if (s.allSettled) {
        toast.success(`${m.name}: ${s.sentence}`);
        setRetryIds(null);
        setOpenState(false);
      } else {
        setRetryIds(unsettledIds(s));
      }
      return;
    }
    const r = outcome.refusal;
    setAcks((prev) => ({
      ...prev,
      [m.key]: { name: m.name, sentence: refusalSentence(r), settled: false },
    }));
    // With per-id rows, only what is not yet settled is sent again; without
    // them nothing is known, so a retry sends every id of this attempt.
    setRetryIds(r.partial !== null ? unsettledIds(r.partial) : [...ids]);
  }, [retryIds, status, target, unbind]);

  return {
    target,
    open,
    status,
    busy,
    retryIds,
    previous,
    acks,
    openFor,
    setOpen,
    confirm,
  };
}

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

/** The dialog's result block: kept visible while anything is unsettled. */
function ResultBlock({
  status,
  previous,
}: {
  status: UnbindState;
  previous: string | null;
}) {
  const earlier = previous !== null && status.state !== "idle" && (
    <p
      className="text-[11px] break-words text-muted-foreground"
      data-testid="fleet-roles-remove-previous"
    >
      Previous attempt: {previous}
    </p>
  );
  if (status.state === "answered") {
    return (
      <div
        className="space-y-1.5 rounded-md border border-red-500/40 p-2"
        role="alert"
        data-testid="fleet-roles-remove-result"
      >
        {earlier}
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
        {earlier}
        <BackendErrorMessage
          error={refusal.reading}
          data-testid="fleet-roles-remove-refusal"
        />
        {refusal.mayHaveApplied && (
          <p
            className="text-xs break-words text-amber-600 dark:text-amber-500"
            data-testid="fleet-roles-remove-may-have-applied"
          >
            {MAY_HAVE_APPLIED_TEXT}
          </p>
        )}
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

/** The per-row button, and the row's live acknowledgement. */
export function RemoveMachineButton({
  machine: m,
  machines,
  roster,
  controller,
}: {
  machine: RoleMachine;
  /** Every roster row — to tell whether this is the tenant's last CI host. */
  machines: readonly RoleMachine[];
  roster: RosterCompleteness;
  controller: RemoveMachineController;
}) {
  const { openFor, busy, acks } = controller;
  const effect = removalEffect(m.deviceIds.length);
  const open = useCallback(
    () => openFor(m, machines, roster),
    [m, machines, openFor, roster]
  );
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
          open();
          return { opened: true, effect };
        },
      },
    },
  });

  if (m.deviceIds.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="fleet-roles-remove">
      <Button
        ref={ref}
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={open}
        aria-label={`Remove ${m.name} from this tenant`}
        title={`Opens a confirmation; ${effect}.`}
        data-testid="fleet-roles-remove-open"
        data-ui-bridge-id={`fleet-roles-remove:${m.key}`}
      >
        Remove from this tenant…
      </Button>
      {/* Always mounted, so a screen reader announces the text swap. */}
      <p
        className="text-[11px] break-words text-muted-foreground"
        role="status"
        data-testid="fleet-roles-remove-ack"
      >
        {acks[m.key]?.sentence ?? ""}
      </p>
    </div>
  );
}

/**
 * Removal outcomes whose machine is not on screen — the removal dropped its
 * row, or the roster read is not known. `listedKeys` = the keys of the rows
 * shown, or `null` when no row is shown.
 */
export function DetachedRemovalAcks({
  controller,
  listedKeys,
}: {
  controller: RemoveMachineController;
  listedKeys: ReadonlySet<string> | null;
}) {
  const detached = Object.entries(controller.acks).filter(
    ([key]) => listedKeys === null || !listedKeys.has(key)
  );
  return (
    <div role="status" data-testid="fleet-roles-remove-acks-detached">
      {detached.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] break-words text-muted-foreground">
          {detached.map(([key, a]) => (
            <li key={key} data-testid="fleet-roles-remove-ack-detached">
              Remove from this tenant — {a.name}: {a.sentence}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The confirm dialog, rendered from the snapshot `openFor` took. */
export function RemoveMachineFromTenantDialog({
  controller,
}: {
  controller: RemoveMachineController;
}) {
  const { target, open, setOpen, status, busy, retryIds, previous, confirm } =
    controller;
  if (target === null) return null;
  const m = target.machine;
  const rows = removalRows(m);
  const liveness = livenessText(m);
  const anyListed = rows.some((r) => r.listing?.registrarListing === "listed");
  const effect = removalEffect(m.deviceIds.length);
  const retrying = retryIds !== null;

  return (
    <ConfirmDestructiveDialog
      open={open}
      onOpenChange={setOpen}
      title={`Remove ${m.name} from this tenant?`}
      description={
        <p className="break-words">
          This {effect}. Coord stops sending this machine this tenant&apos;s
          work. The device itself is not deleted, and other tenants&apos;
          bindings are untouched.
        </p>
      }
      confirmLabel={
        retrying
          ? `Retry the ${retryIds.length} not yet removed`
          : "Remove from this tenant"
      }
      confirmPhrase={confirmPhraseFor(m)}
      busy={busy}
      confirmDisabled={retrying && retryIds.length === 0}
      onConfirm={() => void confirm()}
      testId="fleet-roles-remove-dialog"
    >
      <ul className="space-y-1.5 text-xs" data-testid="fleet-roles-remove-rows">
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
              title={r.lastSeenAt ? absoluteTime(r.lastSeenAt) : "not reported"}
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
      {target.lastCiHost !== "no" && (
        <p
          className="break-words text-amber-600 dark:text-amber-500"
          data-testid="fleet-roles-remove-last-ci-host"
          data-last-ci-host={target.lastCiHost}
        >
          {target.lastCiHost === "yes"
            ? LAST_CI_HOST_TEXT
            : MAYBE_LAST_CI_HOST_TEXT}
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
        <p className="break-words" data-testid="fleet-roles-remove-workstation">
          {WORKSTATION_TEXT}{" "}
          <Link href="/runners" className="underline">
            /runners
          </Link>
          .
        </p>
      )}
      {retrying && (
        <p
          className="break-words text-muted-foreground"
          data-testid="fleet-roles-remove-retry-scope"
        >
          A retry sends only the {retryIds.length} device row
          {retryIds.length === 1 ? "" : "s"} not yet removed.
        </p>
      )}
      <ResultBlock status={status} previous={previous} />
    </ConfirmDestructiveDialog>
  );
}
