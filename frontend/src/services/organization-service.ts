import { HttpClient } from './http-client';
import { ApiConfig } from './api-config';
import type { Organization, OrganizationCreate } from '@/types/collaboration';

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
      throw new Error('Failed to get organizations');
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
}
