"use client";

/**
 * /admin/coord/members — Members & Roles admin console.
 *
 * Unlike the rest of /admin/coord/* (which any authenticated tenant member may
 * VIEW, with mutation controls gated per-control via {@link CoordAdminOnly}),
 * this entire page is **admin-only**: it manages tenant membership and role
 * grants. A non-admin sees an "Administrator access required" notice instead of
 * the page body. The backend ALSO enforces admin on every mutating endpoint
 * (403), so this gate is the UX layer keeping the surface honest.
 *
 * Four sections:
 *  a. Your tenant + roles      — GET  /coord/my-tenants
 *  b. Members table            — GET  /coord/members
 *                                POST /coord/members/{operator_id}/roles
 *                                DELETE /coord/members/{operator_id}/roles
 *  c. Invite / pre-provision   — POST /coord/members
 *  d. Group → tenant → role    — GET  /coord/group-tenant-roles
 *                                POST /coord/group-tenant-roles
 *                                DELETE /coord/group-tenant-roles
 *
 * PRODUCT TIER ↔ coord role mapping (tier labels shown in UI, coord roles sent
 * to the API): Administrator ↔ `admin`, Developer ↔ `operator`. (A future
 * "Viewer" tier also maps to `operator` today; we keep the selector to the two
 * primary choices.)
 */

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Building2,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { useAuth } from "@/contexts/auth-context";
import { OPERATIONS_API, relativeTime } from "@/components/operations/utils";

const log = createLogger("CoordMembersPage");

// ---------------------------------------------------------------------------
// Tier ↔ coord role mapping
// ---------------------------------------------------------------------------

/** Coord role string. The wire contract uses bare role names. */
type CoordRole = "admin" | "operator";

interface TierOption {
  /** Coord role sent to the API. */
  role: CoordRole;
  /** Product-tier label shown in the UI. */
  label: string;
}

/** Primary tier choices offered in every role selector. */
const TIER_OPTIONS: TierOption[] = [
  { role: "admin", label: "Administrator" },
  { role: "operator", label: "Developer" },
];

/** Render a coord role as its product-tier label (falls back to the raw role). */
function tierLabel(role: string): string {
  const opt = TIER_OPTIONS.find((t) => t.role === role);
  return opt ? opt.label : role;
}

// ---------------------------------------------------------------------------
// Wire types — mirror the web backend's /coord/* proxy responses.
// ---------------------------------------------------------------------------

interface OperatorRow {
  operator_id: string;
  email: string;
  display_name: string | null;
  sso_provider: string | null;
  last_login_at: string | null;
  created_at: string | null;
  roles: string[];
}

interface MembersResponse {
  operators: OperatorRow[];
}

interface GroupTenantRoleRow {
  group_id: string;
  tenant_slug: string;
  role: string;
  auto_create_tenant: boolean;
  created_at: string | null;
  tenant_id: string | null;
}

interface GroupTenantRolesResponse {
  group_tenant_roles: GroupTenantRoleRow[];
}

interface TenantRoleEntry {
  tenant_id?: string;
  tenant_slug?: string;
  roles?: string[];
}

interface MyTenantsResponse {
  home_tenant_id?: string | null;
  home_tenant_slug?: string | null;
  tenants?: TenantRoleEntry[];
  roles?: string[];
}

// ---------------------------------------------------------------------------
// Tenant slug validation (matches the backend / coord constraint).
// ---------------------------------------------------------------------------

const TENANT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// ===========================================================================
// Section a — Your tenant + roles
// ===========================================================================

