import { HttpClient } from './http-client';
import { ApiConfig } from './api-config';
import type { Organization, OrganizationCreate, TeamMember, Invitation, InvitationCreate } from '@/types/collaboration';

/**
 * OrganizationService
 * Handles all organization-related API calls
 */
export class OrganizationService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  /**
   * Get all organizations for the current user
   */
  async getOrganizations(): Promise<Organization[]> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/organizations`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[OrganizationService] Failed to get organizations:', {
        status: response.status,
        statusText: response.statusText,
        errorData,
      });
      throw new Error(`Failed to get organizations: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get a specific organization by ID
   */
  async getOrganization(id: string): Promise<Organization> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/organizations/${id}`);
    if (!response.ok) {
      throw new Error('Failed to get organization');
    }
    return response.json();
  }

  /**
   * Create a new organization
   */
  async createOrganization(name: string, description?: string): Promise<Organization> {
    const payload: OrganizationCreate = {
      name,
      description,
    };
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/organizations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error('Failed to create organization');
    }
    return response.json();
  }

  /**
   * Update an organization
   */
  async updateOrganization(
    id: string,
    updates: { name?: string; description?: string }
  ): Promise<Organization> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/organizations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      throw new Error('Failed to update organization');
    }
    return response.json();
  }

  /**
   * Delete an organization
   */
  async deleteOrganization(id: string): Promise<void> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/organizations/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete organization');
    }
  }

  /**
   * Get members of an organization
   */
  async getMembers(organizationId: string): Promise<TeamMember[]> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/organizations/${organizationId}/members`);
    if (!response.ok) {
      throw new Error('Failed to get organization members');
    }
    return response.json();
  }

  /**
   * Add a member to an organization
   */
  async addMember(organizationId: string, userId: string, role: string): Promise<TeamMember> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/organizations/${organizationId}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, role }),
    });
    if (!response.ok) {
      throw new Error('Failed to add member');
    }
    return response.json();
  }

  /**
   * Update a member's role
   */
  async updateMemberRole(organizationId: string, memberId: string, role: string): Promise<TeamMember> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/organizations/${organizationId}/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    if (!response.ok) {
      throw new Error('Failed to update member role');
    }
    return response.json();
  }

  /**
   * Remove a member from an organization
   */
  async removeMember(organizationId: string, memberId: string): Promise<void> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/organizations/${organizationId}/members/${memberId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to remove member');
    }
  }

  /**
   * Get invitations for an organization
   */
  async getInvitations(organizationId: string): Promise<Invitation[]> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/organizations/${organizationId}/invitations`);
    if (!response.ok) {
      throw new Error('Failed to get invitations');
    }
    return response.json();
  }

  /**
   * Send an invitation
   */
  async sendInvitation(organizationId: string, invitation: InvitationCreate): Promise<Invitation> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/organizations/${organizationId}/invitations`, {
      method: 'POST',
      body: JSON.stringify(invitation),
    });
    if (!response.ok) {
      throw new Error('Failed to send invitation');
    }
    return response.json();
  }

  /**
   * Revoke an invitation
   */
  async revokeInvitation(organizationId: string, invitationId: string): Promise<void> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/organizations/${organizationId}/invitations/${invitationId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to revoke invitation');
    }
  }
}
