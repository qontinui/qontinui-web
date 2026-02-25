import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import type { ExtractionState } from "./useExtractionState";
import { createLogger } from "@/lib/logger";
const logger = createLogger("UseDomainKnowledge");

interface UseDomainKnowledgeArgs {
  projectId: string | null;
  state: ExtractionState;
  configMethod: string;
}

export function useDomainKnowledge({
  projectId,
  state,
  configMethod,
}: UseDomainKnowledgeArgs) {
  // Load domain knowledge
  const loadDomainKnowledge = useCallback(async () => {
    if (!projectId) return;

    state.setIsLoadingKnowledge(true);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/domain-knowledge`,
        { credentials: "include" }
      );

      if (response.ok) {
        const data = await response.json();
        state.setDomainKnowledgeList(data.items || []);
      }
    } catch (error) {
      logger.error("Failed to load domain knowledge:", error);
    } finally {
      state.setIsLoadingKnowledge(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable
  }, [projectId]);

  // Create domain knowledge
  const createDomainKnowledge = useCallback(async () => {
    if (!projectId || !state.newKnowledgeTitle || !state.newKnowledgeContent) {
      toast.error("Please fill in title and content");
      return;
    }

    state.setIsCreatingKnowledge(true);
    try {
      const response = await fetch(
        `/api/v1/projects/${projectId}/domain-knowledge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            title: state.newKnowledgeTitle,
            content: state.newKnowledgeContent,
            tags: [],
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to create domain knowledge");
      }

      const created = await response.json();
      state.setDomainKnowledgeList((prev) => [...prev, created]);
      state.setNewKnowledgeTitle("");
      state.setNewKnowledgeContent("");
      state.setShowKnowledgeDialog(false);
      toast.success("Domain knowledge created");
    } catch (error) {
      logger.error("Failed to create knowledge:", error);
      toast.error("Failed to create domain knowledge");
    } finally {
      state.setIsCreatingKnowledge(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable
  }, [projectId]);

  // Link knowledge to state
  const linkKnowledgeToState = useCallback(
    async (knowledgeId: string) => {
      if (
        !projectId ||
        !state.currentSavedConfigId ||
        !state.selectedStateId ||
        !state.stateUuidMap[state.selectedStateId]
      ) {
        toast.error("State must be saved first");
        return;
      }

      try {
        const response = await fetch(
          `/api/v1/projects/${projectId}/ui-bridge-configs/${state.currentSavedConfigId}/states/${state.stateUuidMap[state.selectedStateId]}/knowledge`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ knowledge_id: knowledgeId, order: 0 }),
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || "Failed to link knowledge");
        }

        const updatedState = await response.json();

        state.setDiscoveryResult((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            states: prev.states.map((s) =>
              s.id === state.selectedStateId
                ? { ...s, domain_knowledge: updatedState.domain_knowledge }
                : s
            ),
          };
        });

        state.setShowLinkKnowledgeDialog(false);
        toast.success("Knowledge linked to state");
      } catch (error) {
        logger.error("Failed to link knowledge:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to link knowledge"
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable, read state values via closure
    [
      projectId,
      state.currentSavedConfigId,
      state.selectedStateId,
      state.stateUuidMap,
    ]
  );

  // Unlink knowledge from state
  const unlinkKnowledgeFromState = useCallback(
    async (knowledgeId: string) => {
      if (
        !projectId ||
        !state.currentSavedConfigId ||
        !state.selectedStateId ||
        !state.stateUuidMap[state.selectedStateId]
      ) {
        return;
      }

      try {
        await fetch(
          `/api/v1/projects/${projectId}/ui-bridge-configs/${state.currentSavedConfigId}/states/${state.stateUuidMap[state.selectedStateId]}/knowledge/${knowledgeId}`,
          { method: "DELETE", credentials: "include" }
        );

        state.setDiscoveryResult((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            states: prev.states.map((s) =>
              s.id === state.selectedStateId
                ? {
                    ...s,
                    domain_knowledge: (s.domain_knowledge || []).filter(
                      (k) => k.id !== knowledgeId
                    ),
                  }
                : s
            ),
          };
        });

        toast.success("Knowledge unlinked");
      } catch (error) {
        logger.error("Failed to unlink knowledge:", error);
        toast.error("Failed to unlink knowledge");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable, read state values via closure
    [
      projectId,
      state.currentSavedConfigId,
      state.selectedStateId,
      state.stateUuidMap,
    ]
  );

  // Load knowledge when in UI Bridge mode
  useEffect(() => {
    if (configMethod === "ui-bridge") {
      loadDomainKnowledge();
    }
  }, [configMethod, loadDomainKnowledge]);

  return {
    loadDomainKnowledge,
    createDomainKnowledge,
    linkKnowledgeToState,
    unlinkKnowledgeFromState,
  };
}
