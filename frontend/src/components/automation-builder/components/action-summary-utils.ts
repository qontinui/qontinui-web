/**
 * Action Summary Utilities
 *
 * Pure function that generates human-readable summary strings for each
 * action type. Split from sequential-editor-utils due to size.
 */

import type { Action } from "@/lib/action-schema/action-types";
import type {
  StateType,
  WorkflowType,
  ImageType,
} from "./sequential-editor-types";

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

      // Handle new target structure with imageIds array
      const imageIds = target?.type === "image" ? target.imageIds : null;
      const imageId =
        imageIds?.[0] ||
        target?.imageId ||
        (config.image as string | undefined);

      if (imageId) {
        let stateImageName: string | null = null;
        for (const state of states) {
          const stateImage = state.stateImages?.find((si) => si.id === imageId);
          if (stateImage) {
            stateImageName = stateImage.name;
            break;
          }
        }
        if (stateImageName) {
          const nameWithoutExtension = stateImageName.replace(
            /\.(png|jpg|jpeg|gif|webp|svg)$/i,
            ""
          );
          const suffix =
            imageIds && imageIds.length > 1
              ? ` +${imageIds.length - 1} more`
              : "";
          return `Find ${nameWithoutExtension}${suffix}`;
        }
        const image = images.find((img) => img.id === imageId);
        if (image) {
          const nameWithoutExtension = image.name.replace(
            /\.(png|jpg|jpeg|gif|webp|svg)$/i,
            ""
          );
          const suffix =
            imageIds && imageIds.length > 1
              ? ` +${imageIds.length - 1} more`
              : "";
          return `Find ${nameWithoutExtension}${suffix}`;
        }
        return "Image not found";
      }
      return "No image selected";
    }
    case "CLICK": {
      const clickConfig = config as {
        mouseButton?: string;
        target?:
          | string
          | { type?: string; imageId?: string; imageIds?: string[] };
        stateId?: string;
        imageIds?: string[];
      };
      const button = clickConfig.mouseButton?.toLowerCase() || "left";

      // Helper to get image name by ID
      const getImageName = (imgId: string): string | null => {
        for (const s of states) {
          const img = s.stateImages?.find((si) => si.id === imgId);
          if (img) {
            return img.name.replace(/\.(png|jpg|jpeg|gif|webp|svg)$/i, "");
          }
        }
        return null;
      };

      // Handle object target format: { type: "StateImage" | "image", imageId?: string, imageIds?: string[] }
      // Note: "StateImage" is @deprecated - use "stateImage" (lowercase) instead
      if (clickConfig.target && typeof clickConfig.target === "object") {
        const targetObj = clickConfig.target;
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

        // Unknown object type - stringify for debugging
        return `${button} click on ${targetType || "target"}`;
      }

      // Handle legacy string target format: "StateImage"
      // Note: "StateImage" is @deprecated - use "stateImage" (lowercase) instead
      if (
        clickConfig.target === "StateImage" ||
        clickConfig.target === "stateImage"
      ) {
        // Check imageIds first (new flow without requiring stateId)
        if (clickConfig.imageIds && clickConfig.imageIds.length > 0) {
          // Get image names from all states
          const names: string[] = [];
          for (const imgId of clickConfig.imageIds) {
            const name = getImageName(imgId);
            if (name) {
              names.push(name);
            }
          }

          if (names.length === 1) {
            return `${button} click on ${names[0]}`;
          } else if (names.length > 1) {
            return `${button} click on ${names[0]} +${names.length - 1} more`;
          }
        }

        // Legacy: check stateId if imageIds not available
        if (clickConfig.stateId) {
          const state = states.find((s) => s.id === clickConfig.stateId);
          const stateName = state?.name || clickConfig.stateId;
          return `${button} click on any image from ${stateName}`;
        }

        return `${button} click on StateImage (no image selected)`;
      }

      // Handle other string targets
      if (typeof clickConfig.target === "string") {
        return `${button} click on ${clickConfig.target}`;
      }

      return `${button} click on target`;
    }
    case "TYPE": {
      const typeConfig = config as {
        text?: string;
        textSource?: { stateId: string; stringIds: string[] };
      };
      if (typeConfig.textSource) {
        const stateId = typeConfig.textSource.stateId;
        if (!stateId) return "No state selected";
        const state = states.find((s) => s.id === stateId);
        if (!state) return "Invalid state";
        if (typeConfig.textSource.stringIds?.length > 0 && state.strings) {
          const selectedStrings = state.strings
            .filter((s) => typeConfig.textSource!.stringIds.includes(s.id))
            .map((s) => s.value)
            .filter((v) => v);
          if (selectedStrings.length === 0) {
            return `No strings selected from ${state.name || state.id}`;
          }
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
        if (!typeConfig.text) return "No text specified";
        const displayText =
          typeConfig.text.length > 30
            ? typeConfig.text.substring(0, 30) + "..."
            : typeConfig.text;
        return `Type "${displayText.replace(/\n/g, "\u21B5").replace(/\t/g, "\u2192")}"`;
      }
    }
    case "DRAG": {
      const dragConfig = config as {
        source?: unknown;
        destination?: unknown;
      };
      return `Drag from ${dragConfig.source || "source"} to ${dragConfig.destination || "destination"}`;
    }
    case "SCROLL": {
      const scrollConfig = config as { direction?: string; clicks?: number };
      return `Scroll ${scrollConfig.direction} ${scrollConfig.clicks || 1} clicks`;
    }
    case "VANISH": {
      const vanishConfig = config as {
        target?: { type?: string; imageId?: string };
      };
      const vanishImageId =
        vanishConfig.target?.type === "image"
          ? vanishConfig.target.imageId
          : undefined;
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
    case "RAG_FIND": {
      const ragConfig = config as {
        target?: { stateImageId?: string };
        topK?: number;
      };
      const stateImageId = ragConfig.target?.stateImageId;
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
            return `RAG Find: ${nameWithoutExtension}${ragConfig.topK && ragConfig.topK > 1 ? ` (top ${ragConfig.topK})` : ""}`;
          }
        }
        return "StateImage not found";
      }
      return "No element selected";
    }
    case "GO_TO_STATE": {
      const gotoConfig = config as {
        stateIds?: string[];
        states?: string[];
        stateId?: string;
      };
      // Support new format (stateIds), old format (states), and legacy format (stateId)
      const stateIdList =
        gotoConfig.stateIds ||
        gotoConfig.states ||
        (gotoConfig.stateId ? [gotoConfig.stateId] : []);

      if (stateIdList.length > 0) {
        const stateNames = stateIdList
          .map((id) => {
            const state = states.find((s) => s.id === id);
            return state ? state.name : id;
          })
          .filter(Boolean);

        if (stateNames.length === 0) {
          return "No state selected";
        } else if (stateNames.length === 1) {
          return `Target: ${stateNames[0]}`;
        } else {
          return `Targets: ${stateNames.join(", ")}`;
        }
      }
      return "No state selected";
    }
    case "RUN_WORKFLOW": {
      const workflowConfig = config as { workflowId?: string };
      if (workflowConfig.workflowId) {
        const workflow = workflows.find(
          (w) => w.id === workflowConfig.workflowId
        );
        return workflow ? workflow.name : workflowConfig.workflowId;
      }
      return "No workflow selected";
    }
    case "IF": {
      const ifConfig = config as {
        thenActions?: unknown[];
        elseActions?: unknown[];
        condition?: { type?: string };
      };
      const thenCount = ifConfig.thenActions?.length || 0;
      const elseCount = ifConfig.elseActions?.length || 0;
      const conditionType = ifConfig.condition?.type || "not configured";
      if (elseCount > 0) {
        return `${conditionType} condition: ${thenCount} then-actions, ${elseCount} else-actions`;
      } else {
        return `${conditionType} condition: ${thenCount} then-actions`;
      }
    }
    case "LOOP": {
      const loopConfig = config as {
        loopType?: string;
        actions?: unknown[];
        iterations?: number;
      };
      const loopType = loopConfig.loopType || "FOR";
      const actionCount = loopConfig.actions?.length || 0;
      if (loopType === "FOR") {
        const iterations = loopConfig.iterations || 0;
        return `FOR loop: ${iterations} iterations, ${actionCount} actions`;
      } else if (loopType === "WHILE") {
        return `WHILE loop: ${actionCount} actions`;
      } else {
        return `FOREACH loop: ${actionCount} actions`;
      }
    }
    case "MOUSE_MOVE": {
      const config = action.config as {
        target?: unknown;
        x?: number;
        y?: number;
      };
      if (config.target === "Coordinates") {
        return `Move mouse to (${config.x}, ${config.y})`;
      }
      return `Move mouse to ${config.target}`;
    }
    case "MOUSE_DOWN": {
      const config = action.config as {
        target?: string;
        button?: string;
        x?: number;
        y?: number;
        mouseButton?: string;
      };
      if (config.target === "Coordinates") {
        return `Press ${config.button || config.mouseButton || "left"} button at (${config.x}, ${config.y})`;
      }
      return `Press ${config.button || config.mouseButton || "left"} button${config.target ? ` at ${config.target}` : ""}`;
    }
    case "MOUSE_UP": {
      const config = action.config as {
        target?: string;
        button?: string;
        x?: number;
        y?: number;
        mouseButton?: string;
      };
      if (config.target === "Coordinates") {
        return `Release ${config.button || config.mouseButton || "left"} button at (${config.x}, ${config.y})`;
      }
      return `Release ${config.button || config.mouseButton || "left"} button${config.target ? ` at ${config.target}` : ""}`;
    }
    case "KEY_PRESS": {
      const config = action.config as { key?: string; keys?: string[] };
      return config.key || config.keys?.[0]
        ? `Press key: ${config.key || config.keys?.[0]}`
        : "No key selected";
    }
    case "KEY_DOWN": {
      const config = action.config as { key?: string; keys?: string[] };
      return config.key || config.keys?.[0]
        ? `Hold key down: ${config.key || config.keys?.[0]}`
        : "No key selected";
    }
    case "KEY_UP": {
      const config = action.config as { key?: string; keys?: string[] };
      return config.key || config.keys?.[0]
        ? `Release key: ${config.key || config.keys?.[0]}`
        : "No key selected";
    }
    case "SHELL": {
      const config = action.config as {
        command?: string;
        shell?: string;
        description?: string;
      };
      if (config.description) {
        return config.description;
      }
      if (config.command) {
        const displayCmd =
          config.command.length > 40
            ? config.command.substring(0, 40) + "..."
            : config.command;
        return `${config.shell || "sh"}: ${displayCmd}`;
      }
      return "No command specified";
    }
    case "SHELL_SCRIPT": {
      const config = action.config as {
        script?: string;
        shell?: string;
        description?: string;
      };
      if (config.description) {
        return config.description;
      }
      if (config.script) {
        const lines = config.script.split("\n").filter((l) => l.trim());
        return `${config.shell || "bash"} script (${lines.length} lines)`;
      }
      return "No script specified";
    }
    case "AI_PROMPT": {
      const config = action.config as {
        provider?: string;
        prompt?: string;
        description?: string;
      };
      if (config.description) {
        return config.description;
      }
      const provider = config.provider || "claude";
      if (config.prompt) {
        const displayPrompt =
          config.prompt.length > 40
            ? config.prompt.substring(0, 40) + "..."
            : config.prompt;
        return `AI Prompt (${provider}): ${displayPrompt}`;
      }
      return `AI Prompt (${provider})`;
    }
    default:
      return "Configure action";
  }
}
