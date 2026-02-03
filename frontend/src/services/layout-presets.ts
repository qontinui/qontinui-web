/**
 * Layout Presets - Predefined and custom layout configurations
 *
 * This module provides a library of layout presets optimized for different
 * use cases, along with the ability to save and load custom presets.
 *
 * Features:
 * - Built-in presets for common scenarios
 * - Custom preset creation and management
 * - Preset categories and filtering
 * - Local storage persistence
 */

import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import type { LayoutOptions } from "./layout-service";

// ============================================================================
// Types
// ============================================================================

export interface LayoutPreset {
  /** Unique preset identifier */
  id: string;

  /** Display name */
  name: string;

  /** Description of when to use this preset */
  description: string;

  /** Layout style */
  style: LayoutStyle;

  /** Layout options */
  options: LayoutOptions;

  /** Icon name (for UI display) */
  icon?: string;

  /** Preset category */
  category: "compact" | "readable" | "presentation" | "custom" | "debug";

  /** Whether this is a built-in preset */
  builtIn: boolean;

  /** Creation timestamp */
  createdAt?: string;

  /** Tags for searching */
  tags?: string[];
}

export interface PresetCategory {
  id: "compact" | "readable" | "presentation" | "custom" | "debug";
  name: string;
  description: string;
  icon?: string;
}

// ============================================================================
// Built-in Presets
// ============================================================================

export const BUILTIN_PRESETS: LayoutPreset[] = [
  // Compact category
  {
    id: "compact-dense",
    name: "Compact Dense",
    description:
      "Minimize space usage with tight spacing - best for small workflows",
    style: LayoutStyle.TREE,
    options: {
      horizontalSpacing: 100,
      verticalSpacing: 80,
      branchOffset: 100,
      minNodeSpacing: 10,
    },
    icon: "compress",
    category: "compact",
    builtIn: true,
    tags: ["compact", "tight", "small"],
  },
  {
    id: "compact-balanced",
    name: "Compact Balanced",
    description: "Good balance between compactness and readability",
    style: LayoutStyle.HIERARCHICAL,
    options: {
      horizontalSpacing: 150,
      verticalSpacing: 100,
      branchOffset: 120,
      minNodeSpacing: 15,
    },
    icon: "grid",
    category: "compact",
    builtIn: true,
    tags: ["compact", "balanced"],
  },

  // Readable category
  {
    id: "readable-standard",
    name: "Readable Standard",
    description:
      "Optimized for readability with comfortable spacing - best for most workflows",
    style: LayoutStyle.HIERARCHICAL,
    options: {
      horizontalSpacing: 200,
      verticalSpacing: 120,
      branchOffset: 150,
      minNodeSpacing: 20,
    },
    icon: "eye",
    category: "readable",
    builtIn: true,
    tags: ["readable", "standard", "default"],
  },
  {
    id: "readable-spacious",
    name: "Readable Spacious",
    description: "Extra spacing for maximum clarity and ease of editing",
    style: LayoutStyle.HIERARCHICAL,
    options: {
      horizontalSpacing: 250,
      verticalSpacing: 150,
      branchOffset: 180,
      minNodeSpacing: 30,
    },
    icon: "maximize",
    category: "readable",
    builtIn: true,
    tags: ["readable", "spacious", "clear"],
  },
  {
    id: "readable-horizontal",
    name: "Readable Horizontal",
    description:
      "Left-to-right flow with good spacing - best for linear workflows",
    style: LayoutStyle.HORIZONTAL,
    options: {
      horizontalSpacing: 200,
      verticalSpacing: 120,
      branchOffset: 150,
      minNodeSpacing: 20,
    },
    icon: "arrow-right",
    category: "readable",
    builtIn: true,
    tags: ["readable", "horizontal", "linear"],
  },

  // Presentation category
  {
    id: "presentation-clean",
    name: "Presentation Clean",
    description: "Clean layout optimized for presentations and screenshots",
    style: LayoutStyle.HORIZONTAL,
    options: {
      horizontalSpacing: 250,
      verticalSpacing: 150,
      branchOffset: 200,
      minNodeSpacing: 25,
    },
    icon: "presentation",
    category: "presentation",
    builtIn: true,
    tags: ["presentation", "clean", "screenshot"],
  },
  {
    id: "presentation-symmetric",
    name: "Presentation Symmetric",
    description:
      "Symmetrical hierarchical layout for professional presentations",
    style: LayoutStyle.HIERARCHICAL,
    options: {
      horizontalSpacing: 280,
      verticalSpacing: 160,
      branchOffset: 200,
      minNodeSpacing: 30,
    },
    icon: "layout",
    category: "presentation",
    builtIn: true,
    tags: ["presentation", "symmetric", "professional"],
  },
  {
    id: "presentation-circular",
    name: "Presentation Circular",
    description:
      "Artistic circular layout - best for small workflows in presentations",
    style: LayoutStyle.CIRCULAR,
    options: {
      horizontalSpacing: 200,
      verticalSpacing: 200,
      minNodeSpacing: 20,
    },
    icon: "circle",
    category: "presentation",
    builtIn: true,
    tags: ["presentation", "circular", "artistic"],
  },

  // Debug category
  {
    id: "debug-spread",
    name: "Debug Spread Out",
    description: "Very spacious layout for debugging and detailed inspection",
    style: LayoutStyle.HIERARCHICAL,
    options: {
      horizontalSpacing: 350,
      verticalSpacing: 200,
      branchOffset: 250,
      minNodeSpacing: 40,
    },
    icon: "bug",
    category: "debug",
    builtIn: true,
    tags: ["debug", "spacious", "inspection"],
  },
  {
    id: "debug-force",
    name: "Debug Force-Directed",
    description: "Physics-based layout to reveal complex connections",
    style: LayoutStyle.FORCE_DIRECTED,
    options: {
      horizontalSpacing: 200,
      verticalSpacing: 120,
      minNodeSpacing: 20,
    },
    icon: "git-network",
    category: "debug",
    builtIn: true,
    tags: ["debug", "force", "connections"],
  },
];

