"use client";

/**
 * OSS-side stub for the organization switcher.
 *
 * The full multi-org switcher lives in
 * `@qontinui/cloud-control/components/collaboration/OrganizationSwitcher`.
 * OSS self-host installs run with one auto-created default-org per user
 * (per `tmp_cloud_control_carve_out.md` §1 verdict #1) so there's nothing
 * to switch between. The stub renders `null` to keep the sidebar clean.
 *
 * The composed cloud-control deployment will surface a real switcher via
 * the `registerCloudExtensions` slot pattern (M2.5 follow-up).
 */

// Re-exported by `collaboration/index.ts` — keep the export here so
// downstream `import { Organization } from "@/components/collaboration"`
// continues to compile in OSS.
export interface Organization {
  id: string;
  name: string;
  avatar_url: undefined;
  member_count: number;
  role: "owner" | "admin" | "member" | "viewer";
}

type SwitcherOrg = Organization;

interface OrganizationSwitcherProps {
  organizations: SwitcherOrg[];
  currentOrganization: SwitcherOrg | null;
  onOrganizationChange: (orgId: string) => void;
  onCreateOrganization: () => void;
  loading: boolean;
  className?: string;
}

export function OrganizationSwitcher(_props: OrganizationSwitcherProps): null {
  return null;
}
