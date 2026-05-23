"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useAutomationStore } from "@/stores/automation";
import { httpClient } from "@/services/service-factory";
import { ApiConfig } from "@/services/api-config";
import type {
  StateMachineTransitionCreate,
  StateMachineTransitionUpdate,
  StateMachineTransition,
} from "../_types";

const API = `${ApiConfig.API_BASE_URL}/api/v1`;

export function useUIBridgeTransitions(configId: string | null) {
  const projectId = useAutomationStore((s) => s.projectId);

  const createTransition = useCallback(
    async (
      data: StateMachineTransitionCreate
    ): Promise<StateMachineTransition | null> => {
      if (!projectId || !configId) return null;
      try {
        const res = await httpClient.fetch(
          `${API}/projects/${projectId}/ui-bridge-configs/${configId}/transitions`,
          {
            method: "POST",
            body: JSON.stringify(data),
          }
        );
        if (res.ok) {
          const created = await res.json();
          toast.success("Transition created");
          return created;
        }
        const err = await res.json().catch(() => ({}));
        toast.error(err.detail || "Failed to create transition");
        return null;
      } catch (err) {
        console.error("Failed to create transition:", err);
        toast.error("Failed to create transition");
        return null;
      }
    },
    [projectId, configId]
  );

  const updateTransition = useCallback(
    async (
      transitionId: string,
      data: StateMachineTransitionUpdate
    ): Promise<StateMachineTransition | null> => {
      if (!projectId || !configId) return null;
      try {
        const res = await httpClient.fetch(
          `${API}/projects/${projectId}/ui-bridge-configs/${configId}/transitions/${transitionId}`,
          {
            method: "PATCH",
            body: JSON.stringify(data),
          }
        );
        if (res.ok) {
          const updated = await res.json();
          toast.success("Transition updated");
          return updated;
        }
        const err = await res.json().catch(() => ({}));
        toast.error(err.detail || "Failed to update transition");
        return null;
      } catch (err) {
        console.error("Failed to update transition:", err);
        toast.error("Failed to update transition");
        return null;
      }
    },
    [projectId, configId]
  );

  const deleteTransition = useCallback(
    async (transitionId: string): Promise<boolean> => {
      if (!projectId || !configId) return false;
      try {
        const res = await httpClient.fetch(
          `${API}/projects/${projectId}/ui-bridge-configs/${configId}/transitions/${transitionId}`,
          {
            method: "DELETE",
          }
        );
        if (res.ok || res.status === 204) {
          toast.success("Transition deleted");
          return true;
        }
        toast.error("Failed to delete transition");
        return false;
      } catch (err) {
        console.error("Failed to delete transition:", err);
        toast.error("Failed to delete transition");
        return false;
      }
    },
    [projectId, configId]
  );

  return { createTransition, updateTransition, deleteTransition };
}
