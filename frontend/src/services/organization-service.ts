/**
 * Organization Service
 *
 * Manages organization and team operations including:
 * - Creating and managing organizations
 * - Inviting and managing members
 * - Handling organization permissions
 */

import type {
  Organization,
  OrganizationMember,
  OrganizationRole,
  CreateOrganizationRequest,
  InviteMemberRequest,
} from '@/types/collaboration';
import { httpClient } from './http-client';

const API_BASE = '/api/organizations';

// ============================================================================
// Organization Service
// ============================================================================

class OrganizationService {
  /**
   * Get all organizations for the current user
   */
  async getOrganizations(): Promise<Organization[]> {
    const response = await httpClient.get<Organization[]>(API_BASE);
    return response;
  }

  /**
   * Get a specific organization by ID
   */
  async getOrganization(orgId: string): Promise<Organization> {
    const response = await httpClient.get<Organization>(`${API_BASE}/${orgId}`);
    return response;
  }

  /**
   * Create a new organization
   */
  async createOrganization(data: CreateOrganizationRequest): Promise<Organization> {
    const response = await httpClient.post<Organization>(API_BASE, data);
    return response;
  }

  /**
   * Update an organization
   */
  async updateOrganization(
    orgId: string,
    data: Partial<CreateOrganizationRequest>
  ): Promise<Organization> {
    const response = await httpClient.patch<Organization>(`${API_BASE}/${orgId}`, data);
    return response;
  }

  /**
   * Delete an organization
   */
  async deleteOrganization(orgId: string): Promise<void> {
    await httpClient.delete(`${API_BASE}/${orgId}`);
  }

  /**
   * Get members of an organization
   */
  async getMembers(orgId: string): Promise<OrganizationMember[]> {
    const response = await httpClient.get<OrganizationMember[]>(
      `${API_BASE}/${orgId}/members`
    );
    return response;
  }

  /**
   * Invite a member to an organization
   */
  async inviteMember(orgId: string, data: InviteMemberRequest): Promise<void> {
    await httpClient.post(`${API_BASE}/${orgId}/members/invite`, data);
  }

  /**
   * Update a member's role
   */
  async updateMemberRole(
    orgId: string,
    userId: string,
    role: OrganizationRole
  ): Promise<OrganizationMember> {
    const response = await httpClient.patch<OrganizationMember>(
      `${API_BASE}/${orgId}/members/${userId}`,
      { role }
    );
    return response;
  }

  /**
   * Remove a member from an organization
   */
  async removeMember(orgId: string, userId: string): Promise<void> {
    await httpClient.delete(`${API_BASE}/${orgId}/members/${userId}`);
  }

  /**
   * Leave an organization
   */
  async leaveOrganization(orgId: string): Promise<void> {
    await httpClient.post(`${API_BASE}/${orgId}/leave`);
  }

  /**
   * Get organization statistics
   */
  async getStatistics(orgId: string): Promise<{
    member_count: number;
    project_count: number;
    active_users_today: number;
    total_workflows: number;
  }> {
    const response = await httpClient.get(`${API_BASE}/${orgId}/statistics`);
    return response;
  }
}

// Export singleton instance
export const organizationService = new OrganizationService();
