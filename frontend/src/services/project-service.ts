import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";
import type {
  Project,
  ProjectCreate,
  ProjectUpdate,
} from "@/lib/api-client/types";

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
    const url = `${this.apiUrl}/api/v1/projects`;
    console.log("[ProjectService] Fetching projects from:", url);

    const response = await this.httpClient.fetch(url);

    console.log("[ProjectService] Response:", {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[ProjectService] Failed to get projects:", {
        status: response.status,
        statusText: response.statusText,
        errorData,
      });
      throw new Error(`Failed to get projects: ${response.statusText}`);
    }
    const projects = await response.json();
    console.log("[ProjectService] Projects received:", projects?.length || 0);
    return projects;
  }

  async getProject(id: string): Promise<Project> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${id}`
    );
    if (!response.ok) {
      throw new Error("Failed to get project");
    }
    return response.json();
  }

  async createProject(data: ProjectCreate): Promise<Project> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects`,
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Project creation failed:", {
        status: response.status,
        statusText: response.statusText,
        errorData,
      });
      throw new Error(`Failed to create project: ${JSON.stringify(errorData)}`);
    }
    return response.json();
  }

  async updateProject(id: string, data: ProjectUpdate): Promise<Project> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    );
    if (!response.ok) {
      throw new Error("Failed to update project");
    }
    return response.json();
  }

  async deleteProject(id: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${id}`,
      {
        method: "DELETE",
      }
    );
    if (!response.ok) {
      throw new Error("Failed to delete project");
    }
  }

  /**
   * Import a configuration into a project.
   *
   * @param projectId - The project to import into
   * @param configuration - The configuration object to import
   * @param merge - If true, merge with existing config. If false, replace.
   */
  async importConfiguration(
    projectId: string,
    configuration: Record<string, unknown>,
    merge: boolean = false
  ): Promise<{ success: boolean; message: string; project_id: string }> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/export/${projectId}/import`,
      {
        method: "POST",
        body: JSON.stringify({ configuration, merge }),
      }
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[ProjectService] Import failed:", {
        status: response.status,
        statusText: response.statusText,
        errorData,
      });
      throw new Error(
        errorData.detail ||
          `Failed to import configuration: ${response.statusText}`
      );
    }
    return response.json();
  }

  /**
   * Get the raw configuration JSON for a project.
   */
  async getConfiguration(projectId: string): Promise<Record<string, unknown>> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/export/${projectId}/configuration`
    );
    if (!response.ok) {
      throw new Error("Failed to get project configuration");
    }
    return response.json();
  }
}
