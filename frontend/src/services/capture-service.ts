import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";
import type {
  CaptureSession,
  CaptureSessionApi,
  InputEvent,
  InputEventApi,
} from "@/types/capture";
import {
  transformCaptureSession,
  transformInputEvent,
} from "@/types/capture";

export interface CaptureSessionListResponse {
  sessions: CaptureSession[];
  total: number;
}

export interface SaveScreenshotToProjectRequest {
  name: string;
  description?: string;
  tags?: string[];
  imageData: string; // base64 encoded image
}

export class CaptureService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  /**
   * Get capture sessions for a project
   * Uses the qontinui-web backend endpoint which supports UUID project IDs
   */
  async getSessionsForProject(
    projectId: string,
    limit: number = 100
  ): Promise<CaptureSessionListResponse> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/capture-sessions?project_id=${projectId}&limit=${limit}`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to fetch capture sessions");
    }

    const data = await response.json();
    // Backend returns { items: [...], total, limit, offset }
    const items = data.items || [];

    // Transform web backend capture sessions to frontend format
    // These are screenshot-based sessions, not video capture sessions
    const sessions: CaptureSession[] = items.map((item: any) => ({
      id: 0, // UUID-based, using 0 as placeholder
      sessionId: item.id, // UUID
      projectId: undefined,
      workflowId: undefined,
      name: item.name || `Capture Session`,
      description: item.description,
      videoUrl: "", // Screenshot sessions don't have video
      duration: 0,
      durationMs: 0,
      videoWidth: 0,
      videoHeight: 0,
      videoFps: 0,
      totalFrames: item.screenshot_count || 0,
      isComplete: item.status === "completed",
      isProcessed: item.status === "completed",
      createdAt: item.created_at,
      endedAt: item.completed_at,
      notes: item.description,
      tags: [],
      stats: {
        totalEvents: 0,
        mouseClicks: 0,
        mouseMoves: 0,
        keyPresses: 0,
        scrolls: 0,
        dragOperations: 0,
      },
    }));

    return {
      sessions,
      total: data.total || sessions.length,
    };
  }

  /**
   * Get a single capture session by session_id
   */
  async getSession(sessionId: string): Promise<CaptureSession> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/capture/sessions/${sessionId}`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to fetch capture session");
    }

    const apiSession: CaptureSessionApi = await response.json();

    // Also fetch events for this session
    const events = await this.getSessionEvents(sessionId);

    return transformCaptureSession(apiSession, events);
  }

  /**
   * Get input events for a capture session
   */
  async getSessionEvents(
    sessionId: string,
    startMs?: number,
    endMs?: number,
    eventTypes?: string[]
  ): Promise<InputEvent[]> {
    let url = `${this.apiUrl}/api/v1/capture/events/${sessionId}`;
    const params = new URLSearchParams();

    if (startMs !== undefined) params.append("start_ms", startMs.toString());
    if (endMs !== undefined) params.append("end_ms", endMs.toString());
    if (eventTypes && eventTypes.length > 0) {
      params.append("event_types", eventTypes.join(","));
    }

    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }

    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to fetch session events");
    }

    const apiEvents: InputEventApi[] = await response.json();
    return apiEvents.map(transformInputEvent);
  }

  /**
   * Get video URL for a capture session
   */
  getVideoUrl(sessionId: string): string {
    return `${this.apiUrl}/api/v1/capture/video/${sessionId}`;
  }

  /**
   * Extract a frame at a specific timestamp
   */
  async extractFrame(
    sessionId: string,
    timestampMs: number,
    quality: number = 90
  ): Promise<Blob> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/capture/frames/session/${sessionId}/${timestampMs}?quality=${quality}`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to extract frame");
    }

    return response.blob();
  }

  /**
   * Extract a frame and return as base64
   */
  async extractFrameBase64(
    sessionId: string,
    timestampMs: number,
    quality: number = 90
  ): Promise<string> {
    const blob = await this.extractFrame(sessionId, timestampMs, quality);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        // Remove the data URL prefix to get just the base64 data
        const base64Data = base64.split(",")[1];
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Save a screenshot to the project's screenshot library
   * This creates a Screenshot object that can be used for state elements
   */
  async saveScreenshotToProject(
    projectId: string,
    request: SaveScreenshotToProjectRequest
  ): Promise<{ id: string; url: string }> {
    // Convert base64 to blob for upload
    const byteCharacters = atob(request.imageData);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: "image/jpeg" });

    // Create form data for upload
    const formData = new FormData();
    formData.append("file", blob, `${request.name}.jpg`);
    formData.append("project_id", projectId);
    formData.append("name", request.name);
    if (request.description) {
      formData.append("description", request.description);
    }
    if (request.tags && request.tags.length > 0) {
      formData.append("tags", JSON.stringify(request.tags));
    }

    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/screenshots/upload`,
      {
        method: "POST",
        body: formData,
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to save screenshot");
    }

    return response.json();
  }

  /**
   * Delete a capture session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/capture/sessions/${sessionId}`,
      { method: "DELETE" }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to delete capture session");
    }
  }

  /**
   * Update session notes
   */
  async updateSessionNotes(sessionId: string, notes: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/capture/sessions/${sessionId}/notes`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || "Failed to update session notes");
    }
  }
}
