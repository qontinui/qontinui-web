"use client";

/**
 * Roles — set each machine's dispatch role (Workhorse / Bench / CI node).
 *
 * Plan `2026-10-02-fleet-machine-roles-workhorse-bench-ci-node` Phase 6, the
 * MINIMAL cut (operator request 2026-10-08, from coord finding e4a7e7e9:
 * dell-2020 and dell-2024 need to be set to `ci_node`). Meaning lives in
 * `./fleetDispatchRoles.ts`; transport in `./useFleetDispatchRoles.ts`.
 *
 * Composed from the console primitives (style guide §3 — `CollapsiblePanel`
 * R7, `RecordList` / `RecordRow` R2, `RecordDetail` R5), adding no new visual
 * vocabulary (§6.4). One row per machine coord serves; the role selector, the
 * suggestion chip and the per-lane role/drain readout live in the row's
 * detail. A machine coord does not know yet (no runner registered — dell-2020
 * and dell-2024 on 2026-10-03) is assigned by HOST NAME through the form under
 * the list; coord then serves it as "assigned, not yet registered" (§0a).
 *
 * The confirm step names the effect in words and says plainly what is NOT
 * applied yet: GitHub routing labels (Phase 4) and the CI-node switch
 * (Phase 5). A role changes what coord sends NEXT; nothing already running is
 * stopped (§D9). Coord's typed refusals render as sentences; `last_open_lane`
 * offers an explicit Force, `no_agent_host` does not (it is a fact about the
 * machine, not a judgement Force could override).
 */

import { useCallback, useState } from "react";
import { HelpCircle, Server } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CollapsiblePanel,
  RecordDetail,
  RecordList,
  RecordRow,
  absoluteTime,
} from "@/components/console";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import {
  DISPATCH_ROLES,
  LANES,
  LANE_LABEL,
  ROLE_LABEL,
  ROLE_OPENS,
  describeRole,
  describeRoleEffect,
  describeRoleWriteError,
  formatGiB,
  validateRoleForm,
  type DispatchRole,
  type Lane,
  type LaneView,
  type RoleMachine,
  type RoleWriteRefusal,
} from "./fleetDispatchRoles";
import {
  putDispatchRole,
  useFleetDispatchRoles,
} from "./useFleetDispatchRoles";

/** What the confirm dialog is about to write. */
interface PendingChange {
  name: string;
  deviceId: string | null;
  ciHostName: string | null;
  from: DispatchRole | null;
  to: DispatchRole;
  hostOnly: boolean;
  /** Coord's role layer per lane, for the "before" half of the sentence. */
  servedRoleLayer?: Partial<Record<Lane, "open" | "closed" | "unknown">>;
}

/** The key a role write names: the device, or the canonical host name. */
function machineWriteKey(c: {
  deviceId: string | null;
  ciHostName: string | null;
}): string {
  return c.deviceId
    ? `device:${c.deviceId.toLowerCase()}`
    : `host:${(c.ciHostName ?? "").trim().toLowerCase()}`;
}

function laneSummary(m: RoleMachine): string {
  if (m.lanes === null)
    return m.registered
      ? "lane state not served"
      : "no lanes until a runner registers";
  return LANES.map(
    (l) =>
      `${LANE_LABEL[l]}: ${
        l === "agent" && m.hostOnly
          ? "n/a"
          : (m.lanes![l].effective ?? "unknown")
      }`
  )
    .join(" · ")
    .replaceAll("_", " ");
}

function DrainText({ lane }: { lane: LaneView }) {
  switch (lane.drain.state) {
    case "none":
      return <>not drained</>;
    case "drained":
      return (
        <>
          drained
          {lane.drain.until ? ` until ${absoluteTime(lane.drain.until)}` : ""}
          {lane.drain.drainedBy ? ` by ${lane.drain.drainedBy}` : ""}
          {lane.drain.reason ? ` (${lane.drain.reason})` : ""}
        </>
      );
    case "partial":
      return (
        <>
          partly drained ({lane.drain.drainedDevices ?? "?"} of{" "}
          {lane.drain.totalDevices ?? "?"} registrations)
        </>
      );
    default:
      return <>unknown</>;
  }
}

/**
 * Per lane: coord's role layer and drain layer, side by side (§D2). The role
 * layer is coord's FLEET-effective role, so a co-tenant's Bench shows here as
 * closed even when this tenant assigned Workhorse.
 */
