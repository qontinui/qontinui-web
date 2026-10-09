"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  createCognitoGroup,
  fetchCognitoGroups,
  fetchCognitoGroupUsers,
  fetchGroupTenantRoles,
  type CognitoGroupCreate,
  type CognitoGroupRow,
  type CognitoGroupUserRow,
  type GroupTenantRoleRow,
} from "@/lib/api/operations/cognitoGroups";
import { operationsErrorMessage } from "@/lib/api/operations/base";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";
import { CollapsiblePanel } from "@/components/console";
import {
  groupNameProblem,
  requireRows,
  suggestGroupName,
} from "../_lib/groupName";
import { GroupNameHint } from "./GroupNameHint";
import { CognitoGroupItem } from "./CognitoGroupItem";
import { log } from "../_lib/log";

/**
 * Calls `onMount` once, the first time it renders. Renders nothing.
 *
 * `CollapsiblePanel` UNMOUNTS its children while closed (Radix
 * `CollapsibleContent`, no `forceMount`), so a child's mount IS the "the
 * operator opened this panel" event. The panel owns its open state and
 * exposes no callback, and reaching for one would mean forking a shared
 * console primitive to serve one caller.
 */
function MountedOnce({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return null;
}

/**
 * Pool-wide Cognito group management. Superuser-only — pool-wide Cognito ops
 * require staff/superuser access. A coord admin who is NOT a superuser sees a
 * muted note instead of the controls.
 */
export function CognitoGroupsSection({
  isSuperuser,
  refreshKey = 0,
}: {
  isSuperuser: boolean;
  /** Bumped when a tenant slug changed elsewhere on the page: the mapping
   *  chips on each group name tenants by slug. */
  refreshKey?: number;
}) {
  const [groups, setGroups] = useState<CognitoGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Blast-radius inputs for the group ROWS. Section-level, not per-row,
  // because the row that needs them is the one that has NOT been expanded —
  // a per-row lazy fetch would arrive only after the operator had already
  // expanded, which is after the decision the numbers exist to inform.
  // `null` until the read lands: an initial `[]` would render as the positive
  // claim "no tenant mappings" for every group during the first paint, which
  // is the same fabrication a failed read makes, just shorter-lived.
  const [mappings, setMappings] = useState<GroupTenantRoleRow[] | null>(null);
  // Set when the `group-tenant-roles` read FAILED. Kept apart from `mappings`
  // for the same reason `memberErrors` is kept apart from `memberCounts` — a
  // failed read must render as "unknown", never as "none".
  const [mappingsError, setMappingsError] = useState(false);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  // Groups whose member probe FAILED. Kept apart from `memberCounts` so a
  // failed read renders as "unknown" rather than as a confident zero.
  const [memberErrors, setMemberErrors] = useState<Record<string, true>>({});
  const [countsToken, setCountsToken] = useState(0);
  // Wave 4 folded this section (`CollapsiblePanel defaultOpen={false}`) as
  // "the least-often-read section on the page". The group LIST still loads
  // eagerly, because the folded header badge counts it — but the blast-radius
  // reads are one coord query plus one AWS `list_users_in_group` PER GROUP,
  // and spending those on a panel nobody opened is pure waste. They wait for
  // the first open, which is also the first moment their output can be seen.
  const [panelOpened, setPanelOpened] = useState(false);
  const markPanelOpened = useCallback(() => setPanelOpened(true), []);

  // Create-group form state.
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);
  // Validated against the TRIMMED value because that is what `createGroup`
  // submits; an empty field shows nothing (the submit handler says "required").
  const newNameProblem =
    newName.trim() === "" ? null : groupNameProblem(newName.trim());
  const newNameSuggestion = newNameProblem
    ? suggestGroupName(newName.trim())
    : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCognitoGroups();
      // Same rule as the two `group-tenant-roles` reads: a 200 whose body is
      // not the list is UNKNOWN, not "no groups". `?? []` would render "No
      // Cognito groups yet." for a pool that may be full of them, and a
      // non-array body would reach `groups.map()` below and throw.
      setGroups(requireRows<CognitoGroupRow>(json?.groups, "cognito groups"));
    } catch (err) {
      log.warn("load cognito groups failed", err);
      setError(operationsErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // `refreshKey` too: a slug rename can create `<new>-home`, which this list
  // must then show.
  useEffect(() => {
    if (isSuperuser) void load();
  }, [load, isSuperuser, refreshKey]);

  // coord's group -> tenant -> role mappings. Read here as well as in the
  // section above: this is the reason the backend refuses a delete, so the
  // row that offers the delete has to show it.
  useEffect(() => {
    if (!isSuperuser || !panelOpened) return;
    let cancelled = false;
    void (async () => {
      try {
        const json = await fetchGroupTenantRoles();
        // A successful STATUS is not a successful READ. `group_tenant_roles`
        // is declared non-optional, so a `?? []` here is dead per the types
        // and live at runtime — and what it would fabricate is precisely the
        // absence claim this whole change exists to make unreachable. Treat a
        // malformed 200 as the failure it is and let the `catch` route it to
        // the unknown arm. (It also stops a non-array body throwing later,
        // inside the `.filter()` at the render site.)
        const rows = requireRows<GroupTenantRoleRow>(
          json?.group_tenant_roles,
          "group-tenant-roles"
        );
        if (!cancelled) {
          setMappings(rows);
          setMappingsError(false);
        }
      } catch (err) {
        // Non-fatal: the group list still renders. The backend enforces the
        // referential guard regardless of what this panel managed to show.
        //
        // But do NOT collapse the failure to `[]`. `mappings.length === 0` is
        // what renders "no tenant mappings" and "No coord tenant mappings
        // reference this group." beside a Delete button, so an emptied array
        // here would publish a suppressed error as a confident all-clear about
        // the exact blast radius this panel exists to show. Flag it instead.
        //
        // The flag WINS at both render sites, so on a failed REFRESH a row
        // that had shown real mappings degrades to "unknown" rather than
        // continuing to display rows we can no longer vouch for. That is the
        // same trade `memberCounts` makes (its map is replaced wholesale, so a
        // known count degrades to "members unknown" too), and it is the safe
        // direction: unknown is never a weaker warning than the truth.
        log.warn("load group-tenant-roles for blast radius failed", err);
        if (!cancelled) setMappingsError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperuser, panelOpened, countsToken, refreshKey]);

  // Member counts, one probe per group, in parallel.
  useEffect(() => {
    if (!isSuperuser || !panelOpened || groups.length === 0) return;
    let cancelled = false;
    void (async () => {
      const counts: Record<string, number> = {};
      const errors: Record<string, true> = {};
      await Promise.all(
        groups.map(async (g) => {
          try {
            const json = await fetchCognitoGroupUsers(g.group_name);
            // `memberErrors` is the mechanism #1111 held up as the model — a
            // failed probe becomes "members unknown" rather than a count. But
            // it is reached only from this `catch`, so a malformed 200 walked
            // straight past it: `(json.users ?? []).length` recorded a
            // confident `0 members` on the row that offers the pool-wide
            // Delete, with no error flag to contradict it. A non-array body was
            // worse still — `"nope".length` is 4, so the badge would have shown
            // a member count that was really a string length.
            //
            // Refusing the body here routes it to the same `catch`, which is
            // where the honest answer already lives.
            counts[g.group_name] = requireRows<CognitoGroupUserRow>(
              json?.users,
              "cognito group users"
            ).length;
          } catch (err) {
            log.warn("member count probe failed", g.group_name, err);
            errors[g.group_name] = true;
          }
        })
      );
      if (!cancelled) {
        setMemberCounts(counts);
        setMemberErrors(errors);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperuser, panelOpened, groups, countsToken]);

  const refreshBlastRadius = useCallback(
    () => setCountsToken((t) => t + 1),
    []
  );

  const createGroup = useCallback(async () => {
    const group_name = newName.trim();
    const namingProblem = groupNameProblem(group_name);
    if (namingProblem) {
      toast.error(namingProblem);
      return;
    }
    setCreating(true);
    try {
      const body: CognitoGroupCreate = { group_name };
      if (newDescription.trim()) body.description = newDescription.trim();
      try {
        await createCognitoGroup(body);
      } catch (err) {
        if (httpStatusOf(err) === 409) {
          toast.error(`A Cognito group named "${group_name}" already exists.`);
          return;
        }
        throw err;
      }
      toast.success(`Created group ${group_name}`);
      setNewName("");
      setNewDescription("");
      await load();
    } catch (err) {
      log.warn("create cognito group failed", err);
      // One prefix, not two — "Create failed:" here, and the backend's 400
      // already names the reason.
      toast.error(`Create failed: ${operationsErrorMessage(err)}`);
    } finally {
      setCreating(false);
    }
  }, [newName, newDescription, load]);

  return (
    // R7 — the identity-provider surface: the least-often-read section on the
    // page and, at a table plus a create form, one of the tallest.
    <div data-testid="coord-members-cognito-groups">
      <CollapsiblePanel
        title="Cognito Groups"
        icon={<KeyRound className="h-4 w-4" />}
        titleAs="h2"
        defaultOpen={false}
        storageKey="coord-members-cognito-groups"
        summary={
          <Badge
            variant="outline"
            className={`font-mono text-[11px]${
              error ? " text-amber-600 dark:text-amber-400" : ""
            }`}
            data-testid="coord-cognito-groups-summary"
          >
            <span className="font-normal text-muted-foreground">
              groups&nbsp;
            </span>
            {/* A failed read must not print `groups 0` on a collapsed panel —
              see the mappings badge above. This is the section that carries
              the pool-wide Delete, so "there is nothing here" is the last
              thing it should assert on a read that never landed. */}
            {loading ? "–" : error ? "unknown" : groups.length}
          </Badge>
        }
        contentClassName="space-y-4"
      >
        <>
          {/* Mounts only while the panel is open — that is the signal the
            blast-radius probes wait on. */}
          <MountedOnce onMount={markPanelOpened} />
          {!isSuperuser ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="cognito-groups-superuser-required"
            >
              Cognito group management requires staff/superuser access.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Bind a group to a tenant+role above, create the matching Cognito
                group here, then add members by email — no AWS console needed.
              </p>

              {/* Existing groups */}
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ) : error ? (
                <p className="text-sm text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" /> {error}
                </p>
              ) : groups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No Cognito groups yet.
                </p>
              ) : (
                <Table data-testid="coord-cognito-groups-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((g) => (
                      <CognitoGroupItem
                        key={g.group_name}
                        group={g}
                        mappings={
                          mappings === null
                            ? null
                            : mappings.filter(
                                (m) => m.group_id === g.group_name
                              )
                        }
                        mappingsError={mappingsError}
                        memberCount={
                          memberErrors[g.group_name]
                            ? undefined
                            : (memberCounts[g.group_name] ?? null)
                        }
                        membersError={memberErrors[g.group_name] === true}
                        onDeleted={load}
                        onMembersChanged={refreshBlastRadius}
                      />
                    ))}
                  </TableBody>
                </Table>
              )}

              {/* Create-group form */}
              <div className="border-t border-border pt-4 space-y-3">
                <p className="text-sm font-medium">Create group</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="cognito-new-name">Group name</Label>
                    <Input
                      id="cognito-new-name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g. qontinui-admins"
                      aria-invalid={newNameProblem !== null}
                      // Only while the hint is rendered — see the mapping form's
                      // Group ID input above.
                      aria-describedby={
                        newNameProblem !== null
                          ? "cognito-new-name-problem"
                          : undefined
                      }
                      data-testid="cognito-new-name"
                    />
                    <GroupNameHint
                      problem={newNameProblem}
                      suggestion={newNameSuggestion}
                      onAccept={setNewName}
                      testId="cognito-new-name-problem"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cognito-new-description">
                      Description (optional)
                    </Label>
                    <Input
                      id="cognito-new-description"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      placeholder="What this group is for"
                      data-testid="cognito-new-description"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={createGroup}
                    disabled={creating || newNameProblem !== null}
                    data-testid="cognito-create-submit"
                  >
                    <Plus className="h-4 w-4" />
                    Create group
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      </CollapsiblePanel>
    </div>
  );
}
