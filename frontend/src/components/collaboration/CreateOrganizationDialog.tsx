"use client";

/**
 * OSS-side stub for the create-organization dialog.
 *
 * The full dialog lives in
 * `@qontinui/cloud-control/components/collaboration/CreateOrganizationDialog`.
 * OSS self-host installs don't expose multi-org creation flows; the
 * default-org is auto-created at signup. The stub renders `null` so the
 * sidebar's lazy import resolves without breaking the OSS bundle.
 */

interface CreateOrganizationDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCreated?: (orgId: string) => void;
}

export function CreateOrganizationDialog(
  _props: CreateOrganizationDialogProps
): null {
  return null;
}
