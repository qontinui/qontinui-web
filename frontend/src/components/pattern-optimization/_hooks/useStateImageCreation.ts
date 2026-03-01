import type {
  ExtractedPattern,
  PatternSession,
} from "@/types/pattern-optimization";
import type { State, ImageAsset } from "@/contexts/automation-context/types";
import { prepareStateImageCreation } from "@/lib/state-image-creator";
import { createImageAsset, findImageByData } from "@/lib/image-library-utils";
import { toast } from "sonner";

interface UseStateImageCreationOptions {
  extractedPattern: ExtractedPattern | null;
  editedPattern: string | null;
  stateImageName: string;
  selectedStateId: string;
  newStateName: string;
  fixedLocation: boolean;
  session: PatternSession | null;
  states: State[];
  images: ImageAsset[];
  addImage: (image: ImageAsset) => void;
  addState: (state: State) => void;
  updateState: (state: State) => void;
  setShowStateImageDialog: (show: boolean) => void;
  setStateImageName: (name: string) => void;
  setSelectedStateId: (id: string) => void;
  setNewStateName: (name: string) => void;
}

/**
 * Handles the creation of StateImage from extracted patterns.
 */
export function useStateImageCreation({
  extractedPattern,
  editedPattern,
  stateImageName,
  selectedStateId,
  newStateName,
  fixedLocation,
  session,
  states,
  images,
  addImage,
  addState,
  updateState,
  setShowStateImageDialog,
  setStateImageName,
  setSelectedStateId,
  setNewStateName,
}: UseStateImageCreationOptions) {
  const handleCreateStateImage = async () => {
    if (!extractedPattern || !stateImageName) {
      toast.error("Missing required fields");
      return;
    }

    if (selectedStateId === "new" && !newStateName.trim()) {
      toast.error("Please enter a name for the new state");
      return;
    }

    try {
      const imageData = editedPattern || extractedPattern.patternImage || "";

      // Step 1: Add image to library first (or find existing)
      let imageAsset = findImageByData(images, imageData);
      if (!imageAsset) {
        imageAsset = createImageAsset(
          imageData,
          stateImageName,
          "pattern_optimization"
        );
        if (extractedPattern.maskImage) {
          imageAsset.mask = extractedPattern.maskImage;
        }
        addImage(imageAsset);
        toast.success("Added to Image Library");
      }

      // Step 2: If fixed location, get region as search region
      let searchRegion:
        | {
            id: string;
            name: string;
            x: number;
            y: number;
            width: number;
            height: number;
          }
        | undefined;
      if (fixedLocation && (session?.screenshots?.length ?? 0) > 0) {
        const firstScreenshot = session?.screenshots[0];
        if (firstScreenshot?.region) {
          searchRegion = {
            id: `search_region_${Date.now()}`,
            name: "Pattern Region",
            x: firstScreenshot.region.x,
            y: firstScreenshot.region.y,
            width: firstScreenshot.region.width,
            height: firstScreenshot.region.height,
          };
        }
      }

      // Step 3: Create StateImage with imageId referencing the library
      const result = prepareStateImageCreation(
        {
          name: stateImageName,
          imageId: imageAsset.id,
          source: "pattern-optimization",
          fixed: fixedLocation,
          searchRegion: searchRegion,
        },
        selectedStateId,
        states,
        newStateName.trim() || undefined
      );

      if (result.action === "create-state" && result.targetState) {
        addState(result.targetState);
        toast.success(`Created new state: ${result.targetState.name}`);
      } else if (result.action === "update-state" && result.targetState) {
        updateState(result.targetState);
        toast.success(`Added StateImage to ${result.targetState.name}`);
      }

      // Reset dialog
      setShowStateImageDialog(false);
      setStateImageName("");
      setSelectedStateId("");
      setNewStateName("");
    } catch (error) {
      console.error("Error creating StateImage:", error);
      toast.error("Failed to create StateImage");
    }
  };

  const handleCancelDialog = () => {
    setShowStateImageDialog(false);
    setStateImageName("");
    setSelectedStateId("");
    setNewStateName("");
  };

  return {
    handleCreateStateImage,
    handleCancelDialog,
  };
}
