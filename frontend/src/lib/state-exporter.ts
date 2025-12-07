/**
 * State export functionality for qontinui
 * Exports states with all their objects (StateImage, StateRegion, StateLocation, StateString)
 */

import { State } from "../contexts/automation-context/types";
import { Screenshot } from "../types/Screenshot";

interface QontinuiStateExport {
  version: string;
  exportDate: string;
  states: QontinuiState[];
}

interface QontinuiState {
  id: string;
  name: string;
  description: string;
  initial: boolean;
  stateImages: QontinuiStateImage[];
  stateRegions: QontinuiStateRegion[];
  stateLocations: QontinuiStateLocation[];
  stateStrings: QontinuiStateString[];
}

interface QontinuiStateImage {
  id: string;
  name: string;
  imagePath?: string; // Path to saved image file
  imageData?: string; // Base64 image data
  searchRegions: QontinuiSearchRegion[];
  fixed: boolean;
}

interface QontinuiSearchRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface QontinuiStateRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  searchRegion?: boolean; // If true, this is a SearchRegion linked to a StateImage
}

interface QontinuiStateLocation {
  id: string;
  name: string;
  x: number;
  y: number;
  fixed: boolean;
  anchor: boolean;
  anchorType?: string;
  referenceImageId?: string;
  offsetX: number;
  offsetY: number;
  position?: {
    percentW: number;
    percentH: number;
    positionName?: string;
  };
}

interface QontinuiStateString {
  id: string;
  name: string;
  value: string;
  // Type flags
  identifier?: boolean; // OCR verification
  inputText?: boolean; // To be typed (default: true)
  expectedText?: boolean; // Validation
  regexPattern?: boolean; // Regex pattern
}

/**
 * Export states with screenshot data to qontinui format
 */
export function exportStatesToQontinui(
  states: State[],
  screenshots: Screenshot[]
): QontinuiStateExport {
  const qontinuiStates: QontinuiState[] = states.map((state) => {
    // Get all screenshots associated with this state
    const stateScreenshots = screenshots.filter((s) =>
      s.associatedStates.includes(state.id)
    );

    // Collect all state images with deduplication
    const stateImages: QontinuiStateImage[] = [];
    const imageIds = new Set<string>();

    // Add StateImages from state definition
    if (state.stateImages) {
      state.stateImages.forEach((stateImage) => {
        if (!imageIds.has(stateImage.id)) {
          imageIds.add(stateImage.id);
          // Get image data and fixed flag from first pattern
          const firstPattern = stateImage.patterns?.[0];
          stateImages.push({
            id: stateImage.id,
            name: stateImage.name,
            imageData: firstPattern?.imageId, // Pattern references image by ID
            searchRegions: (stateImage.searchRegions || []).map((sr) => ({
              id: sr.id,
              name: sr.name,
              x: sr.x,
              y: sr.y,
              width: sr.width,
              height: sr.height,
            })),
            fixed: firstPattern?.fixed || false,
          });
        }
      });
    }

    // Add StateImages from screenshots (if not already added)
    stateScreenshots.forEach((screenshot) => {
      // Create a StateImage for each screenshot
      const stateImageId = `state_image_${screenshot.id}`;

      // Find SearchRegions (regions of type SearchRegion linked to this StateImage)
      const searchRegions = screenshot.regions
        .filter((r) => r.type === "SearchRegion")
        .map((r) => ({
          id: r.id,
          name: r.name,
          x: r.bounds.x,
          y: r.bounds.y,
          width: r.bounds.width,
          height: r.bounds.height,
        }));

      // Only add if not already present
      if (!imageIds.has(stateImageId)) {
        imageIds.add(stateImageId);
        stateImages.push({
          id: stateImageId,
          name: screenshot.name,
          imageData: screenshot.imageData,
          searchRegions,
          fixed: false,
        });
      }
    });

    // Collect all state regions with deduplication
    const stateRegions: QontinuiStateRegion[] = [];
    const regionIds = new Set<string>();

    // Add StateRegions from state definition
    if (state.regions) {
      state.regions.forEach((region) => {
        if (!regionIds.has(region.id)) {
          regionIds.add(region.id);
          stateRegions.push({
            id: region.id,
            name: region.name,
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
            searchRegion: false,
          });
        }
      });
    }

    // Add StateRegions from screenshots
    stateScreenshots.forEach((screenshot) => {
      screenshot.regions
        .filter((r) => r.type === "StateRegion")
        .forEach((region) => {
          if (!regionIds.has(region.id)) {
            regionIds.add(region.id);
            stateRegions.push({
              id: region.id,
              name: region.name,
              x: region.bounds.x,
              y: region.bounds.y,
              width: region.bounds.width,
              height: region.bounds.height,
              searchRegion: false,
            });
          }
        });
    });

    // Collect all state locations with deduplication
    const stateLocations: QontinuiStateLocation[] = [];
    const locationIds = new Set<string>();

    // Add StateLocations from state definition
    if (state.locations) {
      state.locations.forEach((location) => {
        if (!locationIds.has(location.id)) {
          locationIds.add(location.id);
          stateLocations.push({
            id: location.id,
            name: location.name,
            x: location.x,
            y: location.y,
            fixed: location.fixed ?? false,
            anchor: location.anchor ?? false,
            referenceImageId: location.referenceImageId,
            offsetX: location.offsetX ?? 0,
            offsetY: location.offsetY ?? 0,
            position: location.position,
          });
        }
      });
    }

    // Add StateLocations from screenshots
    stateScreenshots.forEach((screenshot) => {
      screenshot.locations.forEach((location) => {
        if (!locationIds.has(location.id)) {
          locationIds.add(location.id);
          stateLocations.push({
            id: location.id,
            name: location.name,
            x: location.x,
            y: location.y,
            fixed: location.fixed || false,
            anchor: location.anchor || false,
            anchorType: location.anchorType,
            referenceImageId: location.referenceImageId,
            offsetX: location.offsetX || 0,
            offsetY: location.offsetY || 0,
          });
        }
      });
    });

    // Collect all state strings with deduplication
    const stateStrings: QontinuiStateString[] = [];
    const stringIds = new Set<string>();

    (state.strings || []).forEach((str) => {
      if (!stringIds.has(str.id)) {
        stringIds.add(str.id);
        stateStrings.push({
          id: str.id,
          name: str.name,
          value: str.value,
          identifier: str.identifier,
          inputText: str.inputText,
          expectedText: str.expectedText,
          regexPattern: str.regexPattern,
        });
      }
    });

    return {
      id: state.id,
      name: state.name,
      description: state.description || "",
      initial: state.initial || false,
      stateImages,
      stateRegions,
      stateLocations,
      stateStrings,
    };
  });

  return {
    version: "1.0.0",
    exportDate: new Date().toISOString(),
    states: qontinuiStates,
  };
}

