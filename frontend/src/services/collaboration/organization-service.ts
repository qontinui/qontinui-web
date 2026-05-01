/**
 * OSS-side type contract for `OrganizationService`.
 *
 * No runtime class — OSS doesn't instantiate an organization service. The
 * real multi-org-aware implementation lives in
 * `@qontinui/cloud-control/services/collaboration/organization-service` and
 * is registered into the `getService("organizationService")` slot by
 * cloud-control's `index.ts` via `registerCloudExtensions`. The exported
 * `organizationService` symbol from `services/service-factory.ts` is a
 * Proxy that forwards method calls to that slot at access time; in
 * OSS-only builds the Proxy throws on use, which is fine because OSS-only
 * routes that drive these calls aren't mounted (the per-user default-org
 * bypass keeps OSS multi-org-free).
 *
 * Methods listed here are the union of what cloud-control's class exposes
 * and what OSS callers (`useOrganization`, `useProjectSharing`, the
 * collaboration contexts, the org-members hook) currently invoke. Loose
 * `Promise<any>` return types match the historical OSS stub so callers
 * compile without mass adaptation.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface OrganizationService {
  getOrganizations(...args: unknown[]): Promise<any>;
  getOrganization(...args: unknown[]): Promise<any>;
  listOrganizations(...args: unknown[]): Promise<any>;
  createOrganization(...args: unknown[]): Promise<any>;
  updateOrganization(...args: unknown[]): Promise<any>;
  deleteOrganization(...args: unknown[]): Promise<any>;
  getStatistics(...args: unknown[]): Promise<any>;
  getMembers(...args: unknown[]): Promise<any>;
  listMembers(...args: unknown[]): Promise<any>;
  addMember(...args: unknown[]): Promise<any>;
  inviteMember(...args: unknown[]): Promise<any>;
  removeMember(...args: unknown[]): Promise<any>;
  updateMemberRole(...args: unknown[]): Promise<any>;
  transferOwnership(...args: unknown[]): Promise<any>;
  listInvitations(...args: unknown[]): Promise<any>;
  acceptInvitation(...args: unknown[]): Promise<any>;
  cancelInvitation(...args: unknown[]): Promise<any>;
  switchOrganization(...args: unknown[]): Promise<any>;
  getCurrentOrganization(...args: unknown[]): unknown;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
