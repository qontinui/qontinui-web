/**
 * useSpawnRoster — the two roster feeds behind the spawn modal: the device
 * roster (`GET /operations/fleet/health`) and the Claude account roster
 * (`GET /operations/claude-accounts`), plus everything derived from them for
 * the device on screen.
 *
 * Split out of `SpawnModal.tsx` (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * Phase 4). Phase 6 moved both reads off a bare `fetch` and onto the typed
 * `/operations` client (`fetchFleetHealth`, `fetchClaudeAccounts`), so they
 * carry the operator's bearer and selected tenant. The device roster reads
 * through the SAME `fetchFleetHealth` as `useFleetHealth` — one reader of
 * that route, not two.
 *
 * `device` is the trimmed device id on screen (`""` = automatic placement).
 * The roster state is cleared by `resetRoster`, which the modal calls from its
 * own reset-on-open effect so the roster resets on exactly the triggers the
 * rest of the form does.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
// The fleet-health wire shapes are IMPORTED, not re-declared. This file used
// to carry its own copy of `FleetHealthDevice`, and it drifted exactly the way
// a second mirror does: coord grew a fifth `DeviceState` (`stale`, a derived
// overlay meaning the heartbeat is fine and the resource sampler has gone
// quiet), the operations copy learned it, and this one went on documenting
// four. The device list the modal renders comes from the same
// `GET /operations/fleet/health` read, so it reads the same shape.
import {
  fetchFleetHealth,
  type FleetHealthDevice,
  type FleetHealthPayload,
} from "@/lib/api/operations/coordFleet";
import {
  fetchClaudeAccounts,
  type ClaudeAccountRow,
  type ClaudeAccountsPayload,
} from "@/lib/api/operations/agents";
import { findRosterDevice } from "@/components/operations/DevicePicker";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import {
  MAX_CAUSE_LENGTH,
  messageFromErrorBody,
} from "@/lib/errors/backend-error-message";
import {
  ACCOUNT_AUTO,
  UUID_RE,
  deriveAccountRoster,
  describeSelectionMode,
  filterAccountsForDevice,
} from "@/components/admin/coord/spawnModel";

/** Why a roster read failed: the HTTP status when the server answered
 *  (`fleet/health returned HTTP 403`), followed by the backend's own reason
 *  when its error body carries a readable one, and the transport's own message
 *  when no status came back at all.
 *
 *  `httpClient` rejects a non-2xx as `GET <url> failed: <status> - <body>`.
 *  `httpStatusOf` / `httpBodyOf` read the status and the body back out of
 *  exactly that shape. The REASON then goes through the shared guarded reader
 *  (`messageFromErrorBody`), never a local parse. That reader falls back to
 *  `HTTP <status>` when the body says nothing readable, and the status is
 *  already in the sentence, so that fallback adds nothing here. */
function rosterReadFailure(route: string, e: unknown): string {
  const status = httpStatusOf(e);
  if (status === null) return e instanceof Error ? e.message : String(e);
  const head = `${route} returned HTTP ${status}`;
  const reason = messageFromErrorBody(
    httpBodyOf(e) ?? "",
    status,
    MAX_CAUSE_LENGTH
  ).replace(/\.+$/, "");
  return reason === `HTTP ${status}` ? head : `${head}: ${reason}`;
}

