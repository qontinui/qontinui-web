"use client";

/**
 * OSS-side stub for InviteMemberDialog.
 *
 * The full multi-org invitation flow lives in
 * `@qontinui/cloud-control/components/collaboration/InviteMemberDialog`.
 * OSS self-host installs run with one auto-created default-org per user
 * (per `tmp_cloud_control_carve_out.md` §1 verdict #1) and don't expose
 * org-invite UX. The stub renders `null` and exports the type names
 * `collaboration/index.ts` re-exports so existing OSS imports compile.
 */

export interface PendingInvitation {
  id: string;
  email: string;
  role: "owner" | "admin" | "member" | "viewer";
  created_at: string;
}

interface InviteMemberDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onInvited?: (invitation: PendingInvitation) => void;
}

export function InviteMemberDialog(_props: InviteMemberDialogProps): null {
  return null;
}
