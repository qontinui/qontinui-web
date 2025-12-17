/**
 * Monitor Validation Library
 *
 * Validates that all state elements have proper monitor associations before export.
 *
 * Rules:
 * - StateImage/StateString: monitors must be set (can be [-1] for "all monitors")
 * - StateRegion/StateLocation: monitors must be set AND not be [-1] (specific monitor required)
 */

import type { State } from "@/contexts/automation-context/types";

export interface MonitorValidationError {
  stateId: string;
  stateName: string;
  elementType: "image" | "region" | "location" | "string";
  elementId: string;
  elementName: string;
  error: "missing" | "invalid"; // missing = no monitors, invalid = -1 for regions/locations
}

/**
 * Validates monitor associations for all states.
 * Returns an array of validation errors.
 */
export function validateMonitorAssociations(
  states: State[]
): MonitorValidationError[] {
  const errors: MonitorValidationError[] = [];

  for (const state of states) {
    // Validate StateImages
    if (state.stateImages) {
      for (const stateImage of state.stateImages) {
        if (!stateImage.monitors || stateImage.monitors.length === 0) {
          errors.push({
            stateId: state.id,
            stateName: state.name,
            elementType: "image",
            elementId: stateImage.id,
            elementName: stateImage.name,
            error: "missing",
          });
        }
      }
    }

    // Validate StateRegions
    if (state.regions) {
      for (const region of state.regions) {
        if (!region.monitors || region.monitors.length === 0) {
          errors.push({
            stateId: state.id,
            stateName: state.name,
            elementType: "region",
            elementId: region.id,
            elementName: region.name,
            error: "missing",
          });
        } else if (region.monitors.includes(-1)) {
          errors.push({
            stateId: state.id,
            stateName: state.name,
            elementType: "region",
            elementId: region.id,
            elementName: region.name,
            error: "invalid",
          });
        }
      }
    }

    // Validate StateLocations
    if (state.locations) {
      for (const location of state.locations) {
        if (!location.monitors || location.monitors.length === 0) {
          errors.push({
            stateId: state.id,
            stateName: state.name,
            elementType: "location",
            elementId: location.id,
            elementName: location.name,
            error: "missing",
          });
        } else if (location.monitors.includes(-1)) {
          errors.push({
            stateId: state.id,
            stateName: state.name,
            elementType: "location",
            elementId: location.id,
            elementName: location.name,
            error: "invalid",
          });
        }
      }
    }

    // Validate StateStrings
    if (state.strings) {
      for (const string of state.strings) {
        if (!string.monitors || string.monitors.length === 0) {
          errors.push({
            stateId: state.id,
            stateName: state.name,
            elementType: "string",
            elementId: string.id,
            elementName: string.name,
            error: "missing",
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Groups validation errors by state for easier display
 */
export function groupErrorsByState(
  errors: MonitorValidationError[]
): Map<string, MonitorValidationError[]> {
  const grouped = new Map<string, MonitorValidationError[]>();

  for (const error of errors) {
    const existing = grouped.get(error.stateId) || [];
    grouped.set(error.stateId, [...existing, error]);
  }

  return grouped;
}

/**
 * Groups validation errors by element type for categorized display
 */
export function groupErrorsByType(
  errors: MonitorValidationError[]
): Record<
  "image" | "region" | "location" | "string",
  MonitorValidationError[]
> {
  return {
    image: errors.filter((e) => e.elementType === "image"),
    region: errors.filter((e) => e.elementType === "region"),
    location: errors.filter((e) => e.elementType === "location"),
    string: errors.filter((e) => e.elementType === "string"),
  };
}

/**
 * Get a human-readable description of a validation error
 */
export function getErrorDescription(error: MonitorValidationError): string {
  const elementTypeLabel = {
    image: "State Image",
    region: "Region",
    location: "Location",
    string: "String",
  }[error.elementType];

  if (error.error === "missing") {
    return `${elementTypeLabel} "${error.elementName}" has no monitors assigned`;
  } else {
    return `${elementTypeLabel} "${error.elementName}" cannot use "All Monitors" (-1) - specific monitor required`;
  }
}
