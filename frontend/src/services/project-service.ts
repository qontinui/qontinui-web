import { HttpClient } from './http-client';
import { ApiConfig } from './api-config';

export interface Project {
  id: number;
  name: string;
  description?: string;
  configuration: any;
  owner_id: number;
  created_at: string;
  updated_at: string;
}

export class ProjectService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  async getProjects(): Promise<Project[]> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/projects/`);
    if (!response.ok) {
      throw new Error('Failed to get projects');
    }
    return response.json();
  }

  async getProject(id: number): Promise<Project> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/projects/${id}`);
    if (!response.ok) {
      throw new Error('Failed to get project');
    }
    return response.json();
  }

  async createProject(data: {
    name: string;
    description?: string;
    configuration: any;
  }): Promise<Project> {
    const response = await this.httpClient.fetch(`${this.apiUrl}/api/v1/projects/`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error('Failed to create project');
    }
    return response.json();
  }

  async updateProject(id: number, data: Partial<Project>): Promise<Project> {
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
