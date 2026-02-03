/**
 * API client for training job management.
 */

export type TrainingJobStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type TrainingJobModelType =
  | "detection"
  | "classification"
  | "segmentation";

export interface TrainingConfig {
  model_type: TrainingJobModelType;
  epochs: number;
  batch_size: number;
  learning_rate: number;
  base_model: string;
  augmentation: boolean;
  train_split: number;
  validation_split: number;
  custom_params?: Record<string, unknown>;
}

export interface TrainingJob {
  id: string;
  project_id: string;
  user_id: string | null;
  annotation_set_id: string | null;
  name: string | null;
  description: string | null;
  model_type: string;
  config: TrainingConfig;
  status: TrainingJobStatus;
  progress: number;
  current_epoch: number | null;
  total_epochs: number | null;
  logs: string | null;
  error: string | null;
  metrics: Record<string, unknown> | null;
  output_path: string | null;
  model_url: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface TrainingJobListResponse {
  jobs: TrainingJob[];
  total: number;
  skip: number;
  limit: number;
}

export interface TrainingEstimate {
  estimated_time_minutes: number;
  estimated_cost_usd: number | null;
  gpu_type: string;
  notes: string | null;
}

export interface CreateTrainingJobRequest {
  project_id: string;
  annotation_set_id?: string;
  name?: string;
  description?: string;
  config?: Partial<TrainingConfig>;
}

const defaultConfig: TrainingConfig = {
  model_type: "detection",
  epochs: 50,
  batch_size: 16,
  learning_rate: 0.001,
  base_model: "yolov8n",
  augmentation: true,
  train_split: 0.8,
  validation_split: 0.2,
};

/**
 * Create a new training job.
 */
export async function createTrainingJob(
  request: CreateTrainingJobRequest
): Promise<TrainingJob> {
  const config = { ...defaultConfig, ...request.config };

  const response = await fetch("/api/v1/training/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: request.project_id,
      annotation_set_id: request.annotation_set_id,
      name: request.name,
      description: request.description,
      config,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to create training job");
  }

  return response.json();
}

/**
 * List training jobs with optional filters.
 */
export async function listTrainingJobs(params?: {
  project_id?: string;
  status?: TrainingJobStatus;
  skip?: number;
  limit?: number;
}): Promise<TrainingJobListResponse> {
  const searchParams = new URLSearchParams();

  if (params?.project_id) searchParams.set("project_id", params.project_id);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.skip !== undefined)
    searchParams.set("skip", params.skip.toString());
  if (params?.limit !== undefined)
    searchParams.set("limit", params.limit.toString());

  const response = await fetch(`/api/v1/training/jobs?${searchParams}`);

  if (!response.ok) {
    throw new Error("Failed to fetch training jobs");
  }

  return response.json();
}

/**
 * Get a specific training job by ID.
 */
export async function getTrainingJob(jobId: string): Promise<TrainingJob> {
  const response = await fetch(`/api/v1/training/jobs/${jobId}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Training job ${jobId} not found`);
    }
    throw new Error("Failed to fetch training job");
  }

  return response.json();
}

/**
 * Start a pending training job.
 */
export async function startTrainingJob(jobId: string): Promise<TrainingJob> {
  const response = await fetch(`/api/v1/training/jobs/${jobId}/start`, {
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to start training job");
  }

  return response.json();
}

/**
 * Cancel a running or queued training job.
 */
export async function cancelTrainingJob(jobId: string): Promise<TrainingJob> {
  const response = await fetch(`/api/v1/training/jobs/${jobId}/cancel`, {
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to cancel training job");
  }

  return response.json();
}

/**
 * Delete a training job.
 */
export async function deleteTrainingJob(jobId: string): Promise<void> {
  const response = await fetch(`/api/v1/training/jobs/${jobId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to delete training job");
  }
}

/**
 * Get an estimate for training time and cost.
 */
export async function getTrainingEstimate(
  config: Partial<TrainingConfig>,
  annotationCount: number
): Promise<TrainingEstimate> {
  const fullConfig = { ...defaultConfig, ...config };

  const response = await fetch(
    `/api/v1/training/estimate?annotation_count=${annotationCount}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullConfig),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to get training estimate");
  }

  return response.json();
}

/**
 * Get status badge color and text for a training job status.
 */
export function getStatusDisplay(status: TrainingJobStatus): {
  color: string;
  text: string;
  bgColor: string;
} {
  switch (status) {
    case "pending":
      return {
        color: "text-gray-400",
        text: "Pending",
        bgColor: "bg-gray-500/20",
      };
    case "queued":
      return {
        color: "text-blue-400",
        text: "Queued",
        bgColor: "bg-blue-500/20",
      };
    case "running":
      return {
        color: "text-yellow-400",
        text: "Running",
        bgColor: "bg-yellow-500/20",
      };
    case "completed":
      return {
        color: "text-green-400",
        text: "Completed",
        bgColor: "bg-green-500/20",
      };
    case "failed":
      return {
        color: "text-red-400",
        text: "Failed",
        bgColor: "bg-red-500/20",
      };
    case "cancelled":
      return {
        color: "text-orange-400",
        text: "Cancelled",
        bgColor: "bg-orange-500/20",
      };
    default:
      return {
        color: "text-gray-400",
        text: status,
        bgColor: "bg-gray-500/20",
      };
  }
}
