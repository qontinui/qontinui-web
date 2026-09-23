/**
 * ML model management operations for the runner client.
 *
 * Handles model list/download/delete/status/disk-usage.
 */

import { runnerRequest } from "@/lib/runner/api-client";
import { BaseClient } from "./base-client";
import type {
  ModelListResponse,
  ModelDownloadResponse,
  ModelStatusResponse,
  ModelDiskUsageResponse,
} from "./types";

export class ModelClient {
  private base: BaseClient;

  constructor(base: BaseClient) {
    this.base = base;
  }

  /**
   * List all available models with their download status
   */
  async listModels(): Promise<ModelListResponse> {
    try {
      const response = await runnerRequest(this.base.target, "/models", {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to list models"
        );
        return {
          success: false,
          models: [],
          error: message,
        };
      }

      const data = await response.json();
      if (data.data) {
        return {
          success: true,
          models: data.data.models || [],
          error: data.error,
        };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        models: [],
        error: error instanceof Error ? error.message : "Failed to list models",
      };
    }
  }

  /**
   * Download a model
   * Note: This is a long-running operation that returns when complete
   */
  async downloadModel(
    modelId: string,
    force = false
  ): Promise<ModelDownloadResponse> {
    try {
      const response = await runnerRequest(
        this.base.target,
        "/models/download",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ model_id: modelId, force }),
          // 10 minutes over loopback; the relay caps its wait at 120 s.
          timeoutMs: 600000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to download model"
        );
        return {
          success: false,
          error: message,
        };
      }

      const data = await response.json();
      if (data.data) {
        return { success: true, ...data.data, error: data.error };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to download model",
      };
    }
  }

  /**
   * Delete a downloaded model
   */
  async deleteModel(
    modelId: string
  ): Promise<{ success: boolean; deleted?: boolean; error?: string }> {
    try {
      const response = await runnerRequest(this.base.target, "/models/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ model_id: modelId }),
      });

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to delete model"
        );
        return {
          success: false,
          error: message,
        };
      }

      const data = await response.json();
      if (data.data) {
        return { success: true, deleted: data.data.deleted, error: data.error };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to delete model",
      };
    }
  }

  /**
   * Get status of a specific model
   */
  async getModelStatus(modelId: string): Promise<ModelStatusResponse> {
    try {
      const response = await runnerRequest(
        this.base.target,
        `/models/${modelId}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to get model status"
        );
        return {
          success: false,
          model_id: modelId,
          available: false,
          path: null,
          info: null,
          error: message,
        };
      }

      const data = await response.json();
      if (data.data) {
        return { success: true, ...data.data, error: data.error };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        model_id: modelId,
        available: false,
        path: null,
        info: null,
        error:
          error instanceof Error ? error.message : "Failed to get model status",
      };
    }
  }

  /**
   * Get disk usage for all downloaded models
   */
  async getModelsDiskUsage(): Promise<ModelDiskUsageResponse> {
    try {
      const response = await runnerRequest(
        this.base.target,
        "/models/disk-usage",
        {
          method: "GET",
          headers: { Accept: "application/json" },
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to get disk usage"
        );
        return {
          success: false,
          total_bytes: 0,
          models: {},
          models_dir: "",
          error: message,
        };
      }

      const data = await response.json();
      if (data.data) {
        return { success: true, ...data.data, error: data.error };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        total_bytes: 0,
        models: {},
        models_dir: "",
        error:
          error instanceof Error ? error.message : "Failed to get disk usage",
      };
    }
  }
}
