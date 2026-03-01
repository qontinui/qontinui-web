import { ScreenshotRegion, ScreenshotLocation } from "../../types/Screenshot";
import {
  StateRegion as ContextStateRegion,
  StateLocation as ContextStateLocation,
} from "../../contexts/automation-context/types";

// Helper function to convert Screenshot Region to Context StateRegion
export const convertToContextRegion = (
  region: ScreenshotRegion
): ContextStateRegion => {
  return {
    id: region.id,
    name: region.name,
    x: region.bounds.x,
    y: region.bounds.y,
    width: region.bounds.width,
    height: region.bounds.height,
    isSearchRegion: region.type === "SearchRegion",
    referenceImageId: region.linkedStateObjectId,
  };
};

// Helper function to convert Screenshot Location to Context StateLocation
export const convertToContextLocation = (
  location: ScreenshotLocation
): ContextStateLocation => {
  return {
    id: location.id,
    name: location.name,
    x: location.x,
    y: location.y,
    fixed: location.fixed || false,
    anchor: location.anchor || false,
    offsetX: location.offsetX,
    offsetY: location.offsetY,
    referenceImageId: location.referenceImageId,
  };
};
