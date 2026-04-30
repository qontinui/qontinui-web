"use client";

/**
 * OSS-side stub for TeamMemberList.
 *
 * The full multi-org team list lives in
 * `@qontinui/cloud-control/components/collaboration/TeamMemberList`.
 * OSS self-host installs run with one auto-created default-org per user
 * (per `tmp_cloud_control_carve_out.md` §1 verdict #1) and don't show a
 * cross-team list. The stub renders `null` and exports the type names
 * `collaboration/index.ts` re-exports so existing OSS imports compile.
 */

export type MemberRole = "owner" | "admin" | "member" | "viewer";

export interface TeamMember {
  id: string;
  user_id: string;
  username?: string;
  email?: string;
  role: MemberRole;
}

interface TeamMemberListProps {
  members?: TeamMember[];
  currentUserId?: string;
  onRoleChange?: (userId: string, role: MemberRole) => void;
  onRemove?: (userId: string) => void;
}

export function TeamMemberList(_props: TeamMemberListProps): null {
  return null;
}
