import { HttpClient } from './http-client';
import { ApiConfig } from './api-config';
import type {
  Project,
  ProjectCreate,
  ProjectUpdate,
} from '@/lib/api-client/types';

// Re-export types for backwards compatibility
export type { Project, ProjectCreate, ProjectUpdate };

export class ProjectService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  async getProjects(): Promise<Project[]> {
    console.log('[ProjectService] Fetching projects from:', `${this.apiUrl}/api/v1/projects/`);
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/projects/`);
    console.log('[ProjectService] Response status:', response.status);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[ProjectService] Failed to get projects:', {
        status: response.status,
        statusText: response.statusText,
        errorData,
      });
      throw new Error(`Failed to get projects: ${response.statusText}`);
    }
    const projects = await response.json();
    console.log('[ProjectService] Retrieved projects:', projects.length, 'projects');
    return projects;
  }

  async getProject(id: number): Promise<Project> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/projects/${id}`);
    if (!response.ok) {
      throw new Error('Failed to get project');
    }
    return response.json();
  }

  async createProject(data: ProjectCreate): Promise<Project> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/projects/`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Project creation failed:', {
        status: response.status,
        statusText: response.statusText,
        errorData,
      });
      throw new Error(`Failed to create project: ${JSON.stringify(errorData)}`);
    }
    return response.json();
  }

  async updateProject(id: number, data: ProjectUpdate): Promise<Project> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error('Failed to update project');
    }
    return response.json();
  }

  async deleteProject(id: number): Promise<void> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/projects/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete project');
    }
  }
}
