import { useRef, useState, useEffect } from "react";
import type { State } from "@/stores/automation";

export function useStateImageTracking(state: State) {
  const [openImageSelectorId, setOpenImageSelectorId] = useState<string | null>(
    null
  );

  const prevStateId = useRef<string | null>(null);
  const prevStateImagesLength = useRef<number>(0);
  const prevPatternsCount = useRef<{ [key: string]: number }>({});

  useEffect(() => {
    // If the state ID changed, we're looking at a different state
    // Reset tracking without opening any selectors
    if (state.id !== prevStateId.current) {
      prevStateId.current = state.id;
      prevStateImagesLength.current = state.stateImages?.length || 0;
      prevPatternsCount.current = {};
      // Re-populate pattern counts for the new state
      if (state.stateImages) {
        state.stateImages.forEach((stateImage) => {
          prevPatternsCount.current[stateImage.id] =
            stateImage.patterns?.length || 0;
        });
      }
      return; // Don't auto-open anything when switching states
    }

    const currentLength = state.stateImages?.length || 0;

    // Check if a new StateImage was added (only if same state)
    if (currentLength > prevStateImagesLength.current && state.stateImages) {
      const lastImage = state.stateImages[state.stateImages.length - 1];
      // Open selector for the first pattern of the new StateImage
      if (lastImage) {
        setOpenImageSelectorId(`${lastImage.id}_pattern_0`);
      }
    }

    // Check if new patterns were added to existing StateImages (only if same state)
    if (state.stateImages) {
      state.stateImages.forEach((stateImage) => {
        const currentPatternCount = stateImage.patterns?.length || 0;
        const prevPatternCount = prevPatternsCount.current[stateImage.id] || 0;

        if (currentPatternCount > prevPatternCount) {
          // A new pattern was added, open its selector
          const newPatternIndex = currentPatternCount - 1;
          setOpenImageSelectorId(`${stateImage.id}_pattern_${newPatternIndex}`);
        }

        prevPatternsCount.current[stateImage.id] = currentPatternCount;
      });
    }

    prevStateImagesLength.current = currentLength;
  }, [state.id, state.stateImages]);

  return { openImageSelectorId, setOpenImageSelectorId };
}
