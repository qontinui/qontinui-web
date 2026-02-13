"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useAutomationStore } from "@/stores/automation";
import type { PathfindingResult } from "../_types";

export function usePathfinding(configId: string | null) {
  const projectId = useAutomationStore((s) => s.projectId);
  const [result, setResult] = useState<PathfindingResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const findPath = useCallback(
    async (fromStates: string[], targetStates: string[]) => {
      if (!projectId || !configId) return;
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/v1/projects/${projectId}/ui-bridge-configs/${configId}/pathfind`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              from_states: fromStates,
              target_states: targetStates,
            }),
          }
        );
        if (res.ok) {
          const data: PathfindingResult = await res.json();
          setResult(data);
          if (!data.found) {
            toast.error(data.error || "No path found");
          }
        } else {
          toast.error("Pathfinding request failed");
        }
      } catch (err) {
        console.error("Pathfinding failed:", err);
        toast.error("Pathfinding request failed");
      } finally {
        setIsLoading(false);
      }
    },
    [projectId, configId]
  );

  const clearResult = useCallback(() => setResult(null), []);

  return { result, isLoading, findPath, clearResult };
}