export function useSpawnRoster(open: boolean, device: string) {
  const [devices, setDevices] = useState<FleetHealthDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  /** Why the roster is unusable, when it is. `null` = a usable roster.
   *
   *  An empty roster and a FAILED roster fetch used to render identically
   *  ("No devices reporting"), because the catch below only reached
   *  `console.warn`. They have opposite fixes — one is a coord-side
   *  liveness question, the other an auth/proxy fault — so the operator
   *  has to be able to tell them apart without opening devtools.
   *
   *  `kind` is carried as DATA rather than inferred from the message text:
   *  `empty` is information (coord answered, honestly, with nothing), while
   *  `fault` is an error, and they are styled differently. Sniffing the
   *  prose to tell them apart later is exactly the bug this shape avoids. */
  const [devicesError, setDevicesError] = useState<{
    kind: "empty" | "fault";
    message: string;
  } | null>(null);
  /** Type a device id instead of picking one. Auto-armed whenever the
   *  roster comes back unusable, so an empty dropdown is never a dead end
   *  (the roster is a CONVENIENCE — `target_device_id` is just a uuid). */
  const [manualDevice, setManualDevice] = useState(false);

  /** The operator's account pin. `ACCOUNT_AUTO` — the default — means NO
   *  pin: the key is omitted from the body and the machine's own
   *  `AccountSelectionMode` decides, exactly as it does today. */
  const [account, setAccount] = useState(ACCOUNT_AUTO);
  /** The TENANT-wide roster; the per-device view is derived below. Kept
   *  whole so "no rows anywhere" and "no rows for this machine" stay
   *  distinguishable. */
  const [accounts, setAccounts] = useState<ClaudeAccountRow[]>([]);
  /** Starts TRUE. The fetch effect below runs after the first commit, so
   *  an initial `false` would paint one frame of "coord did not report
   *  whether its table is provisioned" before the request is even issued —
   *  an unknown asserted about a read that has not happened. */
  const [accountsLoading, setAccountsLoading] = useState(true);
  /** Why the account roster is unreadable, when it is: a transport failure,
   *  a non-2xx, or a body this surface cannot parse. `null` = the fetch
   *  answered; it does NOT mean the answer was non-empty. */
  const [accountsFault, setAccountsFault] = useState<string | null>(null);
  /** Rows coord served that carried no usable `device_id`/`account_label`.
   *  Dropped rather than guessed at, and then SAID — a roster you can only
   *  partly parse is not one to pin a spawn from silently. */
  const [unreadableAccountRows, setUnreadableAccountRows] = useState(0);
  const [tableProvisioned, setTableProvisioned] = useState<boolean | null>(
    null
  );
  const [columnsProvisioned, setColumnsProvisioned] = useState<boolean | null>(
    null
  );

  /** Clear both rosters — called by the modal's reset-on-open effect. */
  const resetRoster = useCallback(() => {
    setAccount(ACCOUNT_AUTO);
    setManualDevice(false);
    setDevicesError(null);
    setDevices([]);
    setAccounts([]);
    setAccountsFault(null);
    setUnreadableAccountRows(0);
    setTableProvisioned(null);
    setColumnsProvisioned(null);
  }, []);

  // Populate device dropdown from coord fleet health.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDevicesLoading(true);
    setDevicesError(null);
    fetchFleetHealth()
      .then((body: FleetHealthPayload) => {
        if (cancelled) return;
        const roster = body.devices ?? [];
        setDevices(roster);
        // A 200 with an empty roster is a real answer, not a failure. Coord
        // lists a device only when it is BOTH bound to the reading
        // principal's tenant (an INNER JOIN on `coord.tenant_devices`) and
        // inside the liveness window. Say so, rather than leaving a blank
        // dropdown to be read as "the fleet is down".
        //
        // Deliberately does NOT name a cause: an empty roster has several,
        // and this surface cannot tell them apart. An earlier draft asserted
        // a specific one (a heartbeat-cadence gap) that was later falsified —
        // wrong prose in a user-facing string is worse than none.
        if (roster.length === 0) {
          setDevicesError({
            kind: "empty",
            message:
              "Coord reported 0 live devices for this tenant. A device is " +
              "listed only if it is bound to this tenant and its last heartbeat " +
              "is recent, so a healthy machine can still be absent. Enter the " +
              "device id directly if you know it.",
          });
          setManualDevice(true);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const detail = rosterReadFailure("fleet/health", e);
        console.warn("[SpawnModal] fleet/health fetch failed", e);
        setDevices([]);
        setDevicesError({
          kind: "fault",
          message: `Could not load the device roster — ${detail}.`,
        });
        setManualDevice(true);
      })
      .finally(() => {
        if (cancelled) return;
        setDevicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Populate the Claude account roster from coord's per-device usage feed.
  //
  // Same discipline as the device roster above, for the same reason: a
  // failed read and an honestly-empty one have opposite fixes, so they are
  // carried as different STATES rather than collapsed into a blank list.
  // The roster is a CONVENIENCE — it never gates submit, because a spawn
  // with no pin is the unchanged default behaviour.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAccountsLoading(true);
    setAccountsFault(null);
    fetchClaudeAccounts()
      .then((body: ClaudeAccountsPayload) => {
        if (cancelled) return;
        const raw = body?.accounts;
        if (!Array.isArray(raw)) {
          // Our own proxy always emits an `accounts` array, so a body
          // without one is a contract break, not an empty roster.
          setAccounts([]);
          setTableProvisioned(null);
          setColumnsProvisioned(null);
          setUnreadableAccountRows(0);
          setAccountsFault(
            "coord returned no `accounts` array, so the roster could not be read."
          );
          return;
        }
        // A row without a NON-EMPTY device id and label is unusable: the
        // label is both the pin's wire value and the `SelectItem` value, and
        // Radix rejects `value=""` outright.
        const rows = raw.filter((r): r is ClaudeAccountRow => {
          if (typeof r !== "object" || r === null) return false;
          const row = r as ClaudeAccountRow;
          return (
            typeof row.device_id === "string" &&
            row.device_id.trim().length > 0 &&
            typeof row.account_label === "string" &&
            row.account_label.trim().length > 0
          );
        });
        setAccounts(rows);
        setUnreadableAccountRows(raw.length - rows.length);
        // `?? null` and never `?? true`: an absent flag is coord declining
        // to say, which is unknown. Defaulting it to `true` would let an
        // empty list be read as "this machine has no Claude accounts".
        setTableProvisioned(body.table_provisioned ?? null);
        setColumnsProvisioned(body.columns_provisioned ?? null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const detail = rosterReadFailure("claude-accounts", e);
        console.warn("[SpawnModal] claude-accounts fetch failed", e);
        setAccounts([]);
        setUnreadableAccountRows(0);
        setTableProvisioned(null);
        setColumnsProvisioned(null);
        setAccountsFault(`${detail}.`);
      })
      .finally(() => {
        if (cancelled) return;
        setAccountsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  /** A roster pick is a uuid by construction; a TYPED one is not. */
  const deviceIdValid = UUID_RE.test(device);

  /** A device id as an operator recognises it: the roster's hostname when
   *  the roster names it, the id otherwise. */
  const deviceLabel = useCallback(
    (id: string) => {
      const row = findRosterDevice(devices, id);
      return row?.hostname ? `${row.hostname} (${id})` : id;
    },
    [devices]
  );
  /** The name a refusal HEADLINE may carry: the hostname, or a plain phrase
   *  when the roster does not know one — never a raw id (R8; the id goes on
   *  the detail line). */
  const deviceHeadlineName = useCallback(
    (id: string) =>
      findRosterDevice(devices, id)?.hostname || "The device you named",
    [devices]
  );

  /** The chosen machine's accounts, out of the tenant-wide roster. */
  const deviceAccounts = useMemo(
    () => (deviceIdValid ? filterAccountsForDevice(accounts, device) : []),
    [accounts, device, deviceIdValid]
  );

  const accountRoster = useMemo(
    () =>
      deriveAccountRoster({
        loading: accountsLoading,
        fault: accountsFault,
        tableProvisioned,
        deviceChosen: deviceIdValid,
        tenantRosterSize: accounts.length,
        deviceAccounts,
      }),
    [
      accountsLoading,
      accountsFault,
      tableProvisioned,
      deviceIdValid,
      accounts.length,
      deviceAccounts,
    ]
  );

  const selectionMode = useMemo(
    () =>
      describeSelectionMode(
        deviceAccounts,
        columnsProvisioned,
        accountRoster.kind
      ),
    [deviceAccounts, columnsProvisioned, accountRoster.kind]
  );

  /** An account label only means something on the machine that reported it,
   *  so changing the device drops the pin rather than carrying a stale label
   *  onto a machine that has never heard of it. */
  useEffect(() => {
    setAccount(ACCOUNT_AUTO);
  }, [device]);

  /** `""` — i.e. "no pin", the key omitted — unless a real label is chosen. */
  const accountPin = account === ACCOUNT_AUTO ? "" : account;
  const pinnedRow = deviceAccounts.find((a) => a.account_label === accountPin);

  return {
    devices,
    devicesLoading,
    devicesError,
    manualDevice,
    setManualDevice,
    unreadableAccountRows,
    columnsProvisioned,
    accountRoster,
    selectionMode,
    account,
    setAccount,
    accountPin,
    pinnedRow,
    deviceLabel,
    deviceHeadlineName,
    resetRoster,
  };
}
