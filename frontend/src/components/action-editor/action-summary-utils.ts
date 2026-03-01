import type {
  Action,
  StateType,
  WorkflowType,
  ImageType,
} from "./action-editor-types";

export function getActionSummary(
  action: Action,
  states: StateType[],
  workflows: WorkflowType[],
  images: ImageType[]
): string {
  const config = action.config as Record<string, unknown>;

  switch (action.type) {
    case "FIND": {
      if (config.removedImage) {
        return `[REMOVED: ${config.removedImage as string}]`;
      }

      // Handle stateImage target type (Find State)
      const target = config.target as
        | {
            type?: string;
            stateId?: string;
            imageId?: string;
            imageIds?: string[];
          }
        | undefined;
      if (target?.type === "stateImage") {
        const stateId = target.stateId;
        if (stateId) {
          const state = states.find((s) => s.id === stateId);
          return state
            ? `Find any image from ${state.name}`
            : "State not found";
        }
        return "No state selected";
      }

      // Handle new target structure - support both imageId (singular) and imageIds (array)
      const imageIds = target?.type === "image" ? target.imageIds : null;
      const imageId =
        target?.type === "image"
          ? target.imageId
          : (config.image as string | undefined);

      // Handle imageIds array (multi-select)
      if (imageIds && Array.isArray(imageIds) && imageIds.length > 0) {
        const names: string[] = [];
        for (const id of imageIds) {
          // Look for StateImage across all states
          let found = false;
          for (const state of states) {
            const stateImage = state.stateImages?.find((si) => si.id === id);
            if (stateImage) {
              const nameWithoutExtension = stateImage.name.replace(
                /\.(png|jpg|jpeg|gif|webp|svg)$/i,
                ""
              );
              names.push(nameWithoutExtension);
              found = true;
              break;
            }
          }
          if (!found) {
            // Fall back to image library
            const image = images.find((img) => img.id === id);
            if (image) {
              const nameWithoutExtension = image.name.replace(
                /\.(png|jpg|jpeg|gif|webp|svg)$/i,
                ""
              );
              names.push(nameWithoutExtension);
            }
          }
        }
        if (names.length === 1) {
          return `Find ${names[0]}`;
        } else if (names.length > 1) {
          return `Find ${names.length} images`;
        }
        return "Images not found";
      }

      // Handle single imageId (legacy format)
      if (imageId) {
        // First look for StateImage across all states
        let stateImageName: string | null = null;
        for (const state of states) {
          const stateImage = state.stateImages?.find((si) => si.id === imageId);
          if (stateImage) {
            stateImageName = stateImage.name;
            break;
          }
        }

        if (stateImageName) {
          // Remove file extension from StateImage name
          const nameWithoutExtension = stateImageName.replace(
            /\.(png|jpg|jpeg|gif|webp|svg)$/i,
            ""
          );
          return `Find ${nameWithoutExtension}`;
        }

        // Fall back to image library
        const image = images.find((img) => img.id === imageId);
        if (image) {
          // Remove file extension from image name
          const nameWithoutExtension = image.name.replace(
            /\.(png|jpg|jpeg|gif|webp|svg)$/i,
            ""
          );
          return `Find ${nameWithoutExtension}`;
        }
        return "Image not found";
      }
      return "No image selected";
    }
    case "FIND_STATE": {
      const stateIds = config.stateIds as string[] | undefined;
      if (stateIds && stateIds.length > 0) {
        const stateNames = stateIds.map((stateId: string) => {
          const state = states.find((s) => s.id === stateId);
          return state ? state.name : stateId;
        });
        if (stateNames.length === 1) {
          return `Check state: ${stateNames[0]}`;
        } else {
          return `Check ${stateNames.length} states`;
        }
      }
      return "No states selected";
    }
    case "RAG_FIND": {
      const ragTarget = config.target as { stateImageId?: string } | undefined;
      const stateImageId = ragTarget?.stateImageId;
      if (stateImageId) {
        // Find StateImage across all states
        for (const state of states) {
          const stateImage = state.stateImages?.find(
            (si) => si.id === stateImageId
          );
          if (stateImage) {
            const nameWithoutExtension = stateImage.name.replace(
              /\.(png|jpg|jpeg|gif|webp|svg)$/i,
              ""
            );
            const topK = config.topK as number | undefined;
            return `RAG Find: ${nameWithoutExtension}${topK && topK > 1 ? ` (top ${topK})` : ""}`;
          }
        }
        return "StateImage not found";
      }
      return "No element selected";
    }
    case "CLICK": {
      const mouseButton = config.mouseButton as string | undefined;
      const button = mouseButton?.toLowerCase() || "left";
      const clickTarget = config.target as
        | string
        | { type?: string; imageId?: string; imageIds?: string[] }
        | undefined;

      // Helper to get image name by ID
      const getImageName = (imgId: string): string | null => {
        // Look for StateImage across all states
        for (const state of states) {
          const stateImage = state.stateImages?.find((si) => si.id === imgId);
          if (stateImage) {
            return stateImage.name.replace(
              /\.(png|jpg|jpeg|gif|webp|svg)$/i,
              ""
            );
          }
        }
        // Fall back to image library
        const image = images.find((img) => img.id === imgId);
        if (image) {
          return image.name.replace(/\.(png|jpg|jpeg|gif|webp|svg)$/i, "");
        }
        return null;
      };

      // Handle object target format: { type: "StateImage" | "image", imageId?: string, imageIds?: string[] }
      // Note: "StateImage" is @deprecated - use "stateImage" (lowercase) instead
      if (clickTarget && typeof clickTarget === "object") {
        const targetObj = clickTarget;
        const targetType = targetObj.type;

        if (
          targetType === "StateImage" ||
          targetType === "stateImage" ||
          targetType === "image"
        ) {
          // Single imageId
          if (targetObj.imageId) {
            const name = getImageName(targetObj.imageId);
            if (name) {
              return `${button} click on ${name}`;
            }
            return `${button} click on image`;
          }
          // Multiple imageIds
          if (targetObj.imageIds && targetObj.imageIds.length > 0) {
            const names = targetObj.imageIds
              .map((id) => getImageName(id))
              .filter((n): n is string => n !== null);
            if (names.length === 1) {
              return `${button} click on ${names[0]}`;
            } else if (names.length > 1) {
              return `${button} click on ${names[0]} +${names.length - 1} more`;
            }
            return `${button} click on image`;
          }
          return `${button} click on StateImage (no image selected)`;
        }

        if (targetType === "lastFindResult") {
          return `${button} click on last find result`;
        }
        if (targetType === "currentPosition") {
          return `${button} click at current position`;
        }
        if (targetType === "coordinates") {
          return `${button} click at coordinates`;
        }

        // Unknown object type
        return `${button} click on ${targetType || "target"}`;
      }

      // Handle legacy string target format: "StateImage"
      // Note: "StateImage" is @deprecated - use "stateImage" (lowercase) instead
      if (clickTarget === "StateImage" || clickTarget === "stateImage") {
        const clickImageIds = config.imageIds as string[] | undefined;
        if (
          clickImageIds &&
          Array.isArray(clickImageIds) &&
          clickImageIds.length > 0
        ) {
          const names: string[] = [];
          for (const id of clickImageIds) {
            const name = getImageName(id);
            if (name) {
              names.push(name);
            }
          }
          if (names.length === 1) {
            return `${button} click on ${names[0]}`;
          } else if (names.length > 1) {
            return `${button} click on ${names.length} images`;
          }
        }
        return `${button} click on StateImage (no image selected)`;
      }

      // Handle other string targets
      if (typeof clickTarget === "string") {
        return `${button} click on ${clickTarget}`;
      }

      return `${button} click on target`;
    }
    case "DOUBLE_CLICK":
      return `Double click on ${(config.target as string | undefined) || "Last Find Result"}`;
    case "RIGHT_CLICK":
      return `Right click on ${(config.target as string | undefined) || "Last Find Result"}`;
    case "MOUSE_MOVE": {
      const moveTarget = config.target as string | undefined;
      if (moveTarget === "Coordinates") {
        return `Move mouse to (${config.x as number}, ${config.y as number})`;
      }
      return `Move mouse to ${moveTarget || "target"}`;
    }
    case "MOUSE_DOWN": {
      const downTarget = config.target as string | undefined;
      const downButton = config.button as string | undefined;
      if (downTarget === "Coordinates") {
        return `Press ${downButton || "left"} button at (${config.x as number}, ${config.y as number})`;
      }
      return `Press ${downButton || "left"} button${downTarget ? ` at ${downTarget}` : ""}`;
    }
    case "MOUSE_UP": {
      const upTarget = config.target as string | undefined;
      const upButton = config.button as string | undefined;
      if (upTarget === "Coordinates") {
        return `Release ${upButton || "left"} button at (${config.x as number}, ${config.y as number})`;
      }
      return `Release ${upButton || "left"} button${upTarget ? ` at ${upTarget}` : ""}`;
    }
    case "KEY_PRESS": {
      const key = config.key as string | undefined;
      return key ? `Press key: ${key}` : "No key selected";
    }
    case "KEY_DOWN": {
      const keyDown = config.key as string | undefined;
      return keyDown ? `Hold key down: ${keyDown}` : "No key selected";
    }
    case "KEY_UP": {
      const keyUp = config.key as string | undefined;
      return keyUp ? `Release key: ${keyUp}` : "No key selected";
    }
    case "TYPE": {
      const textSource = config.textSource as string | undefined;
      if (textSource === "stateString") {
        const selectedState = config.selectedState as string | undefined;
        if (!selectedState) return "No state selected";
        const state = states.find((s) => s.id === selectedState);
        if (!state) return "Invalid state";

        const selectedStateStrings = config.selectedStateStrings as
          | string[]
          | undefined;
        if (
          selectedStateStrings &&
          selectedStateStrings.length > 0 &&
          state.strings
        ) {
          // Get the actual string values
          const selectedStrings = state.strings
            .filter((s) => selectedStateStrings.includes(s.id))
            .map((s) => s.value)
            .filter((v) => v); // Remove empty values

          if (selectedStrings.length === 0) {
            return `No strings selected from ${state.name || state.id}`;
          }

          // Join multiple strings with " | " and truncate if too long
          const combinedText = selectedStrings.join(" | ");
          const displayText =
            combinedText.length > 40
              ? combinedText.substring(0, 40) + "..."
              : combinedText;

          return `Type "${displayText.replace(/\n/g, "\u21B5").replace(/\t/g, "\u2192")}" (${state.name || state.id})`;
        } else {
          return `No strings selected from ${state.name || state.id}`;
        }
      } else {
        const text = config.text as string | undefined;
        if (!text) return "No text specified";
        // Truncate long text and show special keys
        const displayText =
          text.length > 30 ? text.substring(0, 30) + "..." : text;
        return `Type "${displayText.replace(/\n/g, "\u21B5").replace(/\t/g, "\u2192")}"`;
      }
    }
    case "DRAG": {
      const removedImageTo = config.removedImageTo as string | undefined;
      if (removedImageTo) {
        return `Drag from ${config.from as string} to [REMOVED: ${removedImageTo}]`;
      }
      return `Drag from ${config.from as string} to ${(config.to as string | undefined) || "target"}`;
    }
    case "SCROLL":
      return `Scroll ${config.direction as string} ${config.amount as number} units`;
    case "VANISH": {
      const removedImage = config.removedImage as string | undefined;
      if (removedImage) {
        return `Wait for [REMOVED: ${removedImage}] to vanish`;
      }
      // Handle new target structure
      const vanishTarget = config.target as
        | { type?: string; imageId?: string }
        | undefined;
      const vanishImageId =
        vanishTarget?.type === "image"
          ? vanishTarget.imageId
          : (config.image as string | undefined);
      if (vanishImageId) {
        const vanishImage = images.find((img) => img.id === vanishImageId);
        if (vanishImage) {
          const nameWithoutExtension = vanishImage.name.replace(
            /\.(png|jpg|jpeg|gif|webp|svg)$/i,
            ""
          );
          return `Wait for ${nameWithoutExtension} to vanish`;
        }
        return `Wait for ${vanishImageId} to vanish`;
      }
      return "No image selected";
    }
    case "GO_TO_STATE": {
      // Support both old 'states' key and new 'stateIds' key for backward compatibility
      const targetStates =
        (config.stateIds as string[] | undefined) ||
        (config.states as string[] | undefined) ||
        [];
      if (targetStates.length > 0) {
        const stateNames = targetStates.map((stateId: string) => {
          const state = states.find((s) => s.id === stateId);
          return state ? state.name : stateId;
        });
        if (stateNames.length === 1) {
          return `Target: ${stateNames[0]}`;
        } else {
          return `Targets: ${stateNames.join(", ")} (${stateNames.length} states)`;
        }
      }
      return "No states selected";
    }
    case "RUN_WORKFLOW": {
      const processId = config.process as string | undefined;
      if (processId) {
        const proc = workflows.find((p) => p.id === processId);
        return proc ? proc.name : processId;
      }
      return "No process selected";
    }
    case "IF": {
      const thenActions = config.thenActions as unknown[] | undefined;
      const elseActions = config.elseActions as unknown[] | undefined;
      const condition = config.condition as { type?: string } | undefined;
      const thenCount = thenActions?.length || 0;
      const elseCount = elseActions?.length || 0;
      const conditionType = condition?.type || "not configured";
      if (elseCount > 0) {
        return `${conditionType} condition: ${thenCount} then-actions, ${elseCount} else-actions`;
      } else {
        return `${conditionType} condition: ${thenCount} then-actions`;
      }
    }
    case "LOOP": {
      const loopType = (config.loopType as string | undefined) || "FOR";
      const loopActions = config.actions as unknown[] | undefined;
      const actionCount = loopActions?.length || 0;
      if (loopType === "FOR") {
        const iterations = (config.iterations as number | undefined) || 0;
        return `FOR loop: ${iterations} iterations, ${actionCount} actions`;
      } else if (loopType === "WHILE") {
        return `WHILE loop: ${actionCount} actions`;
      } else {
        return `FOREACH loop: ${actionCount} actions`;
      }
    }
    default:
      return "Configure action";
  }
}
