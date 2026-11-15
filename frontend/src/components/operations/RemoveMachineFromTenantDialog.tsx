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

import { useCallback, useEffect, useRef, useState } from "react";
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
import type { DispatchRolesRead, RoleMachine } from "./fleetDispatchRoles";
import {
  LAST_CI_HOST_TEXT,
  MAYBE_LAST_CI_HOST_TEXT,
  MAY_HAVE_APPLIED_TEXT,
  POINTER_UNREPORTED_TEXT,
  STILL_LISTED_HOME_TENANT_TEXT,
  STILL_LISTED_TEXT,
  STILL_LISTED_VIA_POINTER_TEXT,
  WORKSTATION_TEXT,
  combineSummaries,
  mergeRefusalOver,
  summarizeRows,
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
  not_attempted: "not attempted (aborted by an auth refusal)",
  answer_lost:
    "may have been removed — coord's answer was lost; reload to check",
  deadline_not_attempted: "not attempted (time limit) — retry",
  not_sent: "not sent (an earlier batch was refused)",
  not_sent_after_failure:
    "not sent (an earlier batch failed or its answer was lost)",
  request_rejected: "not attempted (the request was rejected)",
  removed_earlier: "absent now (the earlier attempt's answer was lost)",
  console_refused: "not attempted (this console refused the request)",
  unreported: "not reported",
};

/** One row's outcome in words, with what only the row itself knows. */
function rowText(r: UnbindRowResult): string {
  if (r.outcome === "request_rejected" && r.status !== null)
    return `not attempted (the request was rejected: HTTP ${r.status})`;
  if (r.outcome === "unreported" && r.unreadable)
    return "not reported (the answer could not be read)";
  return ROW_OUTCOME_TEXT[r.outcome];
}

