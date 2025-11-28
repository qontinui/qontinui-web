import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";
import { User } from "@/types/auth-types";

export interface ProfileUpdateData {
  full_name?: string;
  email?: string;
  company?: string;
  phone?: string;
}

export interface StorageUsage {
  used_bytes: number;
  total_bytes: number;
  used_percentage: number;
}

export interface ActivityLog {
  id: number;
  action: string;
  description: string;
  timestamp: string;
  ip_address?: string;
  user_agent?: string;
}

export class ProfileService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  async getProfile(): Promise<User> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/users/me`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to fetch profile");
    }

    return response.json();
  }

  async updateProfile(data: ProfileUpdateData): Promise<User> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/users/me`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to update profile");
    }

    return response.json();
  }

  async uploadAvatar(file: File): Promise<{ avatar_url: string }> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/users/me/avatar`,
      {
        method: "POST",
        headers: {}, // Let browser set Content-Type with boundary for FormData
        body: formData,
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to upload avatar");
    }

    return response.json();
  }

  async deleteAvatar(): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/users/me/avatar`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to delete avatar");
    }
  }

  async getStorageUsage(): Promise<StorageUsage> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/users/me/storage`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to fetch storage usage");
    }

    return response.json();
  }

  async getActivity(limit: number = 10): Promise<ActivityLog[]> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/users/me/activity?limit=${limit}`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to fetch activity logs");
    }

    return response.json();
  }
}
