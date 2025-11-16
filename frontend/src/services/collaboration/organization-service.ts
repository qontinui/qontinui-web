/**
 * Organization Service
 *
 * Handles organization management including:
 * - Creating and managing organizations
 * - Team member management
 * - Invitations and access control
 * - Organization switching
 */

import { HttpClient } from '../http-client';
import { ApiConfig } from '../api-config';
import type {
  Organization,
  OrganizationCreate,
  OrganizationUpdate,
  TeamMember,
  Invitation,
  InvitationCreate,
  MemberRole,
} from '@/types/collaboration';

export class OrganizationService {
  private httpClient: HttpClient;
  private apiUrl: string;
  private currentOrganization: Organization | null = null;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  // ============================================================================
  // Organization Management
  // ============================================================================

  /**
   * Create a new organization
   */
  async createOrganization(
    name: string,
    description?: string
  ): Promise<Organization> {
    const data: OrganizationCreate = { name, description };

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/organizations/`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to create organization');
    }

    const organization = await response.json();
    this.currentOrganization = organization;
    this.storeCurrentOrganization(organization);
    return organization;
  }

  /**
   * Get all organizations the user belongs to
   */
  async getOrganizations(): Promise<Organization[]> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/organizations/`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch organizations');
    }

    return response.json();
  }

  /**
   * Get a specific organization by ID
   */
  async getOrganization(id: string): Promise<Organization> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/organizations/${id}`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch organization');
    }

    return response.json();
  }

  /**
   * Update an organization
   */
  async updateOrganization(
    id: string,
    updates: OrganizationUpdate
  ): Promise<Organization> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/organizations/${id}`,
      {
        method: 'PUT',
        body: JSON.stringify(updates),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to update organization');
    }

    const organization = await response.json();
    
    // Update current organization if it's the one being updated
    if (this.currentOrganization?.id === id) {
      this.currentOrganization = organization;
      this.storeCurrentOrganization(organization);
    }

    return organization;
  }

  /**
   * Delete an organization
   */
  async deleteOrganization(id: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/organizations/${id}`,
      {
        method: 'DELETE',
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to delete organization');
    }

    // Clear current organization if it's the one being deleted
    if (this.currentOrganization?.id === id) {
      this.currentOrganization = null;
      this.clearCurrentOrganization();
    }
  }

  // ============================================================================
  // Member Management
  // ============================================================================

  /**
   * Invite a member to an organization
   */
  async inviteMember(
    orgId: string,
    email: string,
    role: MemberRole
  ): Promise<Invitation> {
    const data: InvitationCreate = { email, role };

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/organizations/${orgId}/invitations`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to send invitation');
    }

    return response.json();
  }

  /**
   * Get all members of an organization
   */
  async getMembers(orgId: string): Promise<TeamMember[]> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/organizations/${orgId}/members`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch members');
    }

    return response.json();
  }

  /**
   * Update a member's role
   */
  async updateMemberRole(
    orgId: string,
    userId: string,
    role: MemberRole
  ): Promise<TeamMember> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/organizations/${orgId}/members/${userId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ role }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to update member role');
    }

    return response.json();
  }

  /**
   * Remove a member from an organization
   */
  async removeMember(orgId: string, userId: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/organizations/${orgId}/members/${userId}`,
      {
        method: 'DELETE',
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to remove member');
    }
  }

  /**
   * Get pending invitations for an organization
   */
  async getInvitations(orgId: string): Promise<Invitation[]> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/organizations/${orgId}/invitations`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch invitations');
    }

    return response.json();
  }

  /**
   * Revoke an invitation
   */
  async revokeInvitation(orgId: string, invitationId: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/organizations/${orgId}/invitations/${invitationId}`,
      {
        method: 'DELETE',
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to revoke invitation');
    }
  }

  /**
   * Accept an invitation using a token
   */
  async acceptInvitation(token: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/invitations/${token}/accept`,
      {
        method: 'POST',
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || 'Failed to accept invitation');
    }
  }

  // ============================================================================
  // Current Organization Management
  // ============================================================================

  /**
   * Get the current organization
   */
  getCurrentOrganization(): Organization | null {
    if (!this.currentOrganization && typeof window !== 'undefined') {
      const stored = localStorage.getItem('current_organization');
      if (stored) {
        try {
          this.currentOrganization = JSON.parse(stored);
        } catch (error) {
          console.error('Failed to parse stored organization:', error);
          localStorage.removeItem('current_organization');
        }
      }
    }
    return this.currentOrganization;
  }

  /**
   * Switch to a different organization
   */
  async switchOrganization(orgId: string): Promise<void> {
    const organization = await this.getOrganization(orgId);
    this.currentOrganization = organization;
    this.storeCurrentOrganization(organization);
  }

  /**
   * Clear the current organization
   */
  clearCurrentOrganization(): void {
    this.currentOrganization = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('current_organization');
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Store current organization in localStorage
   */
  private storeCurrentOrganization(organization: Organization): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('current_organization', JSON.stringify(organization));
    }
  }
}
