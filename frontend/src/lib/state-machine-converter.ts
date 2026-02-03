/**
 * State Machine Converter
 *
 * Converts generated state machine configs from the click-to-template
 * system to QontinuiConfig format for import into projects.
 */

import type {
  QontinuiConfig,
  ImageAsset,
  State,
  StateImage,
  Pattern,
  Transition,
  OutgoingTransition,
  ConfigMetadata,
  Category,
  Workflow,
} from "./export-schema";
import type {
  GenerateStateMachineResponse,
  StateDefResponse,
  TransitionDefResponse,
} from "@/services/template-capture-service";

// Current export schema version
const CURRENT_VERSION = "2.12.0";

/**
 * Convert a generated state machine response to QontinuiConfig format
 */
export function convertToQontinuiConfig(
  response: GenerateStateMachineResponse,
  options?: {
    projectId?: string;
    author?: string;
    targetApplication?: string;
  }
): QontinuiConfig {
  const config = response.config;
  const now = new Date().toISOString();

  // Extract images from all state images
  const { images, stateImagePatternMap } = extractImages(config.states);

  // Convert states
  const states = convertStates(config.states, stateImagePatternMap);

  // Convert transitions
  const transitions = convertTransitions(config.transitions, config.states);

  // Create metadata
  const metadata: ConfigMetadata = {
    name: config.name,
    description: `Generated from click-to-template capture using ${response.grouping_result.method} grouping`,
    author: options?.author,
    created: now,
    modified: now,
    tags: ["generated", "click-capture", response.grouping_result.method],
    targetApplication: options?.targetApplication,
    projectId: options?.projectId,
  };

  // Create default category
  const categories: Category[] = [{ name: "Main", automationEnabled: true }];

  // Create empty workflows array (will be populated by user)
  const workflows: Workflow[] = [];

  return {
    version: CURRENT_VERSION,
    metadata,
    images,
    workflows,
    states,
    transitions,
    categories,
  };
}

/**
 * Extract images from state definitions and create ImageAssets
 */
function extractImages(states: StateDefResponse[]): {
  images: ImageAsset[];
  stateImagePatternMap: Map<string, string>; // stateImageId -> patternId
} {
  const images: ImageAsset[] = [];
  const stateImagePatternMap = new Map<string, string>();

  for (const state of states) {
    for (const si of state.state_images) {
      // Each state image becomes one image asset
      const imageId = `img_${si.id}`;
      const patternId = `pattern_${si.id}`;

      // Parse base64 to extract format
      const format = extractImageFormat(si.pixel_data_base64);

      images.push({
        id: imageId,
        name: si.name,
        data: si.pixel_data_base64,
        format,
        width: si.bbox.width,
        height: si.bbox.height,
      });

      stateImagePatternMap.set(si.id, patternId);
    }
  }

  return { images, stateImagePatternMap };
}

/**
 * Extract image format from base64 data
 */
function extractImageFormat(base64: string): "png" | "jpg" | "jpeg" {
  if (base64.startsWith("data:image/png")) {
    return "png";
  }
  if (
    base64.startsWith("data:image/jpeg") ||
    base64.startsWith("data:image/jpg")
  ) {
    return "jpeg";
  }
  // Default to png
  return "png";
}

/**
 * Convert state definitions to State format
 */
function convertStates(
  stateDefs: StateDefResponse[],
  stateImagePatternMap: Map<string, string>
): State[] {
  return stateDefs.map((stateDef, index) => {
    // Convert state images to StateImage format
    const stateImages: StateImage[] = stateDef.state_images.map((si) => {
      const imageId = `img_${si.id}`;
      const patternId = stateImagePatternMap.get(si.id) || `pattern_${si.id}`;

      const pattern: Pattern = {
        id: patternId,
        name: si.name,
        imageId,
        fixed: false,
        similarity: si.similarity_threshold,
      };

      // Add mask if present
      if (si.mask_base64) {
        pattern.mask = si.mask_base64;
      }

      return {
        id: `si_${si.id}`,
        name: si.name,
        patterns: [pattern],
        shared: false,
        source: "click_capture",
      };
    });

    return {
      id: stateDef.id,
      name: stateDef.name,
      description: stateDef.description,
      stateImages,
      position: {
        x: (index % 4) * 250 + 100, // Grid layout
        y: Math.floor(index / 4) * 200 + 100,
      },
      isInitial: stateDef.is_initial,
      isFinal: false,
    };
  });
}

/**
 * Convert transition definitions to Transition format
 */