/**
 * Export to JSON file
 */
export function downloadStateExport(
  states: State[],
  screenshots: Screenshot[],
  filename: string = "qontinui-states.json"
): void {
  const exportData = exportStatesToQontinui(states, screenshots);
  const jsonString = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generate Python code for state definition
 */
export function generatePythonStateCode(state: QontinuiState): string {
  const lines: string[] = [];

  lines.push(`# State: ${state.name}`);
  lines.push(`state = State()`);
  lines.push(`state.name = "${state.name}"`);
  lines.push(`state.description = "${state.description}"`);
  lines.push(`state.initial = ${state.initial ? "True" : "False"}`);
  lines.push("");

  // Add StateImages
  if (state.stateImages.length > 0) {
    lines.push("# StateImages");
    state.stateImages.forEach((img) => {
      lines.push(`state_image = StateImage()`);
      lines.push(`state_image.name = "${img.name}"`);
      lines.push(`state_image.fixed = ${img.fixed ? "True" : "False"}`);

      // Add SearchRegions
      if (img.searchRegions.length > 0) {
        lines.push(`search_regions = SearchRegions()`);
        img.searchRegions.forEach((sr) => {
          lines.push(
            `search_regions.add_region(Region(${sr.x}, ${sr.y}, ${sr.width}, ${sr.height}))`
          );
        });
        lines.push(`state_image.set_search_regions(search_regions)`);
      }

      lines.push(`state.add_state_image(state_image)`);
      lines.push("");
    });
  }

  // Add StateRegions
  if (state.stateRegions.length > 0) {
    lines.push("# StateRegions");
    state.stateRegions.forEach((region) => {
      lines.push(
        `state.add_state_region(StateRegion("${region.name}", ${region.x}, ${region.y}, ${region.width}, ${region.height}))`
      );
    });
    lines.push("");
  }

  // Add StateLocations
  if (state.stateLocations.length > 0) {
    lines.push("# StateLocations");
    state.stateLocations.forEach((loc) => {
      const params: string[] = [];
      params.push(`x=${loc.x}`);
      params.push(`y=${loc.y}`);
      params.push(`name="${loc.name}"`);
      params.push(`fixed=${loc.fixed ? "True" : "False"}`);

      if (loc.referenceImageId) {
        params.push(`reference_image_id="${loc.referenceImageId}"`);
      }
      if (loc.offsetX !== 0) {
        params.push(`offset_x=${loc.offsetX}`);
      }
      if (loc.offsetY !== 0) {
        params.push(`offset_y=${loc.offsetY}`);
      }

      lines.push(`location = Location(${params.join(", ")})`);

      if (loc.anchor) {
        lines.push(
          `# This location is also used as an anchor (${loc.anchorType || "CENTER"})`
        );
      }

      lines.push(`state.add_state_location(location)`);
      lines.push("");
    });
  }

  // Add StateStrings
  if (state.stateStrings.length > 0) {
    lines.push("# StateStrings");
    state.stateStrings.forEach((str) => {
      const params: string[] = [];
      params.push(`name="${str.name}"`);
      params.push(`value="${str.value}"`);

      // Add type flags if set
      if (str.identifier) params.push("identifier=True");
      if (str.inputText !== undefined && str.inputText)
        params.push("input_text=True");
      if (str.expectedText) params.push("expected_text=True");
      if (str.regexPattern) params.push("regex_pattern=True");

      lines.push(`state.add_state_string(StateString(${params.join(", ")}))`);
    });
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Export states as Python code
 */
export function downloadPythonStateCode(
  states: State[],
  screenshots: Screenshot[],
  filename: string = "qontinui_states.py"
): void {
  const exportData = exportStatesToQontinui(states, screenshots);

  const lines: string[] = [];
  lines.push('"""');
  lines.push("Qontinui State Definitions");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('"""');
  lines.push("");
  lines.push("from qontinui.model.state import State");
  lines.push(
    "from qontinui.model.state import StateImage, StateRegion, StateString"
  );
  lines.push(
    "from qontinui.model.element import Location, Region, SearchRegions"
  );
  lines.push("");
  lines.push("");

  exportData.states.forEach((state) => {
    lines.push(generatePythonStateCode(state));
    lines.push("");
    lines.push("# " + "=".repeat(50));
    lines.push("");
  });

  const pythonCode = lines.join("\n");
  const blob = new Blob([pythonCode], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
