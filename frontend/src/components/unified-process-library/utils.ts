import type { LibraryItem } from "./types";

export const getItemName = (item: LibraryItem) => {
  return item.name;
};

export const getItemActionCount = (item: LibraryItem) => {
  return item.actions.length;
};

export const isLinearWorkflow = (item: LibraryItem): boolean => {
  // Check if workflow has any branching in connections
  for (const sourceId in item.connections) {
    const outputs = item.connections[sourceId];
    if (!outputs) continue;

    if (outputs.error && outputs.error.length > 0) return false;
    if (outputs.success && outputs.success.length > 0) return false;
    if (outputs.main) {
      if (outputs.main.length > 1) return false;
      const firstMain = outputs.main[0];
      if (firstMain && firstMain.length > 1) return false;
    }
  }
  return true;
};
