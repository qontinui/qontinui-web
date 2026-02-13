/**
 * Group Manager
 *
 * Handles state group CRUD, group hierarchy, state-group associations,
 * tags, metadata management, and bulk operations.
 */

import type { State } from "@/contexts/automation-context/types";

import type {
  StateGroup,
  GroupTreeNode,
  StateMetadata,
  GroupOperationResult,
  MetadataOperationResult,
  GroupListResult,
  GroupTreeResult,
  StateListResult,
  BulkOperationResult,
  ExportData,
  ExportOptions,
} from "@/types/state-organization/types";

import type { ServiceState, PersistenceCallbacks } from "./types";

export class GroupManager {
  constructor(
    private state: ServiceState,
    private persistence: PersistenceCallbacks
  ) {}

  // ==========================================================================
  // State Groups/Folders
  // ==========================================================================

  /**
   * Create a new state group
   */
  createStateGroup(
    name: string,
    description?: string,
    color?: string,
    icon?: string
  ): GroupOperationResult {
    try {
      if (!name || !name.trim()) {
        return { success: false, error: "Group name cannot be empty" };
      }

      const group: StateGroup = {
        id: this.generateId("group"),
        name: name.trim(),
        parentId: null,
        color,
        icon,
        description: description?.trim(),
        metadata: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          stateCount: 0,
          descendantCount: 0,
        },
        order: this.getNextOrder(null),
      };

      this.state.groups.set(group.id, group);
      this.persistence.save();

      return { success: true, group };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create group: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Add state to group
   */
  addStateToGroup(stateId: string, groupId: string): GroupOperationResult {
    try {
      if (!this.state.groups.has(groupId)) {
        return { success: false, error: `Group not found: ${groupId}` };
      }

      // Check if state exists
      const stateExists = this.state.states.some((s) => s.id === stateId);
      if (!stateExists) {
        return { success: false, error: `State not found: ${stateId}` };
      }

      // Check if already in a group
      const existing = this.state.associations.find(
        (a) => a.stateId === stateId
      );
      if (existing) {
        if (existing.groupId === groupId) {
          return {
            success: true,
            warnings: ["State already in this group"],
          };
        }
        // Remove from old group
        this.removeStateFromGroup(stateId, existing.groupId);
      }

      // Add association
      this.state.associations.push({
        stateId,
        groupId,
        addedAt: new Date().toISOString(),
      });

      this.updateStateCounts(groupId);
      this.persistence.save();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add state to group: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Remove state from group
   */
  removeStateFromGroup(stateId: string, groupId: string): GroupOperationResult {
    try {
      const index = this.state.associations.findIndex(
        (a) => a.stateId === stateId && a.groupId === groupId
      );

      if (index === -1) {
        return {
          success: true,
          warnings: ["State not in this group"],
        };
      }

      this.state.associations.splice(index, 1);
      this.updateStateCounts(groupId);
      this.persistence.save();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to remove state from group: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get all states in a group
   */
  getStatesInGroup(groupId: string, recursive = false): StateListResult {
    try {
      if (!this.state.groups.has(groupId)) {
        return {
          success: false,
          stateIds: [],
          error: `Group not found: ${groupId}`,
        };
      }

      const stateIds = new Set<string>();

      // Add states from this group
      this.state.associations
        .filter((a) => a.groupId === groupId)
        .forEach((a) => stateIds.add(a.stateId));

      // Add states from subgroups if recursive
      if (recursive) {
        const descendants = this.getGroupDescendants(groupId);
        for (const descendant of descendants) {
          this.state.associations
            .filter((a) => a.groupId === descendant.id)
            .forEach((a) => stateIds.add(a.stateId));
        }
      }

      return {
        success: true,
        stateIds: Array.from(stateIds),
      };
    } catch (error) {
      return {
        success: false,
        stateIds: [],
        error: `Failed to get states in group: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get all state groups
   */
  getAllStateGroups(): GroupListResult {
    try {
      const groups = Array.from(this.state.groups.values());
      return {
        success: true,
        groups: groups.map((g) => ({ ...g })),
      };
    } catch (error) {
      return {
        success: false,
        groups: [],
        error: `Failed to get groups: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Move state group to new parent (hierarchical)
   */
  moveStateGroup(
    groupId: string,
    newParentId: string | null
  ): GroupOperationResult {
    try {
      const group = this.state.groups.get(groupId);
      if (!group) {
        return { success: false, error: `Group not found: ${groupId}` };
      }

      // Validate move
      if (groupId === newParentId) {
        return { success: false, error: "Cannot move group to itself" };
      }

      if (newParentId && !this.state.groups.has(newParentId)) {
        return {
          success: false,
          error: `Parent group not found: ${newParentId}`,
        };
      }

      // Check for circular dependency
      if (newParentId) {
        const descendants = this.getGroupDescendants(groupId);
        if (descendants.some((d) => d.id === newParentId)) {
          return {
            success: false,
            error: "Cannot move group to one of its descendants",
          };
        }
      }

      const oldParentId = group.parentId;
      group.parentId = newParentId;
      group.metadata.updated = new Date().toISOString();

      this.updateDescendantCounts(oldParentId);
      this.updateDescendantCounts(newParentId);
      this.persistence.save();

      return { success: true, group };
    } catch (error) {
      return {
        success: false,
        error: `Failed to move group: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get group tree (hierarchical structure)
   */
  getGroupTree(rootId: string | null = null): GroupTreeResult {
    try {
      const tree = this.buildGroupTree(rootId);
      return { success: true, tree };
    } catch (error) {
      return {
        success: false,
        tree: [],
        error: `Failed to build group tree: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ==========================================================================
  // Tags and Metadata
  // ==========================================================================

  /**
   * Add tag to state
   */
  addStateTag(stateId: string, tag: string): MetadataOperationResult {
    try {
      let metadata = this.state.metadata.get(stateId);
      if (!metadata) {
        metadata = { tags: [] };
        this.state.metadata.set(stateId, metadata);
      }

      if (!metadata.tags.includes(tag)) {
        metadata.tags.push(tag);
        this.persistence.save();
      }

      return { success: true, metadata };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add tag: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Remove tag from state
   */
  removeStateTag(stateId: string, tag: string): MetadataOperationResult {
    try {
      const metadata = this.state.metadata.get(stateId);
      if (!metadata) {
        return { success: true, warnings: ["State has no metadata"] };
      }

      const index = metadata.tags.indexOf(tag);
      if (index > -1) {
        metadata.tags.splice(index, 1);
        this.persistence.save();
      }

      return { success: true, metadata };
    } catch (error) {
      return {
        success: false,
        error: `Failed to remove tag: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get states by tag
   */
  getStatesByTag(tag: string): State[] {
    const stateIds: string[] = [];

    for (const [stateId, metadata] of this.state.metadata.entries()) {
      if (metadata.tags.includes(tag)) {
        stateIds.push(stateId);
      }
    }

    return this.state.states.filter((s) => stateIds.includes(s.id));
  }

  /**
   * Update state metadata
   */
  updateStateMetadata(
    stateId: string,
    updates: Partial<StateMetadata>
  ): MetadataOperationResult {
    try {
      let metadata = this.state.metadata.get(stateId);
      if (!metadata) {
        metadata = { tags: [] };
        this.state.metadata.set(stateId, metadata);
      }

      // Merge updates
      Object.assign(metadata, updates);
      metadata.lastModifiedAt = new Date().toISOString();
      this.persistence.save();

      return { success: true, metadata };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update metadata: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get state metadata
   */
  getStateMetadata(stateId: string): StateMetadata | null {
    return this.state.metadata.get(stateId) || null;
  }

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  /**
   * Bulk tag states
   */
  bulkTag(stateIds: string[], tags: string[]): BulkOperationResult {
    const result: BulkOperationResult = {
      success: true,
      processedCount: 0,
      failedCount: 0,
      errors: [],
    };

    for (const stateId of stateIds) {
      try {
        for (const tag of tags) {
          this.addStateTag(stateId, tag);
        }
        result.processedCount++;
      } catch (error) {
        result.failedCount++;
        result.errors.push({
          stateId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    result.success = result.failedCount === 0;
    return result;
  }

  /**
   * Bulk move states to group
   */
  bulkMove(stateIds: string[], groupId: string): BulkOperationResult {
    const result: BulkOperationResult = {
      success: true,
      processedCount: 0,
      failedCount: 0,
      errors: [],
    };

    for (const stateId of stateIds) {
      const moveResult = this.addStateToGroup(stateId, groupId);
      if (moveResult.success) {
        result.processedCount++;
      } else {
        result.failedCount++;
        result.errors.push({
          stateId,
          error: moveResult.error || "Unknown error",
        });
      }
    }

    result.success = result.failedCount === 0;
    return result;
  }

  /**
   * Bulk delete states (returns state IDs to be deleted by AutomationContext)
   */
  bulkDelete(stateIds: string[]): BulkOperationResult {
    const result: BulkOperationResult = {
      success: true,
      processedCount: 0,
      failedCount: 0,
      errors: [],
    };

    for (const stateId of stateIds) {
      try {
        // Remove from groups
        const association = this.state.associations.find(
          (a) => a.stateId === stateId
        );
        if (association) {
          this.removeStateFromGroup(stateId, association.groupId);
        }

        // Remove metadata
        this.state.metadata.delete(stateId);
        result.processedCount++;
      } catch (error) {
        result.failedCount++;
        result.errors.push({
          stateId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    this.persistence.save();
    result.success = result.failedCount === 0;
    return result;
  }

  /**
   * Bulk duplicate states (returns new state configurations)
   */
  bulkDuplicate(stateIds: string[]): {
    success: boolean;
    states: State[];
    errors: Array<{ stateId: string; error: string }>;
  } {
    const result: {
      success: boolean;
      states: State[];
      errors: Array<{ stateId: string; error: string }>;
    } = {
      success: true,
      states: [],
      errors: [],
    };

    for (const stateId of stateIds) {
      try {
        const state = this.state.states.find((s) => s.id === stateId);
        if (!state) {
          result.errors.push({ stateId, error: "State not found" });
          continue;
        }

        const duplicated: State = {
          ...state,
          id: this.generateId("state"),
          name: `${state.name} (Copy)`,
          position: {
            x: Math.round(state.position.x + 50),
            y: Math.round(state.position.y + 50),
          },
        };

        result.states.push(duplicated);

        // Copy metadata
        const metadata = this.state.metadata.get(stateId);
        if (metadata) {
          this.state.metadata.set(duplicated.id, {
            ...metadata,
            createdAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        result.errors.push({
          stateId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    this.persistence.save();
    result.success = result.errors.length === 0;
    return result;
  }

  /**
   * Bulk export states
   */
  bulkExport(stateIds: string[], options?: ExportOptions): ExportData {
    const statesToExport = this.state.states.filter((s) =>
      stateIds.includes(s.id)
    );
    const metadataToExport: Record<string, StateMetadata> = {};

    for (const stateId of stateIds) {
      const metadata = this.state.metadata.get(stateId);
      if (metadata) {
        metadataToExport[stateId] = metadata;
      }
    }

    const exportData: ExportData = {
      states: statesToExport,
      metadata: metadataToExport,
      exportedAt: new Date().toISOString(),
      exportedBy: "Qontinui",
      version: "1.0.0",
    };

    if (options?.includeGroups) {
      const relevantGroups = new Set<string>();
      for (const association of this.state.associations) {
        if (stateIds.includes(association.stateId)) {
          relevantGroups.add(association.groupId);
        }
      }

      exportData.groups = Array.from(relevantGroups)
        .map((id) => this.state.groups.get(id))
        .filter((g): g is StateGroup => g !== undefined);

      exportData.associations = this.state.associations.filter((a) =>
        stateIds.includes(a.stateId)
      );
    }

    if (options?.includeTags) {
      // Tags are already in metadata
    }

    return exportData;
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  /**
   * Get children of a group
   */
  getChildren(parentId: string | null): StateGroup[] {
    return Array.from(this.state.groups.values())
      .filter((g) => g.parentId === parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /**
   * Get next order number for a parent
   */
  private getNextOrder(parentId: string | null): number {
    const children = this.getChildren(parentId);
    if (children.length === 0) return 0;

    const maxOrder = Math.max(...children.map((c) => c.order ?? 0));
    return maxOrder + 1;
  }

  /**
   * Get all descendants of a group
   */
  getGroupDescendants(groupId: string): StateGroup[] {
    const descendants: StateGroup[] = [];
    const children = this.getChildren(groupId);

    for (const child of children) {
      descendants.push(child);
      descendants.push(...this.getGroupDescendants(child.id));
    }

    return descendants;
  }

  /**
   * Build group tree
   */
  private buildGroupTree(
    rootId: string | null,
    depth = 0
  ): GroupTreeNode[] {
    const children = this.getChildren(rootId);

    return children.map((group) => {
      const path: string[] = [];
      let currentId: string | null = group.id;

      while (currentId) {
        const g = this.state.groups.get(currentId);
        if (!g) break;
        path.unshift(g.name);
        currentId = g.parentId;
      }

      const node: GroupTreeNode = {
        ...group,
        children: this.buildGroupTree(group.id, depth + 1),
        depth,
        path,
        hasChildren: this.getChildren(group.id).length > 0,
        description: group.description || undefined,
      };

      return node;
    });
  }

  /**
   * Update state counts for a group and its ancestors
   */
  private updateStateCounts(groupId: string | null): void {
    if (!groupId) return;

    const group = this.state.groups.get(groupId);
    if (!group) return;

    // Count states in this group
    const count = this.state.associations.filter(
      (a) => a.groupId === groupId
    ).length;

    group.metadata.stateCount = count;
    group.metadata.updated = new Date().toISOString();

    // Update parent
    if (group.parentId) {
      this.updateStateCounts(group.parentId);
    }
  }

  /**
   * Update descendant counts for a group and its ancestors
   */
  private updateDescendantCounts(groupId: string | null): void {
    if (!groupId) return;

    const group = this.state.groups.get(groupId);
    if (!group) return;

    // Count descendants
    const descendants = this.getGroupDescendants(groupId);
    group.metadata.descendantCount = descendants.length;
    group.metadata.updated = new Date().toISOString();

    // Update parent
    if (group.parentId) {
      this.updateDescendantCounts(group.parentId);
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
