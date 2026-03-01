import type { State, Transition } from "@/hooks/automation";
import type { Workflow } from "@/lib/action-schema/action-types";
import { StateUpdateCoordinator } from "@/contexts/automation-context/state-update-coordinator";

interface UseStateUpdateCoordinatorParams {
  states: State[];
  transitions: Transition[];
  workflows: Workflow[];
  selectedNode: string | null;
  selectedEdge: string | null;
  pendingIdChangeRef: React.MutableRefObject<{
    oldId: string;
    newId: string;
  } | null>;
  setSelectedNode: (id: string | null) => void;
  updateState: (state: State) => Promise<void> | void;
  updateStateWithIdChange: (oldId: string, state: State) => void;
  updateTransition: (transition: Transition) => void;
  updateWorkflow: (workflow: Workflow) => void;
}

export function useStateUpdateCoordinator({
  states,
  transitions,
  workflows,
  selectedNode,
  selectedEdge,
  pendingIdChangeRef,
  setSelectedNode,
  updateState,
  updateStateWithIdChange,
  updateTransition,
  updateWorkflow,
}: UseStateUpdateCoordinatorParams) {
  const updateSelectedState = (updates: Partial<State>) => {
    if (!selectedNode) return;

    const currentState = states.find((s) => s.id === selectedNode);
    if (!currentState) return;

    const updateResult = StateUpdateCoordinator.prepareStateUpdate(
      currentState,
      updates,
      states,
      transitions
    );

    if (updateResult.idChanged && updateResult.oldId && updateResult.newId) {
      pendingIdChangeRef.current = {
        oldId: updateResult.oldId,
        newId: updateResult.newId,
      };

      setSelectedNode(updateResult.newId);

      updateStateWithIdChange(updateResult.oldId, updateResult.updatedState);

      const updatedTransitions =
        StateUpdateCoordinator.calculateUpdatedTransitions(
          transitions,
          updateResult.oldId,
          updateResult.newId
        );

      updatedTransitions.forEach((transition) => {
        const originalTransition = transitions.find(
          (t) => t.id === transition.id
        );
        if (
          originalTransition &&
          JSON.stringify(originalTransition) !== JSON.stringify(transition)
        ) {
          updateTransition(transition);
        }
      });

      workflows.forEach((workflow) => {
        if (workflow.tags?.includes(updateResult.oldId!)) {
          const updatedTags = workflow.tags.map((tag) =>
            tag === updateResult.oldId ? updateResult.newId! : tag
          );
          updateWorkflow({
            ...workflow,
            tags: updatedTags,
          });
        }
      });

      return;
    }

    updateState(updateResult.updatedState);
  };

  const updateSelectedTransition = (updates: Partial<Transition>) => {
    if (!selectedEdge) return;

    const currentTransition = transitions.find((t) =>
      selectedEdge.startsWith(t.id)
    );
    if (!currentTransition) return;

    const updatedTransition = {
      ...currentTransition,
      ...updates,
    } as Transition;
    updateTransition(updatedTransition);
  };

  return {
    updateSelectedState,
    updateSelectedTransition,
  };
}
