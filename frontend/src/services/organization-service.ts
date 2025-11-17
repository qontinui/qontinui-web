import { HttpClient } from './http-client';
import type { Organization, OrganizationCreate } from '@/types/collaboration';

/**
 * OrganizationService
 * Handles all organization-related API calls
 */
export class OrganizationService {
  constructor(private httpClient: HttpClient) {}

  /**
   * Get all organizations for the current user
   */
  async getOrganizations(): Promise<Organization[]> {
    const response = await this.httpClient.get<Organization[]>('/organizations');
    return response.data;
  }

  /**
   * Get a specific organization by ID
   */
  async getOrganization(id: string): Promise<Organization> {
    const response = await this.httpClient.get<Organization>(`/organizations/${id}`);
    return response.data;
  }

  /**
   * Create a new organization
   */
  async createOrganization(name: string, description?: string): Promise<Organization> {
    const payload: OrganizationCreate = {
      name,
      description,
    };
    const response = await this.httpClient.post<Organization>('/organizations', payload);
    return response.data;
  }

  /**
   * Update an organization
   */
  async updateOrganization(
    id: string,
    updates: { name?: string; description?: string }
  ): Promise<Organization> {
    const response = await this.httpClient.patch<Organization>(`/organizations/${id}`, updates);
    return response.data;
  }

  /**
   * Delete an organization
   */
  async deleteOrganization(id: string): Promise<void> {
    await this.httpClient.delete(`/organizations/${id}`);
  }
}