function convertTransitions(
  transitionDefs: TransitionDefResponse[],
  states: StateDefResponse[]
): Transition[] {
  return transitionDefs.map((td, index) => {
    const fromState = states.find((s) => s.id === td.from_state_id);
    const toState = states.find((s) => s.id === td.to_state_id);

    // Create OutgoingTransition
    const transition: OutgoingTransition = {
      id: `transition_${index}`,
      type: "OutgoingTransition",
      name: `${fromState?.name || td.from_state_id} → ${toState?.name || td.to_state_id}`,
      description:
        td.action_type === "click" ? "Click-based transition" : undefined,
      fromState: td.from_state_id,
      toState: td.to_state_id,
      staysVisible: true,
      activateStates: [td.to_state_id],
      deactivateStates: [],
      workflows: [], // Will be populated by user
      timeout: 30,
      retryCount: 3,
    };

    return transition;
  });
}

/**
 * Merge a generated config with an existing project config
 */
export function mergeWithExistingConfig(
  existing: QontinuiConfig,
  generated: QontinuiConfig
): QontinuiConfig {
  // Generate new IDs to avoid conflicts
  const idMapping = new Map<string, string>();
  const timestamp = Date.now();

  // Map image IDs
  const newImages = generated.images.map((img, i) => {
    const newId = `${img.id}_${timestamp}_${i}`;
    idMapping.set(img.id, newId);
    return { ...img, id: newId };
  });

  // Map state IDs and update image references
  const newStates = generated.states.map((state, i) => {
    const newStateId = `${state.id}_${timestamp}_${i}`;
    idMapping.set(state.id, newStateId);

    // Update state images with new IDs
    const updatedStateImages = state.stateImages.map((si, j) => {
      const newSiId = `${si.id}_${timestamp}_${j}`;
      idMapping.set(si.id, newSiId);

      // Update pattern image references
      const updatedPatterns = si.patterns.map((p, k) => {
        const newPatternId = `${p.id}_${timestamp}_${k}`;
        const newImageId = idMapping.get(p.imageId) || p.imageId;
        return { ...p, id: newPatternId, imageId: newImageId };
      });

      return { ...si, id: newSiId, patterns: updatedPatterns };
    });

    return { ...state, id: newStateId, stateImages: updatedStateImages };
  });

  // Map transition IDs and update state references
  const newTransitions = generated.transitions.map((trans, i) => {
    const newTransId = `transition_${timestamp}_${i}`;

    if (trans.type === "OutgoingTransition") {
      const outgoing = trans as OutgoingTransition;
      return {
        ...outgoing,
        id: newTransId,
        fromState: idMapping.get(outgoing.fromState) || outgoing.fromState,
        toState: idMapping.get(outgoing.toState) || outgoing.toState,
        activateStates: outgoing.activateStates.map(
          (s) => idMapping.get(s) || s
        ),
        deactivateStates: outgoing.deactivateStates.map(
          (s) => idMapping.get(s) || s
        ),
      };
    }

    return { ...trans, id: newTransId };
  });

  // Merge arrays
  return {
    ...existing,
    metadata: {
      ...existing.metadata,
      modified: new Date().toISOString(),
    },
    images: [...existing.images, ...newImages],
    states: [...existing.states, ...newStates],
    transitions: [...existing.transitions, ...newTransitions],
  };
}

/**
 * Validate a generated config before import
 */
export function validateGeneratedConfig(config: QontinuiConfig): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  if (!config.version) {
    errors.push("Missing version field");
  }
  if (!config.metadata?.name) {
    errors.push("Missing metadata.name field");
  }
  if (!Array.isArray(config.images)) {
    errors.push("Missing or invalid images array");
  }
  if (!Array.isArray(config.states)) {
    errors.push("Missing or invalid states array");
  }
  if (!Array.isArray(config.transitions)) {
    errors.push("Missing or invalid transitions array");
  }

  // Check for empty states
  if (config.states.length === 0) {
    warnings.push("No states defined in config");
  }

  // Check state image references
  const imageIds = new Set(config.images.map((img) => img.id));
  for (const state of config.states) {
    for (const si of state.stateImages) {
      for (const pattern of si.patterns) {
        if (!imageIds.has(pattern.imageId)) {
          errors.push(
            `State image "${si.name}" references missing image "${pattern.imageId}"`
          );
        }
      }
    }
  }

  // Check transition state references
  const stateIds = new Set(config.states.map((s) => s.id));
  for (const trans of config.transitions) {
    if (trans.type === "OutgoingTransition") {
      const outgoing = trans as OutgoingTransition;
      if (!stateIds.has(outgoing.fromState)) {
        errors.push(
          `Transition "${trans.id}" references missing state "${outgoing.fromState}"`
        );
      }
      if (!stateIds.has(outgoing.toState)) {
        errors.push(
          `Transition "${trans.id}" references missing state "${outgoing.toState}"`
        );
      }
    }
  }

  // Check for initial state
  const hasInitialState = config.states.some((s) => s.isInitial);
  if (!hasInitialState && config.states.length > 0) {
    warnings.push("No initial state defined");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
