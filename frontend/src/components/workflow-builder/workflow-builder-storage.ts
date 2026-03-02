import type { UnifiedWorkflow } from "@/types/unified-workflow";

const STORAGE_KEY = "qontinui-web-workflow-builder-draft";
const STORAGE_KEY_ORIGINAL = "qontinui-web-workflow-builder-original";

export function loadFromStorage(): UnifiedWorkflow | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object" && "setup_steps" in parsed) {
        return parsed as UnifiedWorkflow;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function loadOriginalFromStorage(): UnifiedWorkflow | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_ORIGINAL);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object" && "setup_steps" in parsed) {
        return parsed as UnifiedWorkflow;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveToStorage(workflow: UnifiedWorkflow): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workflow));
  } catch {
    // ignore
  }
}

export function saveOriginalToStorage(workflow: UnifiedWorkflow | null): void {
  try {
    if (workflow) {
      localStorage.setItem(STORAGE_KEY_ORIGINAL, JSON.stringify(workflow));
    } else {
      localStorage.removeItem(STORAGE_KEY_ORIGINAL);
    }
  } catch {
    // ignore
  }
}