// ============================================================================
// Preset Categories
// ============================================================================

export const PRESET_CATEGORIES: PresetCategory[] = [
  {
    id: "compact",
    name: "Compact",
    description: "Minimize space usage",
    icon: "compress",
  },
  {
    id: "readable",
    name: "Readable",
    description: "Optimized for clarity",
    icon: "eye",
  },
  {
    id: "presentation",
    name: "Presentation",
    description: "Professional layouts",
    icon: "presentation",
  },
  {
    id: "custom",
    name: "Custom",
    description: "User-created presets",
    icon: "star",
  },
  {
    id: "debug",
    name: "Debug",
    description: "Development and debugging",
    icon: "bug",
  },
];

// ============================================================================
// Preset Storage Key
// ============================================================================

const STORAGE_KEY = "qontinui-layout-presets";
const RECENT_PRESETS_KEY = "qontinui-layout-presets-recent";
const MAX_RECENT = 10;

// ============================================================================
// Preset Management
// ============================================================================

/**
 * Get all available presets (built-in + custom)
 */
export function getAllPresets(): LayoutPreset[] {
  const customPresets = loadCustomPresets();
  return [...BUILTIN_PRESETS, ...customPresets];
}

/**
 * Get presets by category
 */
export function getPresetsByCategory(
  category: PresetCategory["id"]
): LayoutPreset[] {
  return getAllPresets().filter((p) => p.category === category);
}

/**
 * Get a preset by ID
 */
export function getPresetById(id: string): LayoutPreset | undefined {
  return getAllPresets().find((p) => p.id === id);
}

/**
 * Search presets by name or tags
 */
