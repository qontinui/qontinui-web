import { useState, useCallback } from "react";
import type { LibraryItem } from "../../types";

export function useInitialStates(
  item: LibraryItem,
  onUpdate: (item: LibraryItem) => void
) {
  const [initialStatesOpen, setInitialStatesOpen] = useState(false);

  const initialStateIds: string[] =
    (item as { initialStateIds?: string[] }).initialStateIds || [];

  const handleInitialStateToggle = useCallback(
    (stateId: string, checked: boolean) => {
      const currentIds =
        (item as { initialStateIds?: string[] }).initialStateIds || [];
      const newIds = checked
        ? [...currentIds, stateId]
        : currentIds.filter((id: string) => id !== stateId);

      onUpdate({
        ...item,
        initialStateIds: newIds,
        metadata: {
          ...item.metadata,
          updated: new Date().toISOString(),
        },
      } as LibraryItem);
    },
    [item, onUpdate]
  );

  const handleResetToDefaults = useCallback(() => {
    onUpdate({
      ...item,
      initialStateIds: undefined,
      metadata: {
        ...item.metadata,
        updated: new Date().toISOString(),
      },
    } as LibraryItem);
  }, [item, onUpdate]);

  return {
    initialStatesOpen,
    setInitialStatesOpen,
    initialStateIds,
    handleInitialStateToggle,
    handleResetToDefaults,
  };
}
