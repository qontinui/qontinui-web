/**
 * Cloud-only collaboration components — slot-registered surface.
 *
 * The four cloud-only components (`OrganizationSwitcher`,
 * `CreateOrganizationDialog`, `TeamMemberList`, `InviteMemberDialog`)
 * no longer have OSS-side stub files. They are React components
 * registered by `@qontinui/cloud-control` into the component-slot
 * registry via `registerCloudExtensions({ components: { ... } })`. OSS
 * consumers retrieve them with `useSlotComponent<P>(slot)` and render
 * conditionally — `undefined` means single-tenant deploy with nothing
 * to render. Never `getComponent<P>(slot)` from a React component: it
 * is an unsubscribed read, so a slot filled after first render — the
 * normal case, the cloud-control bundle loads asynchronously — leaves
 * the consumer stale and the component silently never appears.
 *
 * This module re-exports just the prop contracts (defined in
 * `lib/cloud-component-slots.ts`) so callers can type the slot lookup
 * without reaching into `@/lib/cloud-component-slots` directly.
 * Implementations live exclusively in cloud-control.
 */

export type {
  OrganizationRole,
  OrganizationSwitcherProps,
  SwitcherOrganization,
  CreateOrganizationDialogProps,
  TeamMemberListProps,
  InviteMemberDialogProps,
  PendingInvitation,
} from "@/lib/cloud-component-slots";
