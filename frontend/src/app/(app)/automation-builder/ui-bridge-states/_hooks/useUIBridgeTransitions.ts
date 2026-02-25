"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useAutomationStore } from "@/stores/automation";
import type {
  UIBridgeTransitionCreate,
  UIBridgeTransitionUpdate,
  UIBridgeTransition,
} from "../_types";

export function useUIBridgeTransitions(configId: string | null) {
  const projectId = useAutomationStore((s) => s.projectId);

  const createTransition = useCallback(
    async (
      data: UIBridgeTransitionCreate
    ): Promise<UIBridgeTransition | null> => {
      if (!projectId || !configId) return null;
      try {
        const res = await fetch(
          `/api/v1/projects/${projectId}/ui-bridge-configs/${configId}/transitions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
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
      data: UIBridgeTransitionUpdate
    ): Promise<UIBridgeTransition | null> => {
      if (!projectId || !configId) return null;
      try {
        const res = await fetch(
          `/api/v1/projects/${projectId}/ui-bridge-configs/${configId}/transitions/${transitionId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
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
        const res = await fetch(
          `/api/v1/projects/${projectId}/ui-bridge-configs/${configId}/transitions/${transitionId}`,
          {
            method: "DELETE",
            credentials: "include",
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
