"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDestructiveDialog } from "@/components/ui/confirm-destructive-dialog";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { relativeTime } from "@/components/operations/utils";
import {
  addCognitoGroupUser,
  deleteCognitoGroup,
  fetchCognitoGroupBlastRadius,
} from "@/lib/api/operations/cognitoGroups";
import { RecordDetail } from "@/components/console";
import type { CognitoGroupRow, GroupTenantRoleRow } from "../_types";
import {
  blastRadiusReadCause,
  HOME_GROUP_SUFFIX,
  parseBlastRadiusVerdict,
  plural,
  pluralNoun,
  type BlastRadiusRead,
} from "../_lib/blastRadius";
import {
  historicalRenameTarget,
  historicalSlugTooltip,
  tierLabel,
} from "../_lib/tenantLabels";
import { backendErrorMessage } from "@/lib/errors/backend-error-message";
import { CognitoGroupMembers } from "./CognitoGroupMembers";
import { log } from "../_lib/log";

/**
 * Name what may be named and COUNT the rest — the same discipline as the
 * backend's `_render_affected`, so the preview and the 409 it previews say
 * the same thing about the same verdict. `unit` is explicit because guard 1
 * counts ROWS (one group holds several rows in one tenant) and guard 3 counts
 * TENANTS; "3 other tenants" over a row count would be false in the one
 * sentence the operator acts on.
 */
function renderAffected(
  named: string[],
  other: number,
  unit: "mapping" | "tenant",
  unmaterialized = 0
): string {
  const parts: string[] = [];
  if (named.length) parts.push(named.join(", "));
  if (other) {
    const more = named.length ? "further " : "";
    parts.push(
      unit === "mapping"
        ? `${other} ${more}${pluralNoun(other, "mapping")} in tenants you do not administer`
        : `${other} ${more}${pluralNoun(other, "tenant")} you do not administer`
    );
  }
  if (unmaterialized) {
    parts.push(
      `${plural(unmaterialized, "mapping")} into tenants that do not exist yet`
    );
  }
  return parts.length ? parts.join(" and ") : "a tenant";
}

/**
 * A single Cognito group row: name / description / created columns, an
 * expand toggle that reveals members, an inline "add user by email" form, and a
 * delete-group action.
 *
 * The delete is the dangerous one, so two things are true of this row that were
 * not before plan
 * `2026-08-27-members-page-delete-paths-authorization-and-blast-radius`
 * Phase 2:
 *
 *  - **Blast radius is on the COLLAPSED row.** The member list only mounts
 *    inside `{expanded && …}`, so a collapsed row used to show name,
 *    description and a creation time — zero information about what the Delete
 *    button beside it would affect. Member count and coord's tenant mappings
 *    are now rendered next to the name, at the moment of decision.
 *  - **Delete goes through {@link ConfirmDestructiveDialog}** and requires
 *    typing the group name. `DestructiveButton` alone only blocks synthetic
 *    clicks; it never asked a human anything.
 *  - **The confirmation shows the delete's OWN verdict.** Opening the dialog
 *    reads `GET /coord/cognito/groups/{name}/blast-radius` — the pool-wide
 *    verdict the backend's guards are derived from — rather than the section's
 *    `group-tenant-roles` read, which is TENANT-SCOPED and so can say "no
 *    mappings" about a group mapped into another tenant. Until this the
 *    dialog under-reported exactly as the guards once did (plan
 *    `2026-08-28-pool-wide-blast-radius-read-for-group-delete`, open question
 *    2): it said nothing referenced the group and the delete then 409'd.
 *    The row badges still come from the section's read — it is one call for
 *    every group and correct for what it names, the caller's own tenant —
 *    which is why their copy says "in your tenant" rather than claiming the
 *    pool.
 */
