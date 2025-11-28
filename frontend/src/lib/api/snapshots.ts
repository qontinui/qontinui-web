// lib/api/snapshots.ts

import type {
  ImportSnapshotRequest,
  SnapshotRun,
  SnapshotListResponse,
} from "@/types/snapshots";

export async function importSnapshot(
  request: ImportSnapshotRequest
): Promise<SnapshotRun> {
  const response = await fetch("/api/v1/snapshots/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to import snapshot");
  }

  return response.json();
}

export async function listSnapshots(params?: {
  limit?: number;
  offset?: number;
  workflow_id?: number;
  tags?: string;
}): Promise<SnapshotListResponse> {
  const searchParams = new URLSearchParams();

  if (params?.limit) searchParams.set("limit", params.limit.toString());
  if (params?.offset) searchParams.set("offset", params.offset.toString());
  if (params?.workflow_id)
    searchParams.set("workflow_id", params.workflow_id.toString());
  if (params?.tags) searchParams.set("tags", params.tags);

  const response = await fetch(`/api/v1/snapshots?${searchParams}`);

  if (!response.ok) {
    throw new Error("Failed to fetch snapshots");
  }

  return response.json();
}

export async function getSnapshot(runId: string): Promise<SnapshotRun> {
  const response = await fetch(`/api/v1/snapshots/${runId}`);

  if (!response.ok) {
    throw new Error(`Snapshot ${runId} not found`);
  }

  return response.json();
}

export async function deleteSnapshot(
  runId: string,
  deleteFiles: boolean = false
): Promise<void> {
  const response = await fetch(
    `/api/v1/snapshots/${runId}?delete_files=${deleteFiles}`,
    { method: "DELETE" }
  );

  if (!response.ok) {
    throw new Error(`Failed to delete snapshot ${runId}`);
  }
}