export function searchPresets(query: string): LayoutPreset[] {
  const lowerQuery = query.toLowerCase();
  return getAllPresets().filter(
    (preset) =>
      preset.name.toLowerCase().includes(lowerQuery) ||
      preset.description.toLowerCase().includes(lowerQuery) ||
      preset.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Save a custom preset
 */
export function saveCustomPreset(
  preset: Omit<LayoutPreset, "id" | "builtIn" | "createdAt">
): LayoutPreset {
  const customPresets = loadCustomPresets();

  const newPreset: LayoutPreset = {
    ...preset,
    id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    builtIn: false,
    createdAt: new Date().toISOString(),
    category: "custom",
  };

  customPresets.push(newPreset);
  saveCustomPresetsToStorage(customPresets);

  return newPreset;
}

/**
 * Update an existing custom preset
 */
export function updateCustomPreset(
  id: string,
  updates: Partial<LayoutPreset>
): boolean {
  const customPresets = loadCustomPresets();
  const index = customPresets.findIndex((p) => p.id === id);

  if (index === -1) return false;

  const current = customPresets[index];
  if (!current) return false;

  customPresets[index] = {
    ...current,
    ...updates,
    id, // Preserve ID
    builtIn: false, // Cannot change built-in status
    category: updates.category ?? current.category,
    style: updates.style ?? current.style,
    options: updates.options ?? current.options,
    name: updates.name ?? current.name,
    description: updates.description ?? current.description,
  } as LayoutPreset;

  saveCustomPresetsToStorage(customPresets);
  return true;
}

/**
 * Delete a custom preset
 */
export function deleteCustomPreset(id: string): boolean {
  const customPresets = loadCustomPresets();
  const filtered = customPresets.filter((p) => p.id !== id);

  if (filtered.length === customPresets.length) {
    return false; // Preset not found
  }

  saveCustomPresetsToStorage(filtered);
  return true;
}

/**
 * Get default preset (readable-standard)
 */
export function getDefaultPreset(): LayoutPreset {
  return BUILTIN_PRESETS.find((p) => p.id === "readable-standard")!;
}

/**
 * Create preset from current layout settings
 */
export function createPresetFromSettings(
  name: string,
  description: string,
  style: LayoutStyle,
  options: LayoutOptions,
  tags?: string[]
): LayoutPreset {
  return saveCustomPreset({
    name,
    description,
    style,
    options,
    tags: tags ?? [],
    icon: "star",
    category: "custom",
  });
}

/**
 * Duplicate a preset
 */
export function duplicatePreset(
  id: string,
  newName?: string
): LayoutPreset | null {
  const preset = getPresetById(id);
  if (!preset) return null;

  return saveCustomPreset({
    name: newName || `${preset.name} (Copy)`,
    description: preset.description,
    style: preset.style,
    options: { ...preset.options },
    icon: preset.icon ?? "star",
    tags: preset.tags ? [...preset.tags] : [],
    category: "custom",
  });
}

// ============================================================================
// Recent Presets
// ============================================================================

/**
 * Get recently used presets
 */
export function getRecentPresets(): LayoutPreset[] {
  try {
    const recent = localStorage.getItem(RECENT_PRESETS_KEY);
    if (!recent) return [];

    const presetIds: string[] = JSON.parse(recent);
    return presetIds
      .map((id) => getPresetById(id))
      .filter((p): p is LayoutPreset => p !== undefined);
  } catch (error) {
    console.error("Failed to load recent presets:", error);
    return [];
  }
}

/**
 * Add preset to recent list
 */
export function addToRecentPresets(presetId: string): void {
  try {
    let recent = getRecentPresetIds();

    // Remove if already in list
    recent = recent.filter((id) => id !== presetId);

    // Add to front
    recent.unshift(presetId);

    // Limit size
    recent = recent.slice(0, MAX_RECENT);

    localStorage.setItem(RECENT_PRESETS_KEY, JSON.stringify(recent));
  } catch (error) {
    console.error("Failed to save recent preset:", error);
  }
}

/**
 * Clear recent presets
 */
export function clearRecentPresets(): void {
  try {
    localStorage.removeItem(RECENT_PRESETS_KEY);
  } catch (error) {
    console.error("Failed to clear recent presets:", error);
  }
}

// ============================================================================
// Import/Export
// ============================================================================

/**
 * Export all custom presets as JSON
 */
export function exportCustomPresets(): string {
  const customPresets = loadCustomPresets();
  return JSON.stringify(customPresets, null, 2);
}

/**
 * Import custom presets from JSON
 */
export function importCustomPresets(json: string): {
  success: number;
  failed: number;
} {
  try {
    const imported = JSON.parse(json) as LayoutPreset[];

    if (!Array.isArray(imported)) {
      throw new Error("Invalid format: expected array");
    }

    let success = 0;
    let failed = 0;

    for (const preset of imported) {
      try {
        // Validate preset structure
        if (!preset.name || !preset.style || !preset.options) {
          failed++;
          continue;
        }

        saveCustomPreset({
          name: preset.name,
          description: preset.description || "",
          style: preset.style,
          options: preset.options,
          icon: preset.icon ?? "star",
          tags: preset.tags ?? [],
          category: preset.category ?? "custom",
        });

        success++;
      } catch (_error) {
        failed++;
      }
    }

    return { success, failed };
  } catch (error) {
    console.error("Failed to import presets:", error);
    return { success: 0, failed: 0 };
  }
}

// ============================================================================
// Private Helper Functions
// ============================================================================

function loadCustomPresets(): LayoutPreset[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    return JSON.parse(stored) as LayoutPreset[];
  } catch (error) {
    console.error("Failed to load custom presets:", error);
    return [];
  }
}

function saveCustomPresetsToStorage(presets: LayoutPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch (error) {
    console.error("Failed to save custom presets:", error);
  }
}

function getRecentPresetIds(): string[] {
  try {
    const recent = localStorage.getItem(RECENT_PRESETS_KEY);
    return recent ? JSON.parse(recent) : [];
  } catch (error) {
    return [];
  }
}

/**
 * Get preset display information
 */
export function getPresetDisplayInfo(preset: LayoutPreset): {
  badge?: string;
  tooltip: string;
} {
  const info: { badge?: string; tooltip: string } = {
    tooltip: preset.description,
  };

  if (preset.builtIn) {
    info.badge = "Built-in";
  }

  return info;
}

/**
 * Validate preset options
 */
export function validatePresetOptions(options: LayoutOptions): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (
    options.horizontalSpacing !== undefined &&
    options.horizontalSpacing < 50
  ) {
    errors.push("Horizontal spacing must be at least 50px");
  }

  if (options.verticalSpacing !== undefined && options.verticalSpacing < 50) {
    errors.push("Vertical spacing must be at least 50px");
  }

  if (options.nodeWidth !== undefined && options.nodeWidth < 100) {
    errors.push("Node width must be at least 100px");
  }

  if (options.nodeHeight !== undefined && options.nodeHeight < 60) {
    errors.push("Node height must be at least 60px");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