function LanesTable({ m }: { m: RoleMachine }) {
  return (
    <Table className="text-xs" data-testid="fleet-roles-lanes">
      <TableHeader>
        <TableRow>
          <TableHead>Lane</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Drain</TableHead>
          <TableHead>Coord says</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {LANES.map((l) => (
          <TableRow key={l} data-lane={l}>
            <TableCell>{LANE_LABEL[l]}</TableCell>
            <TableCell>
              {l === "agent" && m.hostOnly
                ? "n/a (no workstation runner)"
                : m.lanes
                  ? m.lanes[l].role
                  : "not served"}
            </TableCell>
            <TableCell className="break-words whitespace-normal">
              {m.lanes ? <DrainText lane={m.lanes[l]} /> : "not served"}
            </TableCell>
            <TableCell className="font-mono">
              {l === "agent" && m.hostOnly
                ? "n/a"
                : (m.lanes?.[l].effective ?? "not served")}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RoleButtons({
  m,
  onPick,
}: {
  m: RoleMachine;
  onPick: (to: DispatchRole) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label={`Dispatch role for ${m.name}`}
      >
        {DISPATCH_ROLES.map((r) => {
          const current = m.role === r;
          const refused = r === "workhorse" && m.hostOnly;
          return (
            <Button
              key={r}
              size="sm"
              variant={current ? "default" : "outline"}
              disabled={current || refused}
              aria-pressed={current}
              title={
                refused
                  ? "No workstation runner on this machine — it cannot host agent sessions."
                  : undefined
              }
              onClick={() => onPick(r)}
              data-testid={`fleet-roles-set-${r}`}
            >
              {ROLE_LABEL[r]}
            </Button>
          );
        })}
      </div>
      {m.hostOnly && (
        <p className="text-[11px] text-muted-foreground break-words">
          Workhorse is not offered: this machine has no workstation runner, so
          coord has nowhere to place a session on it.
        </p>
      )}
    </div>
  );
}

export function FleetRolesSection() {
  const { read, refresh } = useFleetDispatchRoles();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<RoleWriteRefusal | null>(null);
  // Set after a write whose outcome is unknown (5xx / transport failure): a
  // later `changed: false` may then be the earlier attempt's own change.
  // Per machine, so closing and reopening the dialog does not forget it.
  const [ambiguousKeys, setAmbiguousKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [hostName, setHostName] = useState("");
  const [hostRole, setHostRole] = useState<DispatchRole>("ci_node");

  const open = useCallback((change: PendingChange) => {
    setPending(change);
    setReason("");
    setRefusal(null);
  }, []);

  const close = useCallback(() => {
    setPending(null);
    setReason("");
    setRefusal(null);
  }, []);

  const pickFor = (m: RoleMachine) => (to: DispatchRole) =>
    open({
      name: m.name,
      deviceId: m.deviceId,
      ciHostName: m.deviceId ? null : m.ciHostName,
      from: m.role,
      to,
      hostOnly: m.hostOnly,
      // An unreadable own row may itself be the closure being replaced.
      servedRoleLayer:
        m.lanes && m.unrecognisedRole === null
          ? { agent: m.lanes.agent.role, ci: m.lanes.ci.role }
          : undefined,
    });

  const submit = useCallback(
    async (force: boolean) => {
      if (pending === null) return;
      const err = validateRoleForm({ reason });
      if (err) {
        toast.error(err);
        return;
      }
      setBusy(true);
      const res = await putDispatchRole({
        deviceId: pending.deviceId,
        ciHostName: pending.ciHostName,
        role: pending.to,
        reason: reason.trim(),
        force,
      });
      setBusy(false);
      if (!res.ok) {
        const r = describeRoleWriteError(res.status, res.body);
        setRefusal(r);
        // A lost answer may have applied; re-read so the list shows coord's truth.
        if (r.kind === "other" && r.mayHaveApplied) {
          const k = machineWriteKey(pending);
          setAmbiguousKeys((prev) => new Set(prev).add(k));
          void refresh();
        }
        return;
      }
      toast.success(
        res.changed
          ? `${pending.name} is now ${ROLE_LABEL[pending.to]}${
              force ? " (forced)" : ""
            }. Work already running on it is not stopped${
              // Coord counts sessions only for a device write; for a host
              // write it reports a constant, which is not a measurement.
              res.liveSessions !== null && pending.deviceId !== null
                ? ` (${res.liveSessions} live session${
                    res.liveSessions === 1 ? "" : "s"
                  } on it now)`
                : ""
            }.`
          : ambiguousKeys.has(machineWriteKey(pending))
            ? `${pending.name} is ${ROLE_LABEL[pending.to]} — the earlier attempt may have applied it.`
            : `${pending.name} was already ${ROLE_LABEL[pending.to]} — nothing changed.`
      );
      // A definite answer settles the earlier ambiguity for this machine.
      const settled = machineWriteKey(pending);
      setAmbiguousKeys((prev) => {
        if (!prev.has(settled)) return prev;
        const next = new Set(prev);
        next.delete(settled);
        return next;
      });
      close();
      void refresh();
    },
    [ambiguousKeys, close, pending, reason, refresh]
  );

  // A CI host coord already lists is set on its own row. Writing it again by
  // host name would update that same row (coord upserts on the machine key),
  // but the confirm sentence would then be built as if it had no role.
  const listedMatch =
    read.state === "known"
      ? (read.machines.find(
          (m) =>
            // Only a CI-host row is the same machine key: a workstation of the
            // same name is a different machine to coord (see the twin note).
            m.hostOnly &&
            [m.name, m.ciHostName].some(
              (n) =>
                n !== null && n.toLowerCase() === hostName.trim().toLowerCase()
            )
        ) ?? null)
      : null;
  const hostError =
    validateRoleForm({ reason: "x", ciHostName: hostName }) ??
    (listedMatch
      ? `${listedMatch.name} is already listed above — set its role on its row.`
      : read.state !== "known"
        ? "The machine list has not been read, so a duplicate cannot be ruled out."
        : null);

  const summary =
    read.state === "known" ? (
      <Badge variant="outline" className="text-[10px]">
        {read.machines.length} machine{read.machines.length === 1 ? "" : "s"}
      </Badge>
    ) : read.state === "unknown" ? (
      <Badge variant="outline" className="text-[10px]">
        unknown
      </Badge>
    ) : null;

  return (
    <CollapsiblePanel
      title="Roles"
      icon={<Server className="h-4 w-4" />}
      summary={summary}
      storageKey="coord-devops-roles"
      data-testid="fleet-roles"
      data-ui-bridge-id="fleet-roles"
    >
      <p className="mb-2 text-xs text-muted-foreground break-words">
        What kind of work coord may send each machine. Workhorse takes CI and
        agent sessions; Bench takes nothing; CI node takes CI only. A role is
        standing and separate from a drain, which is a temporary hold.
      </p>

      {read.state === "unknown" ? (
        <div
          className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-2 py-1.5"
          role="status"
          data-testid="fleet-roles-unknown"
        >
          <div className="flex items-center gap-1.5">
            <HelpCircle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
            <span className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
              Roles unknown
            </span>
          </div>
          <p className="mt-1 text-[11px] break-words text-muted-foreground">
            {read.reason} No machine is shown as unassigned, because that would
            claim it behaves as a Workhorse.
          </p>
        </div>
      ) : (
        <RecordList
          items={read.state === "known" ? read.machines : []}
          loaded={read.state === "known"}
          itemKey={(m) => m.key}
          empty={
            <p className="text-xs text-muted-foreground">
              Coord lists no machines for this tenant
              {read.state === "known" && (read.omitted ?? 0) > 0
                ? ` (${read.omitted} not seen recently are left out of its read)`
                : ""}
              .
            </p>
          }
          renderRow={(m, { expanded, onToggle }) => (
            <RecordRow
              identity={m.name}
              label={describeRole(m)}
              status={
                m.role === null && m.suggestion ? (
                  <Badge
                    variant="secondary"
                    className="text-[10px] shrink-0"
                    data-testid="fleet-roles-suggestion"
                  >
                    suggested: {ROLE_LABEL[m.suggestion.role]}
                  </Badge>
                ) : undefined
              }
              reason={laneSummary(m)}
              attention={m.unrecognisedRole !== null ? "waiting" : undefined}
              expanded={expanded}
              onToggle={onToggle}
              data-testid="fleet-roles-row"
            >
              <RecordDetail
                why={
                  <div className="space-y-1 text-xs">
                    <p className="break-words">
                      <span className="font-medium">{describeRole(m)}</span>
                      {m.role !== null && m.updatedAt
                        ? ` — set ${absoluteTime(m.updatedAt)}${
                            m.updatedBy ? ` by ${m.updatedBy}` : ""
                          }${m.reason ? `: ${m.reason}` : ""}`
                        : ""}
                    </p>
                    {m.role === null && m.suggestion && (
                      <p className="break-words text-muted-foreground">
                        Suggested {ROLE_LABEL[m.suggestion.role]}
                        {m.suggestion.memTotalBytes !== null
                          ? ` from ${formatGiB(m.suggestion.memTotalBytes)} RAM`
                          : ""}
                        .
                      </p>
                    )}
                    {m.hostOnly &&
                      m.registered &&
                      m.role !== null &&
                      !ROLE_OPENS[m.role].ci && (
                        <p
                          className="break-words text-muted-foreground"
                          data-testid="fleet-roles-github-runner-warning"
                        >
                          This role closes CI for coord, but GitHub runner
                          services registered under this host still receive
                          GitHub jobs: label removal does not follow the role
                          yet.
                        </p>
                      )}
                    {m.sessionsBeforeChange !== null &&
                      m.sessionsBeforeChange > 0 && (
                        <p className="break-words text-amber-600 dark:text-amber-500">
                          Up to {m.sessionsBeforeChange} live session
                          {m.sessionsBeforeChange === 1 ? "" : "s"} started
                          before this role was set — not safe to rebuild yet.
                        </p>
                      )}
                    {!m.hostOnly &&
                      read.state === "known" &&
                      read.machines.some(
                        (h) =>
                          h.hostOnly &&
                          h.role !== null &&
                          h.name.toLowerCase() === m.name.toLowerCase()
                      ) && (
                        <p
                          className="break-words text-muted-foreground"
                          data-testid="fleet-roles-host-row-twin"
                        >
                          A CI-host role is also set under the name {m.name}; it
                          governs GitHub runner registrations only and does not
                          reach this runner — set this row too.
                        </p>
                      )}
                    {m.sessionsUnknown && (
                      <p className="break-words text-amber-600 dark:text-amber-500">
                        Coord could not count the live sessions on this machine
                        — do not assume it is safe to rebuild.
                      </p>
                    )}
                    {m.sessionsStartUnrecorded !== null &&
                      m.sessionsStartUnrecorded > 0 && (
                        <p className="break-words text-amber-600 dark:text-amber-500">
                          {m.sessionsStartUnrecorded} live session
                          {m.sessionsStartUnrecorded === 1 ? "" : "s"} with no
                          recorded start — not safe to rebuild yet.
                        </p>
                      )}
                  </div>
                }
                problems={<LanesTable m={m} />}
                actions={
                  <CoordAdminOnly fallback={<ReadOnlyNotice />}>
                    <div className="space-y-1.5">
                      <RoleButtons m={m} onPick={pickFor(m)} />
                      {m.role === null && m.suggestion && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => pickFor(m)(m.suggestion!.role)}
                          data-testid="fleet-roles-accept-suggestion"
                        >
                          Accept suggestion: {ROLE_LABEL[m.suggestion.role]}
                        </Button>
                      )}
                    </div>
                  </CoordAdminOnly>
                }
                raw={
                  <span className="font-mono text-[11px] text-muted-foreground break-all">
                    {m.deviceId
                      ? `device ${m.deviceId}`
                      : `host ${m.ciHostName}`}
                    {m.version !== null ? ` · role v${m.version}` : ""}
                  </span>
                }
              />
            </RecordRow>
          )}
        />
      )}

      {read.state === "known" && read.notice !== null && (
        <p
          className="mt-2 text-[11px] text-amber-600 dark:text-amber-500 break-words"
          data-testid="fleet-roles-notice"
        >
          {read.notice}
        </p>
      )}
      {read.state === "known" &&
        ((read.omitted ?? 0) > 0 || (read.unidentifiable ?? 0) > 0) && (
          <p
            className="mt-2 text-[11px] text-muted-foreground break-words"
            data-testid="fleet-roles-omitted"
          >
            {(read.omitted ?? 0) > 0
              ? `${read.omitted} machine${read.omitted === 1 ? "" : "s"} not seen recently ${
                  read.omitted === 1 ? "is" : "are"
                } not listed (coord leaves them out of this read). `
              : ""}
            {(read.unidentifiable ?? 0) > 0
              ? `${read.unidentifiable} CI runner registration${
                  read.unidentifiable === 1 ? "" : "s"
                } could not be named.`
              : ""}
          </p>
        )}

      <CoordAdminOnly>
        <div
          className="mt-3 space-y-1.5 border-t border-border pt-3"
          data-testid="fleet-roles-by-host"
        >
          <Label htmlFor="fleet-roles-host" className="text-xs">
            Assign a role by host name (a machine coord does not list yet)
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="fleet-roles-host"
              className="h-8 w-48"
              placeholder="e.g. dell-2020"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              data-testid="fleet-roles-host-input"
            />
            <div className="flex gap-1" role="group" aria-label="Role for host">
              {(["ci_node", "bench"] as const).map((r) => (
                <Button
                  key={r}
                  type="button"
                  size="sm"
                  variant={hostRole === r ? "default" : "outline"}
                  aria-pressed={hostRole === r}
                  onClick={() => setHostRole(r)}
                  data-testid={`fleet-roles-host-role-${r}`}
                >
                  {ROLE_LABEL[r]}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              disabled={hostError !== null}
              onClick={() =>
                open({
                  name: hostName.trim(),
                  deviceId: null,
                  ciHostName: hostName.trim(),
                  from: null,
                  to: hostRole,
                  hostOnly: true,
                })
              }
              data-testid="fleet-roles-host-open"
            >
              Assign…
            </Button>
          </div>
          {hostName.trim() !== "" && hostError !== null && (
            <p
              className="text-[11px] text-muted-foreground break-words"
              data-testid="fleet-roles-host-error"
            >
              {hostError}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground break-words">
            For a CI host with no workstation runner (Workhorse is not possible
            there). The role applies when a GitHub self-hosted runner registers
            under that name; until then the row reads &ldquo;assigned, not yet
            registered&rdquo;. It does NOT reach a qontinui runner on that
            machine: that registers as its own row, whose role must be set
            there.
          </p>
        </div>
      </CoordAdminOnly>

      <Dialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o && !busy) close();
        }}
      >
        <DialogContent data-testid="fleet-roles-dialog">
          <DialogHeader>
            <DialogTitle>
              {pending
                ? `Make ${pending.name} a ${ROLE_LABEL[pending.to]}?`
                : ""}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                {pending && (
                  <p
                    className="break-words font-medium text-foreground"
                    data-testid="fleet-roles-effect"
                  >
                    {describeRoleEffect(
                      pending.name,
                      pending.from,
                      pending.to,
                      pending.hostOnly,
                      pending.servedRoleLayer
                    )}
                  </p>
                )}
                <p className="break-words">
                  This changes what coord sends next. Work already running on
                  the machine is not stopped.
                </p>
                {pending &&
                  pending.deviceId !== null &&
                  !ROLE_OPENS[pending.to].ci && (
                    <p
                      className="break-words"
                      data-testid="fleet-roles-linked-hosts-note"
                    >
                      This sets the workstation only. Its GitHub runner hosts
                      are listed here as separate machines under the runner name
                      (e.g. msi-wsl — the device list shows it as
                      gh-runner-msi-wsl) and keep their own role — set them too
                      if this machine should take no CI.
                    </p>
                  )}
                <p
                  className="break-words"
                  data-testid="fleet-roles-not-yet-applied"
                >
                  Not automatic yet: GitHub runner routing labels and the
                  CI-node switch do not follow the role. GitHub may still route
                  jobs to a machine whose role closes CI.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="fleet-roles-reason">Reason (required)</Label>
            <Textarea
              id="fleet-roles-reason"
              rows={2}
              value={reason}
              disabled={busy}
              placeholder="e.g. remote box, CI only"
              onChange={(e) => setReason(e.target.value)}
              data-testid="fleet-roles-reason"
            />
          </div>

          {refusal && (
            <p
              className="text-xs break-words text-red-600 dark:text-red-400"
              role="alert"
              data-testid="fleet-roles-refusal"
              data-refusal={refusal.kind}
            >
              {refusal.message}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={close}
              data-testid="fleet-roles-cancel"
            >
              Cancel
            </Button>
            {refusal?.kind === "last_open_lane" ? (
              <Button
                type="button"
                variant="destructive"
                disabled={busy || reason.trim() === ""}
                onClick={() => void submit(true)}
                data-testid="fleet-roles-force"
              >
                Force — apply anyway
              </Button>
            ) : (
              <Button
                type="button"
                disabled={
                  busy ||
                  reason.trim() === "" ||
                  refusal?.kind === "no_agent_host" ||
                  refusal?.kind === "not_admin"
                }
                onClick={() => void submit(false)}
                data-testid="fleet-roles-submit"
              >
                Set role
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CollapsiblePanel>
  );
}
