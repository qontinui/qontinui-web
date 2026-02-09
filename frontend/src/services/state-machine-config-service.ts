import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";

export interface StateMachineConfigSummary {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  updated_at: string;
}

export interface StateMachineConfigResponse {
  id: string;
  project_id: string;
  created_by: string;
  name: string;
  description: string | null;
  version: string;
  configuration: {
    states: unknown[];
    transitions: unknown[];
    fingerprintDetails?: Record<string, unknown>;
  };
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface StateMachineConfigListResponse {
  configs: StateMachineConfigSummary[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface StateMachineConfigCreateData {
  name: string;
  description?: string;
  configuration: Record<string, unknown>;
  tags?: string[];
}

export interface StateMachineConfigUpdateData {
  name?: string;
  description?: string;
  configuration?: Record<string, unknown>;
  tags?: string[];
}

export class StateMachineConfigService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  async list(
    projectId: string,
    limit = 50,
    offset = 0
  ): Promise<StateMachineConfigListResponse> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/state-machine-configs?limit=${limit}&offset=${offset}`
    );
    if (!response.ok)
      throw new Error(`Failed to list configs: ${response.statusText}`);
    return response.json();
  }

  async get(
    projectId: string,
    configId: string
  ): Promise<StateMachineConfigResponse> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/state-machine-configs/${configId}`
    );
    if (!response.ok)
      throw new Error(`Failed to get config: ${response.statusText}`);
    return response.json();
  }

  async create(
    projectId: string,
    data: StateMachineConfigCreateData
  ): Promise<StateMachineConfigResponse> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/state-machine-configs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }
    );
    if (!response.ok)
      throw new Error(`Failed to create config: ${response.statusText}`);
    return response.json();
  }

  async update(
    projectId: string,
    configId: string,
    data: StateMachineConfigUpdateData
  ): Promise<StateMachineConfigResponse> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/state-machine-configs/${configId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }
    );
    if (!response.ok)
      throw new Error(`Failed to update config: ${response.statusText}`);
    return response.json();
  }

  async delete(projectId: string, configId: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/projects/${projectId}/state-machine-configs/${configId}`,
      { method: "DELETE" }
    );
    if (!response.ok)
      throw new Error(`Failed to delete config: ${response.statusText}`);
  }
}
