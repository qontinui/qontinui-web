import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";
import type {
  Recording,
  RecordingListResponse,
  RecordingFrame,
  ProcessingJobStatus,
  DiscoveredStateStructure,
  UploadResponse,
  AcceptanceRequest,
  AcceptanceResponse,
  RecordingStatus,
} from "@/types/recording";

export class RecordingService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  /**
   * Upload a recording ZIP file
   */
  async uploadRecording(
    projectId: string,
    file: File,
    description?: string,
    tags?: string[],
    onProgress?: (progress: number) => void
  ): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append("project_id", projectId);
    formData.append("file", file);

    if (description) {
      formData.append("description", description);
    }

    if (tags && tags.length > 0) {
      formData.append("tags", JSON.stringify(tags));
    }

    console.log("[RecordingService] Uploading recording:", {
      projectId,
      fileName: file.name,
      fileSize: file.size,
    });

    // Use XMLHttpRequest for progress tracking
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = (e.loaded / e.total) * 100;
          onProgress(progress);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            console.log("[RecordingService] Upload successful:", response);
            resolve(response);
          } catch (error) {
            reject(new Error("Failed to parse response"));
          }
        } else {
          try {
            const error = JSON.parse(xhr.responseText);
            reject(new Error(error.detail || "Upload failed"));
          } catch {
            reject(new Error(`Upload failed: ${xhr.statusText}`));
          }
        }
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Network error during upload"));
      });

      xhr.addEventListener("abort", () => {
        reject(new Error("Upload cancelled"));
      });

      // Get auth token
      const accessToken = this.httpClient["tokenManager"].getAccessToken();

      xhr.open("POST", `${this.apiUrl}/api/v1/recordings/upload`);

      if (accessToken) {
        xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      }

      xhr.send(formData);
    });
  }

  /**
   * List recordings with optional filters
   */
  async listRecordings(
    projectId?: string,
    status?: RecordingStatus,
    skip: number = 0,
    limit: number = 100
  ): Promise<RecordingListResponse> {
    const params = new URLSearchParams({
      skip: skip.toString(),
      limit: limit.toString(),
    });

    if (projectId) {
      params.append("project_id", projectId);
    }

    if (status) {
      params.append("status", status);
    }

    console.log(
      "[RecordingService] Listing recordings:",
      Object.fromEntries(params)
    );

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/recordings/?${params.toString()}`
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[RecordingService] Failed to list recordings:", {
        status: response.status,
        statusText: response.statusText,
        errorData,
      });
      throw new Error(`Failed to list recordings: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get a single recording by ID
   */
  async getRecording(recordingId: string): Promise<Recording> {
    console.log("[RecordingService] Getting recording:", recordingId);

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/recordings/${recordingId}`
    );

    if (!response.ok) {
      throw new Error("Failed to get recording");
    }

    return response.json();
  }

  /**
   * Get frames for a recording
   */
  async getRecordingFrames(
    recordingId: string,
    skip: number = 0,
    limit: number = 100
  ): Promise<RecordingFrame[]> {
    const params = new URLSearchParams({
      skip: skip.toString(),
      limit: limit.toString(),
    });

    console.log("[RecordingService] Getting frames:", {
      recordingId,
      skip,
      limit,
    });

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/recordings/${recordingId}/frames?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error("Failed to get recording frames");
    }

    return response.json();
  }

  /**
   * Start processing a recording
   */
  async startProcessing(
    recordingId: string
  ): Promise<{ success: boolean; message: string }> {
    console.log("[RecordingService] Starting processing:", recordingId);

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/recordings/${recordingId}/process`,
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to start processing");
    }

    return response.json();
  }

  /**
   * Get processing status
   */
  async getProcessingStatus(recordingId: string): Promise<ProcessingJobStatus> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/recordings/${recordingId}/status`
    );

    if (!response.ok) {
      throw new Error("Failed to get processing status");
    }

    return response.json();
  }

  /**
   * Poll processing status until complete
   */
  async pollProcessingStatus(
    recordingId: string,
    onUpdate?: (status: ProcessingJobStatus) => void,
    intervalMs: number = 2000
  ): Promise<ProcessingJobStatus> {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const status = await this.getProcessingStatus(recordingId);

          if (onUpdate) {
            onUpdate(status);
          }

          // Check if complete or failed
          if (status.status === "completed") {
            resolve(status);
            return;
          } else if (
            status.status === "failed" ||
            status.status === "cancelled"
          ) {
            reject(new Error(status.error || "Processing failed"));
            return;
          }

          // Continue polling
          setTimeout(poll, intervalMs);
        } catch (error) {
          reject(error);
        }
      };

      poll();
    });
  }

  /**
   * Get discovered state structure
   */
  async getStateStructure(
    recordingId: string
  ): Promise<DiscoveredStateStructure> {
    console.log("[RecordingService] Getting state structure:", recordingId);

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/recordings/${recordingId}/state-structure`
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to get state structure");
    }

    return response.json();
  }

  /**
   * Accept discovered state structure
   */
  async acceptStateStructure(
    recordingId: string,
    request: AcceptanceRequest
  ): Promise<AcceptanceResponse> {
    console.log("[RecordingService] Accepting state structure:", {
      recordingId,
      request,
    });

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/recordings/${recordingId}/state-structure/review`,
      {
        method: "POST",
        body: JSON.stringify(request),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to accept state structure");
    }

    return response.json();
  }

  /**
   * Delete a recording
   */
  async deleteRecording(recordingId: string): Promise<void> {
    console.log("[RecordingService] Deleting recording:", recordingId);

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/recordings/${recordingId}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      throw new Error("Failed to delete recording");
    }
  }
}