export function CognitoGroupItem({
  group,
  mappings,
  mappingsError,
  memberCount,
  membersError,
  onDeleted,
  onMembersChanged,
}: {
  group: CognitoGroupRow;
  /**
   * coord `group_tenant_roles` rows whose `group_id` is this group; `null`
   * while the section's read is still in flight (or has not run), so an
   * un-arrived answer is never mistaken for an empty one.
   */
  mappings: GroupTenantRoleRow[] | null;
  /**
   * Set when the `group-tenant-roles` read FAILED — unknown, NOT "no
   * mappings". The same distinction `membersError` draws, for the other half
   * of the blast radius.
   */
  mappingsError: boolean;
  /** Members in this group; `null` while loading, `undefined` if unknown. */
  memberCount: number | null | undefined;
  /** Set when the member-count probe failed — unknown, NOT zero. */
  membersError: boolean;
  onDeleted: () => void;
  /** Refresh the section's counts after an add/remove in this group. */
  onMembersChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [allowHomeGroup, setAllowHomeGroup] = useState(false);
  const [blastRadius, setBlastRadius] = useState<BlastRadiusRead>({
    state: "idle",
  });
  // Bump to force the members sub-list to refetch after an add.
  const [membersKey, setMembersKey] = useState(0);

  const isHomeGroup = group.group_name.endsWith(HOME_GROUP_SUFFIX);
  const homeTenantSlug = isHomeGroup
    ? group.group_name.slice(0, -HOME_GROUP_SUFFIX.length)
    : null;

  // ONE read, at the moment of decision. Opening the dialog is what asks; the
  // blast-radius route is per-group, so reading it for every row on the
  // section's behalf would be N calls for a preview nobody has opened. A
  // close resets to `idle` so a re-open reads again — the operator's usual
  // path past a mapped refusal is "remove the mapping, re-open", and a cached
  // verdict would show them the refusal they just cleared.
  useEffect(() => {
    if (!confirmOpen) {
      // Functional so a row that is already idle (every row, at mount) does
      // not re-render over a fresh-but-equal object.
      setBlastRadius((prev) => (prev.state === "idle" ? prev : { state: "idle" }));
      return;
    }
    let cancelled = false;
    setBlastRadius({ state: "loading" });
    void (async () => {
      try {
        const res = await fetchCognitoGroupBlastRadius(group.group_name);
        // A 502 here is the backend's own `mapping_check_unavailable` /
        // `mapping_check_unreadable` — coord could not say, so neither can
        // we. Render the CAUSE (`error` + coord's status), not the detail's
        // `message`: that prose is the DELETE's refusal ("Refused … Nothing
        // was deleted …"), written for the moment after a click, and in a
        // preview nothing was attempted.
        if (!res.ok) throw new Error(await blastRadiusReadCause(res));
        const verdict = parseBlastRadiusVerdict(await res.json());
        if (verdict === null) {
          throw new Error("the blast-radius body is not a verdict");
        }
        if (!cancelled) setBlastRadius({ state: "ok", verdict });
      } catch (err) {
        log.warn("read cognito group blast radius failed", err);
        if (!cancelled) {
          setBlastRadius({
            state: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [confirmOpen, group.group_name]);

  // A verdict the backend is CERTAIN to refuse: guard 1 (mapped; the
  // dashboard sends no `allow_mapped`) or guard 3 (stranded; no override
  // exists). Same reasoning as the `-home` gate below — a confirm that is
  // guaranteed to 409 teaches operators to click through and read the toast.
  // Unknown (`error`) deliberately does NOT disable: the backend re-runs the
  // check and refuses on its own if coord still cannot answer, so blocking
  // here would only turn a recoverable delete into a dead end.
  const verdictRefuses =
    blastRadius.state === "ok" &&
    (blastRadius.verdict.mapped_total > 0 ||
      blastRadius.verdict.strands_total > 0);

  const addUser = useCallback(async () => {
    const email = addEmail.trim();
    if (!email) {
      toast.error("Enter an email to add.");
      return;
    }
    setAdding(true);
    try {
      const res = await addCognitoGroupUser(group.group_name, email);
      if (res.status === 404) {
        toast.error("No Cognito user with that email; they must sign up first.");
        return;
      }
      if (res.status === 409) {
        toast.error(
          "Ambiguous email — more than one Cognito user matches. Resolve in Cognito first."
        );
        return;
      }
      if (!res.ok) {
        throw new Error(await backendErrorMessage(res));
      }
      toast.success(`Added ${email} to ${group.group_name}`);
      setAddEmail("");
      setExpanded(true);
      setMembersKey((k) => k + 1);
      onMembersChanged();
    } catch (err) {
      log.warn("add cognito group user failed", err);
      toast.error(
        `Add failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setAdding(false);
    }
  }, [addEmail, group.group_name, onMembersChanged]);

  const deleteGroup = useCallback(async () => {
    setDeleting(true);
    try {
      // `allow_home_group` is the ONE override the dashboard offers. There is
      // deliberately no `allow_mapped` control: when coord maps the group the
      // backend 409s and the fix is to remove the mapping first — that
      // ordering is the guard's whole purpose, and a checkbox would erase it.
      const res = await deleteCognitoGroup(group.group_name, {
        allowHomeGroup,
      });
      if (!res.ok) {
        throw new Error(await backendErrorMessage(res));
      }
      toast.success(`Deleted group ${group.group_name}`);
      setConfirmOpen(false);
      onDeleted();
    } catch (err) {
      log.warn("delete cognito group failed", err);
      toast.error(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        { duration: 12_000 }
      );
      setDeleting(false);
    }
  }, [group.group_name, allowHomeGroup, onDeleted]);

  const memberLabel = membersError
    ? "members unknown"
    : memberCount == null
      ? "counting members…"
      : `${memberCount} member${memberCount === 1 ? "" : "s"}`;

  return (
    <>
      <TableRow data-testid={`cognito-group-row-${group.group_name}`}>
        <TableCell className="font-medium align-top">
          <button
            type="button"
            className="flex items-center gap-1.5 hover:underline"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            data-testid={`cognito-group-toggle-${group.group_name}`}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
            {group.group_name}
          </button>
          {/* Blast radius — visible WITHOUT expanding the row, because the
              Delete button beside it is visible without expanding too. */}
          <div
            className="mt-1 flex flex-wrap items-center gap-1 pl-[1.375rem]"
            data-testid={`cognito-group-blast-${group.group_name}`}
          >
            <Badge
              variant={membersError ? "outline" : "secondary"}
              // Amber on the unknown arm, matching the `tenant mappings
              // unknown` badge rendered immediately to its right and the two
              // collapsed panel headers. Both halves of this blast radius fail
              // the same way and are read in one glance, so they must not
              // announce it in two different tones: `members unknown` in the
              // default foreground beside an amber `tenant mappings unknown`
              // reads as one caveat and one fact.
              className={`text-[0.7rem] font-normal${
                membersError ? " text-amber-600 dark:text-amber-400" : ""
              }`}
              data-testid={`cognito-group-members-count-${group.group_name}`}
            >
              <Users className="h-3 w-3" />
              {memberLabel}
            </Badge>
            {mappingsError ? (
              // A FAILED read is not an empty one. Rendering "no tenant
              // mappings" here would turn a suppressed error into the single
              // most reassuring thing this row can say, right beside Delete.
              <Badge
                variant="outline"
                className="text-[0.7rem] font-normal text-amber-600 dark:text-amber-400"
                data-testid={`cognito-group-mappings-unknown-${group.group_name}`}
              >
                <Building2 className="h-3 w-3" />
                tenant mappings unknown
              </Badge>
            ) : mappings === null ? (
              <Badge
                variant="outline"
                className="text-[0.7rem] font-normal text-muted-foreground"
                data-testid={`cognito-group-mappings-loading-${group.group_name}`}
              >
                <Building2 className="h-3 w-3" />
                reading tenant mappings…
              </Badge>
            ) : mappings.length === 0 ? (
              // "in your tenant", not "no tenant mappings": the section's read
              // is coord's TENANT-SCOPED list, so this badge cannot speak for
              // the pool. The confirmation dialog reads the pool-wide verdict
              // and is where the un-scoped sentence lives.
              <Badge
                variant="outline"
                className="text-[0.7rem] font-normal text-muted-foreground"
                data-testid={`cognito-group-unmapped-${group.group_name}`}
              >
                no mappings in your tenant
              </Badge>
            ) : (
              mappings.map((m) => {
                const renamedTo = historicalRenameTarget(m);
                return (
                  <Badge
                    key={`${m.tenant_slug}:${m.role}`}
                    variant="outline"
                    className={`text-[0.7rem] font-normal${
                      renamedTo !== null
                        ? " text-amber-600 dark:text-amber-400"
                        : ""
                    }`}
                    title={
                      renamedTo !== null
                        ? historicalSlugTooltip(renamedTo, "group-chip")
                        : undefined
                    }
                    data-testid={`cognito-group-mapping-${group.group_name}-${m.tenant_slug}-${m.role}`}
                  >
                    <Building2 className="h-3 w-3" />
                    {m.tenant_slug} · {tierLabel(m.role)}
                    {renamedTo !== null ? ` · renamed → ${renamedTo}` : null}
                  </Badge>
                );
              })
            )}
            {isHomeGroup ? (
              <Badge
                variant="outline"
                className="text-[0.7rem] font-normal text-amber-600 dark:text-amber-400"
                data-testid={`cognito-group-home-pin-${group.group_name}`}
              >
                <ShieldCheck className="h-3 w-3" />
                pins home → {homeTenantSlug}
              </Badge>
            ) : null}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground align-top">
          {group.description || "—"}
        </TableCell>
        <TableCell className="text-muted-foreground text-xs whitespace-nowrap align-top">
          {relativeTime(group.creation_date)}
        </TableCell>
        <TableCell className="text-right align-top">
          <DestructiveButton
            size="sm"
            disabled={deleting}
            onClick={() => {
              setAllowHomeGroup(false);
              setConfirmOpen(true);
            }}
            data-testid={`cognito-delete-group-${group.group_name}`}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </DestructiveButton>
        </TableCell>
      </TableRow>

      <ConfirmDestructiveDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!o) setAllowHomeGroup(false);
          setConfirmOpen(o);
        }}
        title={`Delete the Cognito group ${group.group_name}?`}
        description={
          <>
            This deletes the group from the <strong>shared</strong> Cognito
            pool. Cognito has no undo — re-creating the group does not restore
            its members, and every tenant keyed off this pool is affected.
            Members do not lose the roles it grants right away: each person&apos;s
            token stops carrying the group at their <strong>next login</strong>,
            so the effect arrives one person at a time, whenever they next sign
            in.
          </>
        }
        confirmLabel="Delete group"
        confirmPhrase={group.group_name}
        busy={deleting}
        // The `-home` acknowledgement is a HARD gate in the UI, not a hint:
        // the backend refuses without `allow_home_group`, and shipping a
        // confirm that is guaranteed to 409 would teach operators to click
        // through the dialog and read the toast instead. `verdictRefuses` is
        // the same rule applied to the two guards the dialog can now SEE.
        confirmDisabled={(isHomeGroup && !allowHomeGroup) || verdictRefuses}
        onConfirm={() => void deleteGroup()}
        extra={
          isHomeGroup ? (
            <label
              className="flex items-start gap-2 text-sm"
              htmlFor={`cognito-allow-home-${group.group_name}`}
            >
              <Checkbox
                id={`cognito-allow-home-${group.group_name}`}
                checked={allowHomeGroup}
                onCheckedChange={(v) => setAllowHomeGroup(v === true)}
                data-testid={`cognito-allow-home-${group.group_name}`}
              />
              <span>
                I understand this un-pins the home tenant for everyone in{" "}
                <span className="font-mono">{group.group_name}</span>.
              </span>
            </label>
          ) : null
        }
        testId={`cognito-delete-confirm-${group.group_name}`}
      >
        <p className="font-medium">What this affects</p>
        <ul className="list-disc pl-5 space-y-1">
          <li data-testid={`cognito-delete-confirm-members-${group.group_name}`}>
            {membersError
              ? "Member count could not be read — treat it as unknown, not zero."
              : memberCount == null
                ? "Counting members…"
                : `${memberCount} member${
                    memberCount === 1 ? "" : "s"
                  } lose this group at their next login.`}
          </li>
          {blastRadius.state === "error" ? (
            // The bullet that would otherwise say "nothing references this
            // group" is the one an operator reads as permission to proceed.
            // When the read failed we do not know that, so we say so — and we
            // name the guard that DOES know, so "unknown" does not read as
            // "unguarded". The confirm stays enabled deliberately: the backend
            // re-runs this same check and answers 502
            // `mapping_check_unavailable` if IT cannot read coord either, so
            // blocking here would only convert a recoverable delete into a
            // dead end while implying the dashboard is the guard.
            <li
              className="text-amber-700 dark:text-amber-400"
              data-testid={`cognito-delete-confirm-mappings-${group.group_name}`}
            >
              {/* The INSTRUCTION first, the cause last. The same ordering
                  the create-then-map orphan warning uses, and for the same
                  reason: what the operator must do outranks why, and only the
                  cause can be long. */}
              coord&apos;s blast radius could not be read — treat it as
              unknown, not as &ldquo;none&rdquo;. The delete is still checked
              server-side and will be refused if coord cannot answer there
              either. ({blastRadius.message})
            </li>
          ) : blastRadius.state !== "ok" ? (
            <li
              data-testid={`cognito-delete-confirm-mappings-${group.group_name}`}
            >
              Reading coord&apos;s pool-wide blast radius…
            </li>
          ) : blastRadius.verdict.mapped_total === 0 ? (
            // Now a TRUE sentence: this is coord's pool-wide answer, not the
            // caller's own tenant's slice of it.
            <li
              data-testid={`cognito-delete-confirm-mappings-${group.group_name}`}
            >
              No coord tenant mappings reference this group — pool-wide, not
              only in your tenant.
            </li>
          ) : (
            // The SAME testid rides every arm, so a query for it is total over
            // the state space; `queryByTestId(...) === null` never means
            // "there ARE mappings".
            <li
              data-testid={`cognito-delete-confirm-mappings-${group.group_name}`}
            >
              Mapped to{" "}
              <strong>
                {renderAffected(
                  blastRadius.verdict.mapped_own_tenant,
                  blastRadius.verdict.mapped_other_tenant_rows,
                  "mapping",
                  blastRadius.verdict.mapped_unmaterialized_rows
                )}
              </strong>{" "}
              in coord&apos;s group → tenant → role table (
              {plural(blastRadius.verdict.mapped_total, "mapping")} in all).
              The backend will refuse this delete until those mappings are
              removed
              {blastRadius.verdict.mapped_own_tenant.length
                ? " — the ones in your tenant, above"
                : " — by an administrator of the tenants they are in"}
              .
            </li>
          )}
          {blastRadius.state === "ok" &&
          blastRadius.verdict.strands_total > 0 ? (
            // Guard 3 has NO override, so this is the one bullet that is not
            // "remove something first, then come back": the fix is to grant
            // another group admin on the tenant. Named separately from the
            // mapping bullet because it counts TENANTS, not rows.
            <li
              className="text-amber-700 dark:text-amber-400"
              data-testid={`cognito-delete-confirm-strands-${group.group_name}`}
            >
              The only thing conferring admin on{" "}
              <strong>
                {renderAffected(
                  blastRadius.verdict.strands_own_tenant,
                  blastRadius.verdict.strands_other_tenant_count,
                  "tenant"
                )}
              </strong>{" "}
              ({plural(blastRadius.verdict.strands_total, "tenant")} in all).
              Deleting it would leave nobody able to repair the mapping; the
              backend refuses this with no override. Grant another group admin
              on them first.
            </li>
          ) : null}
          {isHomeGroup ? (
            <li>
              Pins its members&apos; home tenant to{" "}
              <span className="font-mono">{homeTenantSlug}</span>. Their home
              re-resolves at their next login.
            </li>
          ) : null}
        </ul>
      </ConfirmDestructiveDialog>

      {expanded && (
        // D2 — this row ALREADY expanded a full-width `colSpan` cell before
        // this plan reached it. What changes is only the host: the ad-hoc
        // `bg-muted/30` div becomes the shared `<RecordDetail>`, so a click on
        // a record looks the same here as on every other console page.
        <TableRow data-testid={`cognito-group-detail-${group.group_name}`}>
          <TableCell colSpan={4} className="p-0">
            <RecordDetail
              className="rounded-none border-x-0 border-b-0"
              why={
                <CognitoGroupMembers
                  key={membersKey}
                  groupName={group.group_name}
                  onChanged={onMembersChanged}
                />
              }
              actions={
              <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                <div className="space-y-1 flex-1 min-w-[200px]">
                  <Label htmlFor={`cognito-add-${group.group_name}`}>
                    Add user by email
                  </Label>
                  <Input
                    id={`cognito-add-${group.group_name}`}
                    type="email"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    placeholder="person@example.com"
                    data-testid={`cognito-add-email-${group.group_name}`}
                  />
                </div>
                <Button
                  size="sm"
                  onClick={addUser}
                  disabled={adding}
                  data-testid={`cognito-add-submit-${group.group_name}`}
                >
                  <UserPlus className="h-4 w-4" />
                  Add
                </Button>
              </div>
              }
              raw={
                <div className="break-all font-mono text-[10px] text-muted-foreground/60">
                  group: {group.group_name}
                  {group.precedence != null
                    ? ` · precedence: ${group.precedence}`
                    : ""}
                </div>
              }
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
