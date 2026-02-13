/**
 * Import/Export
 *
 * Handles import and export operations for states,
 * including metadata, groups, and associations.
 */

import type {
  BulkOperationResult,
  ImportOptions,
  ExportData,
} from "@/types/state-organization/types";

import type { ServiceState, PersistenceCallbacks } from "./types";
import type { GroupManager } from "./group-manager";

export class ImportExport {
  constructor(
    private state: ServiceState,
    private persistence: PersistenceCallbacks,
    private groupManager: GroupManager
  ) {}

  /**
   * Export states with options
   */
  exportStates(
    stateIds: string[],
    includeGroups = false,
    includeImages = false
  ): ExportData {
    return this.groupManager.bulkExport(stateIds, {
      includeGroups,
      includeImages,
      includeTags: true,
      includeMetadata: true,
    });
  }

  /**
   * Import states
   */
  importStates(data: ExportData, options?: ImportOptions): BulkOperationResult {
    const result: BulkOperationResult = {
      success: true,
      processedCount: 0,
      failedCount: 0,
      errors: [],
      warnings: [],
    };

    try {
      // Import groups first if included
      if (data.groups && options?.merge !== false) {
        for (const group of data.groups) {
          if (!this.state.groups.has(group.id) || options?.overwriteExisting) {
            this.state.groups.set(group.id, group);
          }
        }
      }

      // Import metadata
      for (const [stateId, metadata] of Object.entries(data.metadata)) {
        if (
          !this.state.metadata.has(stateId) ||
          options?.overwriteExisting
        ) {
          this.state.metadata.set(stateId, metadata);
        }
      }

      // Import associations
      if (data.associations) {
        for (const association of data.associations) {
          const exists = this.state.associations.some(
            (a) =>
              a.stateId === association.stateId &&
              a.groupId === association.groupId
          );

          if (!exists || options?.overwriteExisting) {
            if (!exists) {
              this.state.associations.push(association);
            }
          }
        }
      }

      result.processedCount = data.states.length;
      this.persistence.save();
    } catch (error) {
      result.success = false;
      result.failedCount = data.states.length;
      result.errors.push({
        stateId: "import",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    return result;
  }
}
