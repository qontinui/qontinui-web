"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  AlertTriangle,
  ArrowRightLeft,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  createCognitoGroup,
  createGroupTenantRole,
  deleteGroupTenantRole,
  fetchGroupTenantRoles,
} from "@/lib/api/operations/cognitoGroups";
import { CollapsiblePanel } from "@/components/console";
import type {
  CoordRole,
  GroupTenantRoleRow,
  GroupTenantRolesResponse,
} from "../_types";
import {
  groupNameProblem,
  requireRows,
  suggestGroupName,
} from "../_lib/groupName";
import {
  historicalRenameTarget,
  historicalSlugTooltip,
  TENANT_SLUG_RE,
  TIER_OPTIONS,
  tierLabel,
} from "../_lib/tenantLabels";
import { backendErrorMessage } from "@/lib/errors/backend-error-message";
import { GroupNameHint } from "./GroupNameHint";
import { log } from "../_lib/log";

// ===========================================================================
// Section d — Group → tenant → role mappings
// ===========================================================================

export function GroupTenantRolesSection({
  isSuperuser,
  refreshKey = 0,
}: {
  isSuperuser: boolean;
  /** Bumped when a tenant slug changed elsewhere on the page. */
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<GroupTenantRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Add-mapping form state.
  const [groupId, setGroupId] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [role, setRole] = useState<CoordRole>("operator");
  const [autoCreate, setAutoCreate] = useState(true);
  // Create the Cognito group as part of the same action (superuser-only — pool
  // -wide group creation requires staff access). Folds the previously-separate
  // "create group" then "add mapping" steps into one, so a mapping can never be
  // added for a group that doesn't exist.
  const [alsoCreateGroup, setAlsoCreateGroup] = useState(isSuperuser);
  const [submitting, setSubmitting] = useState(false);

  const slugValid = tenantSlug === "" || TENANT_SLUG_RE.test(tenantSlug);
  // Validated against the TRIMMED value because that is what `addMapping`
  // submits — validating the raw text would flag a trailing space the request
  // never carries.
  const groupIdProblem =
    groupId.trim() === "" ? null : groupNameProblem(groupId.trim());
  const groupIdSuggestion = groupIdProblem
    ? suggestGroupName(groupId.trim())
    : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchGroupTenantRoles();
      if (!res.ok) throw new Error(await backendErrorMessage(res));
      const json = (await res.json()) as GroupTenantRolesResponse;
      // A successful STATUS is not a successful READ — the same rule the
      // blast-radius read of this SAME endpoint applies below. `?? []` is dead
      // per the types (`group_tenant_roles` is declared non-optional) and live
      // at runtime, and what it fabricates is "No mappings yet." from a body
      // that never carried the table. It also stops a non-array body reaching
      // `rows.map()` at the render site, where `.length` succeeds on a string
      // and `.map` then throws, taking the panel down.
      setRows(
        requireRows<GroupTenantRoleRow>(
          json?.group_tenant_roles,
          "group-tenant-roles"
        )
      );
    } catch (err) {
      log.warn("load group-tenant-roles failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const addMapping = useCallback(async () => {
    if (!groupId.trim() || !tenantSlug.trim()) {
      toast.error("Group ID and tenant slug are required.");
      return;
    }
    if (!TENANT_SLUG_RE.test(tenantSlug.trim())) {
      toast.error("Tenant slug must match ^[a-z0-9][a-z0-9-]{0,63}$.");
      return;
    }
    const gid = groupId.trim();
    // The Group ID becomes a Cognito group name whenever "Also create" is on,
    // and coord's mapping is keyed on it either way — so a name Cognito can
    // never hold is wrong on both halves, whichever half runs.
    const namingProblem = groupNameProblem(gid);
    if (namingProblem) {
      toast.error(namingProblem);
      return;
    }
    setSubmitting(true);
    try {
      const slug = tenantSlug.trim();
      // Step 1 (optional, superuser-only): ensure the Cognito group exists, so
      // the mapping is never orphaned. A pre-existing group (409) is fine.
      let groupCreated = false;
      let groupReused = false;
      if (alsoCreateGroup && isSuperuser) {
        const gres = await createCognitoGroup({
          group_name: gid,
          description: `${tierLabel(role)} for ${slug}`,
        });
        if (gres.status === 409) {
          // Reusing an existing group is correct — SAYING so is the fix. This
          // arm used to be silent, and the success toast then read "Mapping
          // added", so the operator could not tell a group that was created
          // from one that was quietly reused.
          groupReused = true;
        } else if (!gres.ok) {
          // ONE prefix, not two. `backendErrorMessage` returns the backend's
          // own sentence — and since #1099's follow-up a malformed name is a
          // 400 that names the real reason — while the `catch` below adds
          // "Add failed:". Nesting `HTTP 400 {"detail":…}` in between made the
          // reason the least readable part of the line.
          throw new Error(await backendErrorMessage(gres));
        } else {
          groupCreated = true;
        }
      }
      // Step 2: the group → tenant → role mapping.
      const res = await createGroupTenantRole({
        group_id: gid,
        tenant_slug: slug,
        role,
        auto_create_tenant: autoCreate,
      });
      if (!res.ok) {
        const reason = await backendErrorMessage(res);
        // A partial failure LEAVES A POOL-WIDE GROUP BEHIND. Reporting only
        // the mapping failure hides an orphan that a non-superuser cannot even
        // see, let alone clean up — so the message has to name it.
        //
        // The orphan comes FIRST. It used to trail the backend's reason, which
        // was harmless while an over-long reason collapsed to `HTTP 500`, and
        // is not now that a long one is truncated rather than refused: the
        // clean-up instruction would sit behind up to 2000 characters in a
        // toast. The consequence the operator has to act on outranks the cause.
        throw new Error(
          groupCreated
            ? `The Cognito group "${gid}" WAS created and is now unmapped — delete it in the Cognito Groups section below if you are not about to retry. The mapping failed because: ${reason}`
            : reason
        );
      }
      toast.success(
        groupCreated
          ? `Group "${gid}" created + mapping added`
          : groupReused
            ? `Group "${gid}" already existed; mapping added`
            : "Mapping added"
      );
      setGroupId("");
      setTenantSlug("");
      setRole("operator");
      setAutoCreate(true);
      setAlsoCreateGroup(isSuperuser);
      await load();
    } catch (err) {
      log.warn("add mapping failed", err);
      toast.error(
        `Add failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    groupId,
    tenantSlug,
    role,
    autoCreate,
    alsoCreateGroup,
    isSuperuser,
    load,
  ]);

  const deleteMapping = useCallback(
    async (row: GroupTenantRoleRow) => {
      const key = `${row.group_id}:${row.tenant_slug}:${row.role}`;
      setBusy(key);
      try {
        const res = await deleteGroupTenantRole({
          group_id: row.group_id,
          tenant_slug: row.tenant_slug,
          role: row.role,
        });
        if (!res.ok) throw new Error(await backendErrorMessage(res));
        toast.success("Mapping deleted");
        await load();
      } catch (err) {
        log.warn("delete mapping failed", err);
        toast.error(
          `Delete failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  /**
   * Re-point a mapping stored under a historical slug at the tenant's current
   * slug — the two steps the hint's tooltip names, in the order that never
   * drops the grant: POST under `currentSlug` first (coord's POST is an upsert
   * on `(group_id, tenant_slug, role)`, so an already-present current-slug row
   * is fine), and only once that landed DELETE the stored row by its STORED
   * `tenant_slug`. A failed create leaves the old row untouched; a failed
   * delete leaves BOTH rows granting the same role, which is harmless but must
   * be said, because the historical row is still there to clean up.
   */
  const moveMapping = useCallback(
    async (row: GroupTenantRoleRow, currentSlug: string) => {
      const key = `${row.group_id}:${row.tenant_slug}:${row.role}`;
      setBusy(key);
      // The upsert also OVERWRITES `auto_create_tenant` on a row that already
      // exists under the current slug, so keep that row's own value rather
      // than silently changing a row the operator never touched.
      const existing = rows.find(
        (r) =>
          r.group_id === row.group_id &&
          r.tenant_slug === currentSlug &&
          r.role === row.role
      );
      try {
        const res = await createGroupTenantRole({
          group_id: row.group_id,
          tenant_slug: currentSlug,
          role: row.role,
          auto_create_tenant:
            existing?.auto_create_tenant ?? row.auto_create_tenant,
        });
        if (!res.ok) {
          throw new Error(
            `${await backendErrorMessage(res)} The mapping under ${row.tenant_slug} is unchanged.`
          );
        }
        const del = await deleteGroupTenantRole({
          group_id: row.group_id,
          tenant_slug: row.tenant_slug,
          role: row.role,
        });
        if (!del.ok) {
          const reason = await backendErrorMessage(del);
          toast.error(
            `Mapping re-created under ${currentSlug}, but the old row under ${row.tenant_slug} was NOT deleted and still grants at every login — delete it from this table. Delete failed because: ${reason}`
          );
          return;
        }
        toast.success(`Mapping moved to ${currentSlug}`);
      } catch (err) {
        log.warn("move mapping failed", err);
        toast.error(
          `Move failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        // Reload on every outcome: even a failed move may have changed the
        // table (the create landed, the delete did not). The row stays busy
        // until the reload settles, so a second click cannot re-run the move
        // against the table it just changed.
        await load();
        setBusy(null);
      }
    },
    [load, rows]
  );

  // Only a settled, successful read counts — a failed or loading read has no
  // rows to judge, and the count badge already says "unknown" / "–" for it.
  const historicalCount =
    loading || error
      ? 0
      : rows.filter((r) => historicalRenameTarget(r) !== null).length;

  return (
    // R7 — infrastructural SSO wiring, below the members table and behind a
    // click. The mapping COUNT stays on the header while closed: an empty
    // mapping set is the thing a reader might need to notice without opening.
    <div data-testid="coord-members-group-roles">
    <CollapsiblePanel
      title="Group → tenant → role mappings"
      icon={<ShieldCheck className="h-4 w-4" />}
      titleAs="h2"
      defaultOpen={false}
      storageKey="coord-members-group-roles"
      summary={(
        <>
        <Badge
          variant="outline"
          className={`font-mono text-[11px]${
            error ? " text-amber-600 dark:text-amber-400" : ""
          }`}
          data-testid="coord-group-roles-summary"
        >
          <span className="font-normal text-muted-foreground">mappings&nbsp;</span>
          {/* `rows.length` is 0 both when the read said "none" and when it
              FAILED, and this panel is `defaultOpen={false}` — so the error
              text below is hidden and this badge is the whole story an
              operator gets. Printing `0` there states the most reassuring
              possible answer on the strength of a read that did not land. The
              comment above says the count is here precisely so an empty set
              can be noticed WITHOUT opening; that is exactly what makes the
              false `0` worth closing. */}
          {loading ? "–" : error ? "unknown" : rows.length}
        </Badge>
        {/* A historical-slug row still grants at every login, and its hint and
            "Move to" button live in the table this panel hides by default —
            so the header says how many there are, as it does for the count. */}
        {historicalCount > 0 ? (
          <Badge
            variant="outline"
            className="font-mono text-[11px] text-amber-600 dark:text-amber-400"
            title="Mappings stored under a slug their tenant was renamed away from. Open this panel and use “Move to” on each."
            data-testid="coord-group-roles-historical-summary"
          >
            {historicalCount} on a renamed slug
          </Badge>
        ) : null}
        </>
      )}
      contentClassName="space-y-4"
    >
      <>
        <p className="text-xs text-muted-foreground">
          Binds a Cognito group to a tenant + role.{" "}
          {isSuperuser
            ? "With “Also create Cognito group” checked, the group is created in the same step — then add members in the Cognito Groups section below."
            : "Create the group in the Cognito Groups section (or AWS console) first; group creation requires staff access."}
        </p>

        {/* Existing mappings */}
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No mappings yet.</p>
        ) : (
          <Table data-testid="coord-group-roles-table">
            <TableHeader>
              <TableRow>
                <TableHead>Group ID</TableHead>
                <TableHead>Tenant slug</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Auto-create</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const key = `${row.group_id}:${row.tenant_slug}:${row.role}`;
                const renamedTo = historicalRenameTarget(row);
                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium">{row.group_id}</TableCell>
                    <TableCell>
                      {row.tenant_slug}
                      {renamedTo !== null ? (
                        <Badge
                          variant="outline"
                          className="ml-2 text-[0.7rem] font-normal text-amber-600 dark:text-amber-400"
                          title={historicalSlugTooltip(renamedTo, "table-row")}
                          data-testid={`group-tenant-role-historical-${row.group_id}-${row.tenant_slug}-${row.role}`}
                        >
                          renamed → {renamedTo}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{tierLabel(row.role)}</Badge>
                    </TableCell>
                    <TableCell>
                      {row.auto_create_tenant ? (
                        <Badge variant="success">yes</Badge>
                      ) : (
                        <Badge variant="outline">no</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {renamedTo !== null ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === key}
                          onClick={() => void moveMapping(row, renamedTo)}
                          title={`Re-create this mapping under ${renamedTo}, then delete the row stored under ${row.tenant_slug}.`}
                          data-testid={`move-mapping-${key}`}
                        >
                          <ArrowRightLeft className="h-4 w-4" />
                          Move to {renamedTo}
                        </Button>
                      ) : null}
                      <DestructiveButton
                        size="sm"
                        disabled={busy === key}
                        onClick={() => deleteMapping(row)}
                        data-testid={`delete-mapping-${key}`}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </DestructiveButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Add-mapping form */}
        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-sm font-medium">Add mapping</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="map-group-id">Group ID</Label>
              <Input
                id="map-group-id"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                placeholder="e.g. qontinui-admins"
                aria-invalid={groupIdProblem !== null}
                // Only while the hint is rendered — `aria-describedby` naming
                // an absent id describes the field with nothing.
                aria-describedby={
                  groupIdProblem !== null ? "map-group-id-problem" : undefined
                }
                data-testid="map-group-id"
              />
              <GroupNameHint
                problem={groupIdProblem}
                suggestion={groupIdSuggestion}
                onAccept={setGroupId}
                testId="map-group-id-problem"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="map-tenant-slug">Tenant slug</Label>
              <Input
                id="map-tenant-slug"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                placeholder="e.g. acme-corp"
                aria-invalid={!slugValid}
                data-testid="map-tenant-slug"
              />
              {!slugValid && (
                <p className="text-xs text-destructive">
                  Must match ^[a-z0-9][a-z0-9-]{"{"}0,63{"}"}$
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="map-role">Role tier</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as CoordRole)}
              >
                <SelectTrigger
                  id="map-role"
                  className="w-full"
                  data-testid="map-role"
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
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={autoCreate}
                  onCheckedChange={(c) => setAutoCreate(c === true)}
                  data-testid="map-auto-create"
                />
                Auto-create tenant
              </label>
            </div>
            {isSuperuser && (
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={alsoCreateGroup}
                    onCheckedChange={(c) => setAlsoCreateGroup(c === true)}
                    data-testid="map-also-create-group"
                  />
                  Also create Cognito group
                </label>
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <Button
              onClick={addMapping}
              disabled={submitting || !slugValid || groupIdProblem !== null}
              data-testid="map-submit"
            >
              <Plus className="h-4 w-4" />
              Add mapping
            </Button>
          </div>
        </div>
      </>
    </CollapsiblePanel>
    </div>
  );
}
