/**
 * OSS-side stub for OrganizationService.
 *
 * The full multi-org-aware service lives in
 * `@qontinui/cloud-control/services/collaboration/organization-service`.
 * OSS self-host installs run with one auto-created default-org per user
 * (per `tmp_cloud_control_carve_out.md` §1 verdict #1), so there's no
 * multi-org list/switch/create surface to drive. The stub satisfies the
 * `ServiceFactory` wiring and the type contract that the OSS hooks
 * (`useOrganization`, `useProjectSharing`, etc.) currently call into.
 * Every method throws on use; nothing in OSS-only mode actually invokes
 * them because the cloud-control routes that drive these calls aren't
 * mounted.
 *
 * M2.5 follow-up will replace the hardcoded `OrganizationService`
 * reference in `service-factory.ts` with the slot pattern
 * (`getService("organizationService")`) so OSS doesn't even instantiate
 * this stub. Until then, this exists to keep `tsc --noEmit` green.
 */
import type { HttpClient } from "../http-client";

const NOT_AVAILABLE_ERROR =
  "OrganizationService is only available in the cloud-control deployment";

function notAvailable(): never {
  throw new Error(NOT_AVAILABLE_ERROR);
}

export class OrganizationService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_http: HttpClient) {}

  // The OSS callers (useOrganization, useProjectSharing, the hooks under
  // contexts/collaboration/) expect a broad surface. Every method here
  // throws synchronously when called; arguments are accepted but ignored.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  async getOrganizations(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async getOrganization(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async listOrganizations(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async createOrganization(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async updateOrganization(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async deleteOrganization(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async getMembers(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async listMembers(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async addMember(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async inviteMember(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async removeMember(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async updateMemberRole(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async transferOwnership(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async listInvitations(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async acceptInvitation(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  async cancelInvitation(..._args: unknown[]): Promise<any> {
    return notAvailable();
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
