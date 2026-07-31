"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listOrganizations } from "@/lib/api/organizations";
import type { Organization } from "@/types/collaboration";
import {
  DevenvApiError,
  updateEnvironment,
  type Environment,
} from "@/services/devenv-api";

/** Sentinel Select value for "not shared" (Radix Select forbids empty value). */
const PERSONAL = "__personal__";

interface EnvironmentSharingControlProps {
  environment: Environment;
  /** The signed-in user's id, or null/undefined when not determinable. */
  currentUserId: string | null | undefined;
  /** Called with the updated environment after a successful share/unshare. */
  onEnvironmentChange: (environment: Environment) => void;
}

/**
 * Compact org-sharing control for an environment (P4 org sharing).
 *
 * Shows whether the environment is Personal or shared with one of the user's
 * organizations. The resource OWNER gets a selector to share it with an org
 * (or revert to personal) via `PATCH /environments/{id}` with
 * `organization_id` (explicit `null` unshares); non-owners see a read-only
 * badge — the backend enforces owner-only sharing regardless.
 */
export function EnvironmentSharingControl({
  environment,
  currentUserId,
  onEnvironmentChange,
}: EnvironmentSharingControlProps) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [saving, setSaving] = useState(false);

  // Owner-only control. When the current user is not determinable we still
  // render the selector and let the API enforce (it 403s non-owners).
  const isOwner =
    currentUserId == null || currentUserId === environment.owner_user_id;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const orgs = await listOrganizations();
        if (!cancelled) setOrganizations(orgs);
      } catch {
        // Org listing is auxiliary — the control degrades to showing ids.
        if (!cancelled) setOrganizations([]);
      } finally {
        if (!cancelled) setLoadingOrgs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sharedOrg = useMemo<Organization | null>(
    () =>
      environment.organization_id
        ? (organizations.find((o) => o.id === environment.organization_id) ??
          null)
        : null,
    [environment.organization_id, organizations]
  );

  const sharedLabel = environment.organization_id
    ? (sharedOrg?.name ?? `org ${environment.organization_id.slice(0, 8)}…`)
    : "Personal";

  const handleSelect = async (value: string) => {
    const organizationId = value === PERSONAL ? null : value;
    if (organizationId === environment.organization_id) return;
    setSaving(true);
    try {
      const updated = await updateEnvironment(environment.id, {
        organization_id: organizationId,
      });
      toast.success(
        organizationId
          ? `Shared with ${
              organizations.find((o) => o.id === organizationId)?.name ??
              "organization"
            }`
          : "Environment is now personal"
      );
      onEnvironmentChange(updated);
    } catch (err) {
      const message =
        err instanceof DevenvApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to update sharing";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (loadingOrgs) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading organizations…
      </div>
    );
  }

  // Non-owner, or an owner with no orgs to share into: read-only state.
  if (!isOwner || (organizations.length === 0 && !environment.organization_id)) {
    return (
      <div className="flex items-center gap-3">
        <Badge
          variant={environment.organization_id ? "brand-primary" : "secondary"}
          className="gap-1"
        >
          <Users className="size-3" />
          {sharedLabel}
        </Badge>
        {!isOwner && (
          <span className="text-xs text-muted-foreground">
            Only the owner can change sharing
          </span>
        )}
        {isOwner && organizations.length === 0 && (
          <span className="text-xs text-muted-foreground">
            Join or create an organization to share this environment
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Select
        value={environment.organization_id ?? PERSONAL}
        onValueChange={handleSelect}
        disabled={saving}
      >
        <SelectTrigger className="w-72">
          <SelectValue placeholder="Sharing" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PERSONAL}>Personal (only you)</SelectItem>
          {organizations.map((org) => (
            <SelectItem key={org.id} value={org.id}>
              {org.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {saving ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <Badge
          variant={environment.organization_id ? "brand-primary" : "secondary"}
          className="gap-1"
        >
          <Users className="size-3" />
          {sharedLabel}
        </Badge>
      )}
    </div>
  );
}
