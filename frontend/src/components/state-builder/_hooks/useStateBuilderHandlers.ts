import { useCallback } from "react";
import type {
  State,
  StateImage,
  StateRegion,
  StateLocation,
} from "@/contexts/automation-context";
import type { StateTemplate, BulkOperationPayload } from "../types";
import { toast } from "sonner";

interface UseStateBuilderHandlersParams {
  // Automation context
  addState: (state: State) => void;
  updateState: (state: State) => void;
  deleteState: (stateId: string) => void;
  states: State[];

  // State values
  currentState: State | null;
  currentStateId: string | null;
  selectedImageIndex: number | null;

  // State setters
  setCurrentStateId: (id: string | null) => void;
  setSelectedStateIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setShowTemplateDialog: (v: boolean) => void;
  setShowBulkDialog: (v: boolean) => void;
  setSelectedImageIndex: (idx: number | null) => void;
}

export function useStateBuilderHandlers({
  addState,
  updateState,
  deleteState,
  states,
  currentState,
  currentStateId,
  selectedImageIndex,
  setCurrentStateId,
  setSelectedStateIds,
  setShowTemplateDialog,
  setShowBulkDialog,
  setSelectedImageIndex,
}: UseStateBuilderHandlersParams) {
  const handleCreateState = useCallback(() => {
    const newState: State = {
      id: `state-${Date.now()}`,
      name: "New State",
      description: "",
      stateImages: [],
      regions: [],
      locations: [],
      strings: [],
      position: { x: 0, y: 0 },
    };

    addState(newState);
    setCurrentStateId(newState.id);
    toast.success("State created");
  }, [addState, setCurrentStateId]);

  const handleCreateStateFromTemplate = useCallback(
    (template: StateTemplate) => {
      const newState: State = {
        id: `state-${Date.now()}`,
        name: template.template.name || "New State",
        description: template.template.description || "",
        stateImages: template.template.stateImages || [],
        regions: template.template.regions || [],
        locations: template.template.locations || [],
        strings: template.template.strings || [],
        position: { x: 0, y: 0 },
      };

      addState(newState);
      setCurrentStateId(newState.id);
      setShowTemplateDialog(false);
      toast.success(`State created from template: ${template.name}`);
    },
    [addState, setCurrentStateId, setShowTemplateDialog]
  );

  const handleDeleteState = useCallback(
    (stateId: string) => {
      if (confirm("Delete this state? This action cannot be undone.")) {
        deleteState(stateId);
        if (currentStateId === stateId) {
          setCurrentStateId(null);
        }
        setSelectedStateIds((prev) => {
          const next = new Set(prev);
          next.delete(stateId);
          return next;
        });
        toast.success("State deleted");
      }
    },
    [deleteState, currentStateId, setCurrentStateId, setSelectedStateIds]
  );

  const handleToggleStateSelection = useCallback(
    (stateId: string) => {
      setSelectedStateIds((prev) => {
        const next = new Set(prev);
        if (next.has(stateId)) {
          next.delete(stateId);
        } else {
          next.add(stateId);
        }
        return next;
      });
    },
    [setSelectedStateIds]
  );

  const handleBulkOperation = useCallback(
    (operation: BulkOperationPayload) => {
      const { stateIds, operation: op } = operation;

      switch (op) {
        case "delete":
          if (
            confirm(
              `Delete ${stateIds.length} state(s)? This action cannot be undone.`
            )
          ) {
            stateIds.forEach((id) => deleteState(id));
            setSelectedStateIds(new Set());
            toast.success(`Deleted ${stateIds.length} state(s)`);
          }
          break;

        case "move":
          // Move to group (would need to update state metadata)
          toast.info("Move operation not yet implemented");
          break;

        case "tag":
          // Add tags to states (would need to update state metadata)
          toast.info("Tag operation not yet implemented");
          break;

        case "export": {
          // Export selected states
          const exportData = states.filter((s) => stateIds.includes(s.id));
          const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `states-export-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success(`Exported ${stateIds.length} state(s)`);
          break;
        }

        case "duplicate":
          stateIds.forEach((id) => {
            const original = states.find((s) => s.id === id);
            if (original) {
              const duplicate: State = {
                ...original,
                id: `state-${Date.now()}-${Math.random()}`,
                name: `${original.name} (Copy)`,
              };
              addState(duplicate);
            }
          });
          setSelectedStateIds(new Set());
          toast.success(`Duplicated ${stateIds.length} state(s)`);
          break;
      }

      setShowBulkDialog(false);
    },
    [states, deleteState, addState, setSelectedStateIds, setShowBulkDialog]
  );

  const handleUpdateCurrentState = useCallback(
    (updates: Partial<State>) => {
      if (currentState) {
        updateState({ ...currentState, ...updates });
      }
    },
    [currentState, updateState]
  );

  const handleAddStateImage = useCallback(() => {
    if (!currentState) return;

    const newStateImage: StateImage = {
      id: `si-${Date.now()}`,
      name: "New Image",
      patterns: [],
      shared: false,
    };

    handleUpdateCurrentState({
      stateImages: [...(currentState.stateImages || []), newStateImage],
    });
    setSelectedImageIndex(currentState.stateImages?.length || 0);
    toast.success("StateImage added");
  }, [currentState, handleUpdateCurrentState, setSelectedImageIndex]);

  const handleRemoveStateImage = useCallback(
    (index: number) => {
      if (!currentState) return;

      const updated = [...(currentState.stateImages || [])];
      updated.splice(index, 1);
      handleUpdateCurrentState({ stateImages: updated });

      if (selectedImageIndex === index) {
        setSelectedImageIndex(null);
      }
      toast.success("StateImage removed");
    },
    [
      currentState,
      handleUpdateCurrentState,
      selectedImageIndex,
      setSelectedImageIndex,
    ]
  );

  const handleAddRegion = useCallback(() => {
    if (!currentState) return;

    const newRegion: StateRegion = {
      id: `region-${Date.now()}`,
      name: "New Region",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    };

    handleUpdateCurrentState({
      regions: [...(currentState.regions || []), newRegion],
    });
    toast.success("Region added");
  }, [currentState, handleUpdateCurrentState]);

  const handleAddLocation = useCallback(() => {
    if (!currentState) return;

    const newLocation: StateLocation = {
      id: `loc-${Date.now()}`,
      name: "New Location",
      x: 100,
      y: 100,
      fixed: false,
      anchor: false,
    };

    handleUpdateCurrentState({
      locations: [...(currentState.locations || []), newLocation],
    });
    toast.success("Location added");
  }, [currentState, handleUpdateCurrentState]);

  return {
    handleCreateState,
    handleCreateStateFromTemplate,
    handleDeleteState,
    handleToggleStateSelection,
    handleBulkOperation,
    handleUpdateCurrentState,
    handleAddStateImage,
    handleRemoveStateImage,
    handleAddRegion,
    handleAddLocation,
  };
}
