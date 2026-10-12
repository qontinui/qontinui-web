"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, ChevronDown, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { relativeTime } from "@/components/operations/utils";
import {
  fetchMembers,
  grantMemberRole,
  revokeMemberRole,
  type CoordMemberRole,
  type OperatorRow,
} from "@/lib/api/operations/coordMembers";
import { operationsErrorMessage } from "@/lib/api/operations/base";
import {
  RecordDetail,
  StatCluster,
  StatusBadge,
  rowAccentProps,
  type Stat,
} from "@/components/console";
import { deriveMemberStatus, MEMBER_STATUS_PALETTE } from "../memberStatus";
import { requireRows } from "../_lib/groupName";
import { TIER_OPTIONS, tierLabel } from "../_lib/tenantLabels";
import { log } from "../_lib/log";

// ===========================================================================
// Section b — Members table
// ===========================================================================

export function MembersTable({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Pending role selection per operator (defaults to Administrator).
  const [pendingRole, setPendingRole] = useState<
    Record<string, CoordMemberRole>
  >({});
  const [busy, setBusy] = useState<string | null>(null);
  // R5 — one row open at a time, the same model `<RecordList>` holds for a row
  // list, spelled out here because a `<TableBody>` cannot host that primitive.
  const [openMember, setOpenMember] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await fetchMembers();
      // The third sibling. A malformed 200 here fabricates "No members yet." —
      // and, through `stats` below, the four-count headline `members 0 ·
      // administrators 0 · developers 0 · no access 0`. That is the page's
      // whole answer, invented from a read that did not land.
      const rows = requireRows<OperatorRow>(json?.operators, "members");
      for (const op of rows) {
        // Per ROW as well, and this one hides rather than announcing itself.
        // `deriveMemberStatus` does not throw on a string: `"operator"
        // .includes("admin")` is false and `.length > 0` is true, so the row
        // renders as Developer and `stats` counts it as one. Nothing looks
        // wrong until somebody clicks the row, and `op.roles.map()` in the
        // expansion (`MemberDetail`, below) throws and unmounts the tree.
        //
        // Absent is refused here, unlike the `tenants[].roles` guard above,
        // and the difference is the wire types: `TenantRoleEntry.roles` is
        // declared optional, `OperatorRow.roles` is not. The render agrees —
        // `op.roles.length` is dereferenced unconditionally — so a body
        // without the key already crashed this page. Throwing turns that
        // crash into the error arm the section already has.
        requireRows<string>(op?.roles, "members row `roles`");
      }
      setOperators(rows);
    } catch (err) {
      log.warn("load members failed", err);
      setError(operationsErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const grantRole = useCallback(
    async (operatorId: string, role: CoordMemberRole) => {
      setBusy(operatorId);
      try {
        await grantMemberRole(operatorId, role);
        toast.success(`Granted ${tierLabel(role)}`);
        await load();
        onChanged();
      } catch (err) {
        log.warn("grant role failed", err);
        toast.error(`Grant failed: ${operationsErrorMessage(err)}`);
      } finally {
        setBusy(null);
      }
    },
    [load, onChanged]
  );

  const revokeRole = useCallback(
    async (operatorId: string, role: string) => {
      setBusy(operatorId);
      try {
        await revokeMemberRole(operatorId, role);
        toast.success(`Revoked ${tierLabel(role)}`);
        await load();
        onChanged();
      } catch (err) {
        log.warn("revoke role failed", err);
        toast.error(`Revoke failed: ${operationsErrorMessage(err)}`);
      } finally {
        setBusy(null);
      }
    },
    [load, onChanged]
  );

  // R1 — the count cluster, derived from the rows already on the page (never a
  // second fetch). It answers the question an administrator opens this page
  // with, which the old header ("Members") did not: how is access distributed,
  // and is anybody sitting here unable to do anything?
  const stats = useMemo((): Stat[] => {
    let admins = 0;
    let devs = 0;
    let none = 0;
    for (const op of operators) {
      const k = deriveMemberStatus(op.roles).kind;
      if (k === "administrator") admins += 1;
      else if (k === "developer") devs += 1;
      else none += 1;
    }
    // `null` renders as `–`, never `0` (`StatCluster.tsx:95`). Only the
    // in-flight half of that was spelled here, so a FAILED read still
    // published all four counts as confident zeroes — and "no access 0" reads
    // as "nobody is locked out", the single most reassuring answer the page
    // can give, on the strength of a read that never arrived.
    //
    // This is DELIBERATELY stricter than `console/readFailure.ts`, and the
    // difference is worth naming rather than glossing. That module's
    // `readIsUnknown` is `readFailed && !loaded`: once a read has ever landed,
    // it says a later failure belongs to `staleDetail`, not to "unknown", and
    // it calls the count-based spelling wrong because on a POLLED surface one
    // blipped tick flips a genuinely-empty list to "unknown" and back.
    //
    // That reasoning does not reach here. `MembersTable` is not polled — it
    // reloads on mount, on `refreshKey`, and after a grant/revoke — so there
    // is no tick to flicker on. And the error arm already replaces the entire
    // table below with the error paragraph, so dashing the strip makes it
    // AGREE with the table underneath instead of contradicting it. Numbers
    // standing over a hidden table is the state worth avoiding.
    const unknown = loading || error !== null;
    return [
      {
        key: "members",
        label: "members ",
        // Claiming "0 members" before the fetch lands — or after it fails —
        // would be a lie about a page whose whole subject is who exists.
        value: unknown ? null : operators.length,
        "data-testid": "coord-members-count",
      },
      {
        key: "admins",
        label: "administrators ",
        value: unknown ? null : admins,
        "data-testid": "coord-members-count-admins",
      },
      {
        key: "devs",
        label: "developers ",
        value: unknown ? null : devs,
        "data-testid": "coord-members-count-developers",
      },
      {
        key: "no-access",
        label: "no access ",
        // Muted, NOT `attention`: nobody must act now (see `memberStatus.ts`).
        tone: "muted",
        value: unknown ? null : none,
        title:
          "Members holding no role in this tenant. Nothing is broken — they simply cannot reach anything until an administrator grants a tier.",
        "data-testid": "coord-members-count-no-access",
      },
    ];
  }, [operators, loading, error]);

  return (
    // R9 — no page-level Card/CardHeader/CardTitle. "Members" duplicated the
    // console shell's own title bar; the counts that replace it say something
    // the word did not.
    <div className="space-y-3" data-testid="coord-members-table-card">
      <StatCluster stats={stats} data-testid="coord-members-summary" />
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      ) : operators.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table data-testid="coord-members-table">
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Display name</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="text-right">Grant tier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operators.map((op) => {
                const sel = pendingRole[op.operator_id] ?? "admin";
                const isBusy = busy === op.operator_id;
                const expanded = openMember === op.operator_id;
                const status = deriveMemberStatus(op.roles);
                const Chevron = expanded ? ChevronDown : ChevronRight;
                return (
                  <Fragment key={op.operator_id}>
                    <TableRow
                      data-testid={`member-row-${op.operator_id}`}
                      data-expanded={expanded ? "true" : "false"}
                      onClick={() =>
                        setOpenMember(expanded ? null : op.operator_id)
                      }
                      {...rowAccentProps(status, "cursor-pointer")}
                    >
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <Chevron
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                          {op.email ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell>{op.display_name ?? "—"}</TableCell>
                      <TableCell>
                        {/* R3 — ONE badge answering "what can this person do?".
                            The per-role revoke chips move into the expansion:
                            they are an ACTION on a grant, not a description of
                            the member, and rendering N of them made the row as
                            tall as the number of grants. */}
                        <StatusBadge
                          status={status}
                          palette={MEMBER_STATUS_PALETTE}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                        {relativeTime(op.last_login_at)}
                      </TableCell>
                      <TableCell
                        // The grant controls are a Select and a Button; a
                        // click on either must not toggle the row under them.
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          <Select
                            value={sel}
                            onValueChange={(v) =>
                              setPendingRole((p) => ({
                                ...p,
                                [op.operator_id]: v as CoordMemberRole,
                              }))
                            }
                          >
                            <SelectTrigger
                              size="sm"
                              className="w-[150px]"
                              data-testid={`tier-select-${op.operator_id}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TIER_OPTIONS.map((t) => (
                                <SelectItem key={t.role} value={t.role}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            disabled={isBusy}
                            onClick={() => grantRole(op.operator_id, sel)}
                            data-testid={`grant-${op.operator_id}`}
                          >
                            Grant
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      // D2 — a full-width cell spanning all five columns.
                      <TableRow
                        data-testid={`member-row-detail-${op.operator_id}`}
                        className="hover:bg-transparent"
                      >
                        <TableCell colSpan={5} className="p-0">
                          <MemberDetail
                            op={op}
                            isBusy={isBusy}
                            onRevoke={revokeRole}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * R5's detail for one member, in the shared host and the fixed slot order.
 *
 * `actions` is where the per-role revoke chips live now. They were on the
 * collapsed row, which conflated two different things — *what this member can
 * do* (a description, one badge) and *take a grant away from them* (an action,
 * one control per grant) — and made a row's height a function of how many
 * roles somebody holds. `raw` carries the operator id and the SSO subject,
 * which is the only place R8 allows them.
 */
function MemberDetail({
  op,
  isBusy,
  onRevoke,
}: {
  op: OperatorRow;
  isBusy: boolean;
  onRevoke: (operatorId: string, role: string) => void;
}) {
  const status = deriveMemberStatus(op.roles);
  return (
    <RecordDetail
      className="rounded-none border-x-0 border-b-0"
      data-testid="member-row-detail"
      why={
        <p className="text-xs text-muted-foreground">
          {/* §4.2 clause 4 — a calm kind that is nonetheless owed something
              says so HERE, in words, never by borrowing amber. */}
          {status.reason ??
            `${op.display_name ?? op.email ?? "—"} holds ${op.roles.length} role${op.roles.length === 1 ? "" : "s"} in this tenant.`}
        </p>
      }
      actions={
        op.roles.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Revoke a grant:</p>
            <div className="flex flex-wrap gap-1">
              {op.roles.map((r) => (
                <Badge key={r} variant="secondary" className="gap-1 pr-0.5">
                  {tierLabel(r)}
                  <DestructiveButton
                    size="icon"
                    aria-label={`Revoke ${tierLabel(r)}`}
                    title={`Revoke ${tierLabel(r)}`}
                    disabled={isBusy}
                    onClick={() => onRevoke(op.operator_id, r)}
                    className="ml-0.5 size-4 rounded-sm bg-transparent text-muted-foreground shadow-none hover:bg-destructive hover:text-white"
                    data-testid={`revoke-${op.operator_id}-${r}`}
                  >
                    <X className="h-3 w-3" />
                  </DestructiveButton>
                </Badge>
              ))}
            </div>
          </div>
        ) : undefined
      }
      history={
        <p className="text-[11px] text-muted-foreground">
          Account created {relativeTime(op.created_at)} · last login{" "}
          {relativeTime(op.last_login_at)}
        </p>
      }
      raw={
        <div className="break-all font-mono text-[10px] text-muted-foreground/60">
          operator_id: {op.operator_id} · roles: [{op.roles.join(", ")}]
          {op.sso_provider ? ` · sso: ${op.sso_provider}` : ""}
        </div>
      }
    />
  );
}
