import { Region } from "@/types/pattern-optimization";
import type { DragHandle } from "../_types/region-interaction";

export function getHandlePositions(
  region: Region
): { pos: DragHandle; x: number; y: number }[] {
  const { x, y, width, height } = region;
  return [
    { pos: "tl", x, y },
    { pos: "tr", x: x + width, y },
    { pos: "bl", x, y: y + height },
    { pos: "br", x: x + width, y: y + height },
    { pos: "t", x: x + width / 2, y },
    { pos: "r", x: x + width, y: y + height / 2 },
    { pos: "b", x: x + width / 2, y: y + height },
    { pos: "l", x, y: y + height / 2 },
  ];
}

export function getHandleAtPosition(
  imgX: number,
  imgY: number,
  region: Region | null,
  zoom: number
): DragHandle {
  if (!region) return null;

  const handleSize = 12 / zoom;
  const handles = getHandlePositions(region);

  for (const handle of handles) {
    if (
      Math.abs(imgX - handle.x) < handleSize &&
      Math.abs(imgY - handle.y) < handleSize
    ) {
      return handle.pos;
    }
  }

  const { x, y, width, height } = region;
  if (imgX >= x && imgX <= x + width && imgY >= y && imgY <= y + height) {
    return "move";
  }

  return null;
}

export function getCursorForHandle(handle: DragHandle): string {
  switch (handle) {
    case "tl":
    case "br":
      return "nwse-resize";
    case "tr":
    case "bl":
      return "nesw-resize";
    case "t":
    case "b":
      return "ns-resize";
    case "l":
    case "r":
      return "ew-resize";
    case "move":
      return "move";
    default:
      return "crosshair";
  }
}

export function applyDragToRegion(
  region: Region,
  handle: DragHandle,
  dx: number,
  dy: number
): Region {
  const newRegion = { ...region };

  switch (handle) {
    case "move":
      newRegion.x = region.x + dx;
      newRegion.y = region.y + dy;
      break;
    case "tl":
      newRegion.x = region.x + dx;
      newRegion.y = region.y + dy;
      newRegion.width = region.width - dx;
      newRegion.height = region.height - dy;
      break;
    case "tr":
      newRegion.y = region.y + dy;
      newRegion.width = region.width + dx;
      newRegion.height = region.height - dy;
      break;
    case "bl":
      newRegion.x = region.x + dx;
      newRegion.width = region.width - dx;
      newRegion.height = region.height + dy;
      break;
    case "br":
      newRegion.width = region.width + dx;
      newRegion.height = region.height + dy;
      break;
    case "t":
      newRegion.y = region.y + dy;
      newRegion.height = region.height - dy;
      break;
    case "r":
      newRegion.width = region.width + dx;
      break;
    case "b":
      newRegion.height = region.height + dy;
      break;
    case "l":
      newRegion.x = region.x + dx;
      newRegion.width = region.width - dx;
      break;
  }

  // Ensure positive dimensions
  if (newRegion.width < 0) {
    newRegion.x += newRegion.width;
    newRegion.width = Math.abs(newRegion.width);
  }
  if (newRegion.height < 0) {
    newRegion.y += newRegion.height;
    newRegion.height = Math.abs(newRegion.height);
  }

  return newRegion;
}
