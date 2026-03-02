"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { recordingService } from "@/services/service-factory";
import { type AcceptanceRequest } from "@/types/recording";

export function useAcceptanceActions(
  recordingId: string,
  selectedStateIds: Set<string>,
  selectedTransitionIds: Set<string>
) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);

  const handleAcceptSelected = async () => {
    if (selectedStateIds.size === 0) {
      toast.error("Please select at least one state to accept");
      return;
    }

    setAccepting(true);

    try {
      const request: AcceptanceRequest = {
        action: "accept_selected",
        selected_state_ids: Array.from(selectedStateIds),
        selected_transition_ids: Array.from(selectedTransitionIds),
      };

      const response = await recordingService.acceptStateStructure(
        recordingId,
        request
      );

      toast.success(
        `Created ${response.created_states.length} states and ${response.created_transitions.length} transitions`
      );

      setTimeout(() => {
        router.push(`/build/workflows`);
      }, 2000);
    } catch (error: unknown) {
      console.error("Failed to accept structure:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to accept structure"
      );
    } finally {
      setAccepting(false);
    }
  };

  const handleAcceptAll = async () => {
    setAccepting(true);

    try {
      const request: AcceptanceRequest = {
        action: "accept",
      };

      const response = await recordingService.acceptStateStructure(
        recordingId,
        request
      );

      toast.success(
        `Created ${response.created_states.length} states and ${response.created_transitions.length} transitions`
      );

      setTimeout(() => {
        router.push(`/build/workflows`);
      }, 2000);
    } catch (error: unknown) {
      console.error("Failed to accept structure:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to accept structure"
      );
    } finally {
      setAccepting(false);
    }
  };

  const handleDiscard = async () => {
    if (!confirm("Are you sure you want to discard this state structure?")) {
      return;
    }

    try {
      const request: AcceptanceRequest = {
        action: "discard",
      };

      await recordingService.acceptStateStructure(recordingId, request);
      toast.success("State structure discarded");
      router.push("/recordings");
    } catch (error: unknown) {
      console.error("Failed to discard structure:", error);
      toast.error("Failed to discard structure");
    }
  };

  return {
    accepting,
    handleAcceptSelected,
    handleAcceptAll,
    handleDiscard,
  };
}
