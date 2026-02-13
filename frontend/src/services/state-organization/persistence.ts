/**
 * Persistence
 *
 * Storage persistence and auto-save for the state organization service.
 * Handles saving to and loading from localStorage.
 */

import type { StateOrganizationStorage } from "@/types/state-organization/types";
import { STORAGE_VERSION, STORAGE_KEY } from "@/types/state-organization/types";
import type { ServiceState } from "./types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("StateOrganization:Persistence");

export class Persistence {
  private readonly state: ServiceState;

  constructor(state: ServiceState) {
    this.state = state;
  }

  /**
   * Save to localStorage
   */
  save(): void {
    if (!this.state.autoSaveEnabled) return;

    try {
      const data: StateOrganizationStorage = {
        groups: Object.fromEntries(this.state.groups),
        associations: this.state.associations,
        metadata: Object.fromEntries(this.state.metadata),
        templates: Object.fromEntries(
          Array.from(this.state.templates.entries()).filter(
            ([_, t]) => t.category === "custom"
          )
        ),
        version: STORAGE_VERSION,
        lastModified: new Date().toISOString(),
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      logger.error("Failed to save state organization to storage:", error);
    }
  }

  /**
   * Load from localStorage
   */
  loadFromStorage(): void {
    try {
      const json = localStorage.getItem(STORAGE_KEY);
      if (!json) return;

      const data: StateOrganizationStorage = JSON.parse(json);

      // Validate version
      if (data.version !== STORAGE_VERSION) {
        logger.warn(
          `Storage version mismatch. Expected ${STORAGE_VERSION}, got ${data.version}`
        );
      }

      // Load data
      this.state.groups = new Map(Object.entries(data.groups || {}));
      this.state.associations = data.associations || [];
      this.state.metadata = new Map(Object.entries(data.metadata || {}));

      // Load custom templates (built-in templates are initialized separately)
      const customTemplates = new Map(Object.entries(data.templates || {}));
      for (const [id, template] of customTemplates) {
        if (template.category === "custom") {
          this.state.templates.set(id, template);
        }
      }
    } catch (error) {
      logger.error(
        "Failed to load state organization from storage:",
        error
      );
    }
  }

  /**
   * Clear all data
   */
  clearAll(): void {
    this.state.groups.clear();
    this.state.associations = [];
    this.state.metadata.clear();
    // Keep built-in templates, only clear custom ones
    for (const [id, template] of this.state.templates) {
      if (template.category === "custom") {
        this.state.templates.delete(id);
      }
    }
    this.save();
  }

  /**
   * Enable/disable auto-save
   */
  setAutoSave(enabled: boolean): void {
    this.state.autoSaveEnabled = enabled;
  }
}