/** A refusal in one sentence, for the acknowledgement. */
function refusalSentence(r: UnbindRefusal): string {
  return [
    r.reading.sentence,
    r.partial?.sentence ?? null,
    // An auth abort's own sentence already says what may have happened.
    r.mayHaveApplied && !r.auth ? MAY_HAVE_APPLIED_TEXT : null,
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
  /**
   * The current attempt's answer as the dialog shows it: over a retry, merged
   * with the whole-machine rows before it (`combineSummaries`), so it is the
   * same machine-level summary the acknowledgement carries.
   */
  status: UnbindState;
  busy: boolean;
  /** Ids a retry will send (only those not confirmed removed); `null` = all. */
  retryIds: string[] | null;
  /** The machine key whose dialog is open, or `null`. */
  openKey: string | null;
  /** The previous attempt's sentence, while retrying. */
  previous: string | null;
  acks: Readonly<Record<string, RemovalAck>>;
  /**
   * How many mounted row buttons are showing each machine's acknowledgement.
   * An ack no row shows — collapsed, gone, or the roster unknown — is listed
   * by `DetachedRemovalAcks` instead.
   */
  shownAcks: Readonly<Record<string, number>>;
  showAck: (key: string) => () => void;
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
  refresh: () => Promise<void>,
  /** The roster as the latest read left it (after `refresh` resolves). */
  readNow: () => DispatchRolesRead | null = () => null
): RemoveMachineController {
  const { status, busy, unbind, reset } = useUnbindFleetDevices(refresh);
  const [target, setTarget] = useState<RemovalTarget | null>(null);
  const [open, setOpenState] = useState(false);
  // Cleared by every `openFor`, which is the only way the target changes, so
  // a retry can never send another machine's ids.
  const [retryIds, setRetryIds] = useState<string[] | null>(null);
  // The machine-level rows so far: a retry's answer is merged over them, so
  // the acknowledgement counts the whole machine, not the retried subset.
  const [soFar, setSoFar] = useState<UnbindSummary | null>(null);
  // The whole-machine summary the CURRENT attempt is merged over (`null` for
  // a first attempt). What the dialog shows is that merge, never the retried
  // subset alone.
  const [base, setBase] = useState<UnbindSummary | null>(null);
  // The ids the current attempt sent — a rowless answer's unknowns.
  const [attemptIds, setAttemptIds] = useState<string[]>([]);
  const [previous, setPrevious] = useState<string | null>(null);
  const [acks, setAcks] = useState<Record<string, RemovalAck>>({});
  const [shownAcks, setShownAcks] = useState<Record<string, number>>({});

  const showAck = useCallback((key: string) => {
    const bump = (d: number) =>
      setShownAcks((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + d }));
    bump(1);
    return () => bump(-1);
  }, []);

  const openFor = useCallback(
    (
      m: RoleMachine,
      machines: readonly RoleMachine[],
      roster: RosterCompleteness
    ) => {
      reset();
      setRetryIds(null);
      setSoFar(null);
      setBase(null);
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
    // A retry is merged over the whole-machine rows so far; its "previous
    // attempt" line is the whole-machine acknowledgement, not a subset.
    const baseNow = retryIds !== null ? soFar : null;
    setBase(baseNow);
    setAttemptIds([...ids]);
    setPrevious(retryIds !== null ? (acks[m.key]?.sentence ?? null) : null);
    const outcome: UnbindOutcome = await unbind(ids);
    if (outcome.state === "in_flight") return;
    const settle = (s: UnbindSummary, summarySentence: string) => {
      // Nothing removed, nothing uncertain — yet the re-read still lists the
      // machine: it is listed through its home tenant, which this removal
      // cannot change.
      const read = readNow();
      const stillListedAfter =
        read !== null &&
        read.state === "known" &&
        read.machines.some((x) => x.key === m.key);
      const nothingRemoved = s.bindingsRemoved === 0 && s.removedEarlier === 0;
      const homeTenant = nothingRemoved && stillListedAfter;
      const sentence = homeTenant
        ? `${summarySentence} ${STILL_LISTED_HOME_TENANT_TEXT}`
        : summarySentence;
      setAcks((prev) => ({
        ...prev,
        [m.key]: { name: m.name, sentence, settled: true },
      }));
      // Every id unbound or already absent. A binding the home-tenant
      // pointer keeps listed (or may keep listed), a machine still listed,
      // or an absence nothing confirmed is not a clean removal: a warning.
      if (s.stillListed + s.pointerUnknown + s.removedEarlier > 0 || homeTenant)
        toast.warning(`${m.name}: ${sentence}`);
      else if (nothingRemoved)
        // Every id already absent: nothing happened, so nothing to celebrate.
        toast.info(`${m.name}: ${sentence}`);
      else toast.success(`${m.name}: ${sentence}`);
      setRetryIds(null);
      setOpenState(false);
    };
    // Over a retry, each id's latest outcome across the attempts.
    const whole = (s: UnbindSummary) =>
      baseNow !== null ? combineSummaries(m.deviceIds, baseNow, s) : s;
    if (outcome.state === "answered") {
      const s = whole(outcome.summary);
      setSoFar(s);
      if (s.allSettled) {
        settle(s, s.sentence);
        return;
      }
      setAcks((prev) => ({
        ...prev,
        [m.key]: { name: m.name, sentence: s.sentence, settled: false },
      }));
      setRetryIds(unsettledIds(s));
      return;
    }
    const refusal = outcome.refusal;
    // Over a retry, every refusal — with rows or without — is merged over
    // the whole-machine rows, so the dialog and the ack keep the totals.
    const r: UnbindRefusal =
      baseNow !== null
        ? mergeRefusalOver(m.deviceIds, baseNow, refusal, ids)
        : refusal;
    if (r.partial !== null) setSoFar(r.partial);
    else if (r.mayHaveApplied)
      // No rows, but it may have acted: remember every id as unreported, so
      // a retry that finds them absent credits this attempt.
      setSoFar(
        whole(
          summarizeRows(
            ids.map((deviceId) => ({
              deviceId,
              outcome: "unreported",
              status: null,
              error: null,
            }))
          )
        )
      );
    // A non-auth error whose rows leave nothing unsettled is settled: there
    // is nothing to retry, so no "Retry the 0…" dialog is left behind.
    if (!r.auth && r.partial !== null && r.partial.allSettled) {
      settle(r.partial, r.partial.sentence);
      return;
    }
    setAcks((prev) => ({
      ...prev,
      [m.key]: { name: m.name, sentence: refusalSentence(r), settled: false },
    }));
    // With per-id rows, only what is not yet settled is sent again; without
    // them nothing is known, so a retry sends every id of this attempt.
    setRetryIds(r.partial !== null ? unsettledIds(r.partial) : [...ids]);
  }, [acks, readNow, retryIds, soFar, target, unbind]);

  // Over a retry, show the merge — never the retried subset alone.
  const merge = (sum: UnbindSummary) =>
    base !== null && target !== null
      ? combineSummaries(target.machine.deviceIds, base, sum)
      : sum;
  const shown: UnbindState =
    status.state === "answered"
      ? { state: "answered", summary: merge(status.summary) }
      : status.state === "refused" && base !== null && target !== null
        ? {
            state: "refused",
            refusal: mergeRefusalOver(
              target.machine.deviceIds,
              base,
              status.refusal,
              attemptIds
            ),
          }
        : status;

  return {
    target,
    open,
    status: shown,
    busy,
    retryIds,
    openKey: open && target !== null ? target.machine.key : null,
    previous,
    acks,
    shownAcks,
    showAck,
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
          {rowText(r)}
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
        {refusal.mayHaveApplied && !refusal.auth && (
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
  const { openFor, busy, acks, showAck, openKey } = controller;
  const effect = removalEffect(m.deviceIds.length);
  const hasRows = m.deviceIds.length > 0;
  const open = useCallback(
    () => openFor(m, machines, roster),
    [m, machines, openFor, roster]
  );
  // The UI Bridge may hold the handler from an earlier registration: it reads
  // these refs, so it always acts on the machine as the roster now reads it
  // and on whether a removal is in flight now.
  const openRef = useRef(open);
  const effectRef = useRef(effect);
  const busyRef = useRef(busy);
  const openKeyRef = useRef(openKey);
  useEffect(() => {
    openRef.current = open;
    effectRef.current = effect;
    busyRef.current = busy;
    openKeyRef.current = openKey;
  }, [open, effect, busy, openKey]);
  // While mounted with rows, this row shows the machine's acknowledgement.
  useEffect(
    () => (hasRows ? showAck(m.key) : undefined),
    [hasRows, m.key, showAck]
  );
  const { ref } = useUIElement({
    id: `fleet-roles-remove:${m.key}`,
    label: `Remove ${m.name} from this tenant`,
    type: "button",
    customActions: {
      "remove-from-tenant": {
        id: "remove-from-tenant",
        label: "Remove from this tenant",
        // No count here: a registration can outlive a roster read, so the
        // count is in the handler's result, read when it runs.
        description:
          "Opens the confirmation that removes this tenant's binding of " +
          "every device row the roster lists for this machine; the result " +
          "names how many. Refused while a removal is in flight or any " +
          "removal dialog is open. The " +
          "removal itself needs a real click on the dialog's confirm " +
          "button, which refuses synthetic clicks.",
        // Declared, not re-derived: the action this control leads to removes
        // bindings, so an autonomous walk must exclude it.
        effect: "destructive",
        handler: async () => {
          if (busyRef.current) {
            return { opened: false, reason: "a removal is in flight" };
          }
          // Never replace an open dialog — not even this machine's own,
          // whose retry scope and typed phrase would be reset.
          if (openKeyRef.current !== null) {
            return {
              opened: false,
              reason:
                openKeyRef.current === m.key
                  ? "this machine's removal dialog is already open"
                  : "another machine's removal dialog is open",
            };
          }
          openRef.current();
          return { opened: true, effect: effectRef.current };
        },
      },
    },
  });

  if (!hasRows) return null;
  return (
    <div className="space-y-1" data-testid="fleet-roles-remove">
      <Button
        ref={ref}
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={open}
        aria-label={`Remove from this tenant… (${m.name})`}
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
 * Removal outcomes no row is showing — the row is collapsed, the removal
 * dropped it, or the roster read is not known — so an answer is never lost
 * with the row that asked for it.
 */
export function DetachedRemovalAcks({
  controller,
}: {
  controller: RemoveMachineController;
}) {
  const detached = Object.entries(controller.acks).filter(
    ([key]) => (controller.shownAcks[key] ?? 0) === 0
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
          ? `Retry the ${retryIds.length} device ${
              retryIds.length === 1 ? "row" : "rows"
            } not confirmed removed`
          : "Remove from this tenant"
      }
      confirmPhrase={confirmPhraseFor(m)}
      busy={busy}
      cancelDisabled={busy}
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
      {retrying && retryIds.length > 0 && (
        <p
          className="break-words text-muted-foreground"
          data-testid="fleet-roles-remove-retry-scope"
        >
          A retry sends only the {retryIds.length} device row
          {retryIds.length === 1 ? "" : "s"} not confirmed removed.
        </p>
      )}
      <ResultBlock status={status} previous={previous} />
    </ConfirmDestructiveDialog>
  );
}