function MyTenantsCard() {
  const [data, setData] = useState<MyTenantsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await httpClient.fetch(`${OPERATIONS_API}/coord/my-tenants`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as MyTenantsResponse);
    } catch (err) {
      log.warn("load my-tenants failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card data-testid="coord-members-my-tenants">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4" />
          Your tenant &amp; roles
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-10 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        ) : data ? (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Home tenant:</span>
              <span className="font-medium">
                {data.home_tenant_slug ?? data.home_tenant_id ?? "—"}
              </span>
            </div>
            {data.tenants && data.tenants.length > 0 ? (
              <div className="space-y-1.5">
                {data.tenants.map((t, i) => (
                  <div
                    key={t.tenant_id ?? t.tenant_slug ?? i}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="font-medium">
                      {t.tenant_slug ?? t.tenant_id ?? "—"}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {(t.roles ?? []).map((r) => (
                        <Badge key={r} variant="secondary">
                          {tierLabel(r)}
                        </Badge>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            ) : data.roles && data.roles.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Roles:</span>
                {data.roles.map((r) => (
                  <Badge key={r} variant="secondary">
                    {tierLabel(r)}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No roles found.</p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Section b — Members table
// ===========================================================================

function MembersTable({
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
  const [pendingRole, setPendingRole] = useState<Record<string, CoordRole>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await httpClient.fetch(`${OPERATIONS_API}/coord/members`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MembersResponse;
      setOperators(json.operators ?? []);
    } catch (err) {
      log.warn("load members failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const grantRole = useCallback(
    async (operatorId: string, role: CoordRole) => {
      setBusy(operatorId);
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/coord/members/${encodeURIComponent(
            operatorId
          )}/roles`,
          { method: "POST", body: JSON.stringify({ role }) }
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status} ${text}`.trim());
        }
        toast.success(`Granted ${tierLabel(role)}`);
        await load();
        onChanged();
      } catch (err) {
        log.warn("grant role failed", err);
        toast.error(
          `Grant failed: ${err instanceof Error ? err.message : String(err)}`
        );
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
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/coord/members/${encodeURIComponent(
            operatorId
          )}/roles`,
          { method: "DELETE", body: JSON.stringify({ role }) }
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status} ${text}`.trim());
        }
        toast.success(`Revoked ${tierLabel(role)}`);
        await load();
        onChanged();
      } catch (err) {
        log.warn("revoke role failed", err);
        toast.error(
          `Revoke failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        setBusy(null);
      }
    },
    [load, onChanged]
  );

  return (
    <Card data-testid="coord-members-table-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Members
        </CardTitle>
      </CardHeader>
      <CardContent>
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
          <Table data-testid="coord-members-table">
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Display name</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="text-right">Grant tier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operators.map((op) => {
                const sel = pendingRole[op.operator_id] ?? "admin";
                const isBusy = busy === op.operator_id;
                return (
                  <TableRow key={op.operator_id}>
                    <TableCell className="font-medium">{op.email}</TableCell>
                    <TableCell>{op.display_name ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {op.roles.length === 0 ? (
                          <span className="text-muted-foreground text-xs">
                            none
                          </span>
                        ) : (
                          op.roles.map((r) => (
                            <Badge
                              key={r}
                              variant="secondary"
                              className="gap-1 pr-0.5"
                            >
                              {tierLabel(r)}
                              <DestructiveButton
                                size="icon"
                                aria-label={`Revoke ${tierLabel(r)}`}
                                title={`Revoke ${tierLabel(r)}`}
                                disabled={isBusy}
                                onClick={() => revokeRole(op.operator_id, r)}
                                className="ml-0.5 size-4 rounded-sm bg-transparent text-muted-foreground shadow-none hover:bg-destructive hover:text-white"
                                data-testid={`revoke-${op.operator_id}-${r}`}
                              >
                                <X className="h-3 w-3" />
                              </DestructiveButton>
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {relativeTime(op.last_login_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Select
                          value={sel}
                          onValueChange={(v) =>
                            setPendingRole((p) => ({
                              ...p,
                              [op.operator_id]: v as CoordRole,
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
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Section c — Invite / pre-provision
// ===========================================================================

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [ssoSubject, setSsoSubject] = useState("");
  const [ssoProvider, setSsoProvider] = useState("cognito");
  const [role, setRole] = useState<CoordRole>("admin");
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async () => {
    if (!email.trim() || !ssoSubject.trim()) {
      toast.error("Email and Cognito subject are required.");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        email: email.trim(),
        sso_subject: ssoSubject.trim(),
        sso_provider: ssoProvider.trim() || "cognito",
        roles: [role],
      };
      if (displayName.trim()) body.display_name = displayName.trim();
      const res = await httpClient.fetch(`${OPERATIONS_API}/coord/members`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} ${text}`.trim());
      }
      toast.success(`Invited ${email.trim()}`);
      setEmail("");
      setDisplayName("");
      setSsoSubject("");
      setSsoProvider("cognito");
      setRole("admin");
      onInvited();
    } catch (err) {
      log.warn("invite failed", err);
      toast.error(
        `Invite failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setSubmitting(false);
    }
  }, [email, displayName, ssoSubject, ssoProvider, role, onInvited]);

  return (
    <Card data-testid="coord-members-invite">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="h-4 w-4" />
          Invite / pre-provision a member
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
              data-testid="invite-email"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-display-name">Display name (optional)</Label>
            <Input
              id="invite-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jane Doe"
              data-testid="invite-display-name"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-sso-subject">Cognito subject (sub)</Label>
            <Input
              id="invite-sso-subject"
              value={ssoSubject}
              onChange={(e) => setSsoSubject(e.target.value)}
              placeholder="e.g. 9f2c…-uuid"
              data-testid="invite-sso-subject"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-sso-provider">SSO provider</Label>
            <Input
              id="invite-sso-provider"
              value={ssoProvider}
              onChange={(e) => setSsoProvider(e.target.value)}
              placeholder="cognito"
              data-testid="invite-sso-provider"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-tier">Initial tier</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as CoordRole)}
            >
              <SelectTrigger
                id="invite-tier"
                className="w-full"
                data-testid="invite-tier"
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
        </div>
        <p className="text-xs text-muted-foreground">
          The user must sign up in Cognito first — the{" "}
          <span className="font-medium">Cognito subject</span> is their Cognito{" "}
          <code className="text-[0.7rem]">sub</code> claim. Pre-provisioning here
          binds that subject to a tenant member + initial role so they have
          access the moment they sign in.
        </p>
        <div className="flex justify-end">
          <Button
            onClick={submit}
            disabled={submitting}
            data-testid="invite-submit"
          >
            <UserPlus className="h-4 w-4" />
            Invite
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Section d — Group → tenant → role mappings
// ===========================================================================

function GroupTenantRolesSection() {
  const [rows, setRows] = useState<GroupTenantRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Add-mapping form state.
  const [groupId, setGroupId] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [role, setRole] = useState<CoordRole>("operator");
  const [autoCreate, setAutoCreate] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const slugValid = tenantSlug === "" || TENANT_SLUG_RE.test(tenantSlug);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/coord/group-tenant-roles`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as GroupTenantRolesResponse;
      setRows(json.group_tenant_roles ?? []);
    } catch (err) {
      log.warn("load group-tenant-roles failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addMapping = useCallback(async () => {
    if (!groupId.trim() || !tenantSlug.trim()) {
      toast.error("Group ID and tenant slug are required.");
      return;
    }
    if (!TENANT_SLUG_RE.test(tenantSlug.trim())) {
      toast.error("Tenant slug must match ^[a-z0-9][a-z0-9-]{0,63}$.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await httpClient.fetch(
        `${OPERATIONS_API}/coord/group-tenant-roles`,
        {
          method: "POST",
          body: JSON.stringify({
            group_id: groupId.trim(),
            tenant_slug: tenantSlug.trim(),
            role,
            auto_create_tenant: autoCreate,
          }),
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status} ${text}`.trim());
      }
      toast.success("Mapping added");
      setGroupId("");
      setTenantSlug("");
      setRole("operator");
      setAutoCreate(true);
      await load();
    } catch (err) {
      log.warn("add mapping failed", err);
      toast.error(
        `Add failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setSubmitting(false);
    }
  }, [groupId, tenantSlug, role, autoCreate, load]);

  const deleteMapping = useCallback(
    async (row: GroupTenantRoleRow) => {
      const key = `${row.group_id}:${row.tenant_slug}:${row.role}`;
      setBusy(key);
      try {
        const res = await httpClient.fetch(
          `${OPERATIONS_API}/coord/group-tenant-roles`,
          {
            method: "DELETE",
            body: JSON.stringify({
              group_id: row.group_id,
              tenant_slug: row.tenant_slug,
              role: row.role,
            }),
          }
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status} ${text}`.trim());
        }
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

  return (
    <Card data-testid="coord-members-group-roles">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" />
          Group → tenant → role mappings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          This binds a Cognito group to a tenant + role; create the group and add
          users in the AWS Cognito console.
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
                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium">{row.group_id}</TableCell>
                    <TableCell>{row.tenant_slug}</TableCell>
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
                    <TableCell className="text-right">
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
                data-testid="map-group-id"
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
          </div>
          <div className="flex justify-end">
            <Button
              onClick={addMapping}
              disabled={submitting || !slugValid}
              data-testid="map-submit"
            >
              <Plus className="h-4 w-4" />
              Add mapping
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// Page — admin-gated shell
// ===========================================================================

export default function MembersPage() {
  const { isCoordAdmin, loading } = useAuth();
  // Bumped after any membership mutation so dependent sections refetch.
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  if (loading) {
    return (
      <div className="p-3 sm:p-6 space-y-4" data-testid="coord-members-page">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isCoordAdmin) {
    return (
      <div className="p-3 sm:p-6" data-testid="coord-members-page">
        <Card data-testid="coord-members-access-denied">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Lock className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-base font-semibold">
                Administrator access required
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Managing members and roles is restricted to tenant
                administrators. Ask an administrator for an Administrator-tier
                role if you need access.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="p-3 sm:p-6 space-y-4 max-w-5xl"
      data-testid="coord-members-page"
    >
      <MyTenantsCard />
      <MembersTable refreshKey={refreshKey} onChanged={bump} />
      <InviteForm onInvited={bump} />
      <GroupTenantRolesSection />
    </div>
  );
}
