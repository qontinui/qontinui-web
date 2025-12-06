/**
 * Workflow Folder Manager Service
 *
 * Comprehensive service for organizing workflows into folders with:
 * - CRUD operations for folders
 * - Hierarchical folder tree management
 * - Workflow-to-folder associations
 * - Search and filtering
 * - Validation and error handling
 * - localStorage persistence with auto-save
 * - Import/export functionality
 * - Migration support
 */

import {
  WorkflowFolder,
  FolderTreeNode,
  FolderPath,
  WorkflowFolderAssociation,
  FolderOperationResult,
  FolderListResult,
  FolderTreeResult,
  WorkflowListResult,
  ValidationResult,
  MoveResult,
  CreateFolderOptions,
  UpdateFolderOptions,
  DeleteFolderOptions,
  FolderSearchOptions,
  FolderSearchResult,
  FolderStorageData,
  ImportExportData,
  MigrationResult,
  DEFAULT_VALIDATION_RULES,
  STORAGE_VERSION,
  STORAGE_KEY,
} from "../types/workflow-organization/types";

// ============================================================================
// WorkflowFolderManager Class
// ============================================================================

export class WorkflowFolderManager {
  private static instance: WorkflowFolderManager;
  private folders: Map<string, WorkflowFolder> = new Map();
  private associations: WorkflowFolderAssociation[] = [];
  private autoSaveEnabled = true;

  private constructor() {
    this.loadFromStorage();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): WorkflowFolderManager {
    if (!WorkflowFolderManager.instance) {
      WorkflowFolderManager.instance = new WorkflowFolderManager();
    }
    return WorkflowFolderManager.instance;
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Create a new folder
   */
  createFolder(options: CreateFolderOptions): FolderOperationResult {
    try {
      // Validate folder name
      const validation = this.validateFolderName(
        options.name,
        options.parentId
      );
      if (!validation.valid) {
        return {
          success: false,
          error: validation.errors[0],
          warnings: validation.warnings,
        };
      }

      // Validate parent exists
      if (options.parentId && !this.folders.has(options.parentId)) {
        return {
          success: false,
          error: `Parent folder not found: ${options.parentId}`,
        };
      }

      // Validate depth
      const depth = this.calculateDepth(options.parentId);
      if (depth >= DEFAULT_VALIDATION_RULES.maxDepth) {
        return {
          success: false,
          error: `Maximum folder depth (${DEFAULT_VALIDATION_RULES.maxDepth}) exceeded`,
        };
      }

      // Create folder
      const folder: WorkflowFolder = {
        id: this.generateId(),
        name: options.name.trim(),
        parentId: options.parentId || null,
        color: options.color,
        icon: options.icon,
        description: options.description?.trim(),
        order: options.order ?? this.getNextOrder(options.parentId),
        metadata: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          workflowCount: 0,
          descendantCount: 0,
        },
      };

      // Validate color and icon if provided
      if (folder.color && !this.isValidColor(folder.color)) {
        return {
          success: false,
          error: `Invalid color: ${folder.color}`,
        };
      }

      if (folder.icon && !this.isValidIcon(folder.icon)) {
        return {
          success: false,
          error: `Invalid icon: ${folder.icon}`,
        };
      }

      // Save folder
      this.folders.set(folder.id, folder);
      this.updateDescendantCounts(folder.parentId);
      this.save();

      return {
        success: true,
        folder,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create folder: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Update an existing folder
   */
  updateFolder(
    id: string,
    updates: UpdateFolderOptions
  ): FolderOperationResult {
    try {
      const folder = this.folders.get(id);
      if (!folder) {
        return {
          success: false,
          error: `Folder not found: ${id}`,
        };
      }

      // Validate name if provided
      if (updates.name !== undefined) {
        const validation = this.validateFolderName(
          updates.name,
          folder.parentId,
          id
        );
        if (!validation.valid) {
          return {
            success: false,
            error: validation.errors[0],
            warnings: validation.warnings,
          };
        }
      }

      // Validate parent change
      if (
        updates.parentId !== undefined &&
        updates.parentId !== folder.parentId
      ) {
        const canMove = this.canMoveFolder(id, updates.parentId);
        if (!canMove.valid) {
          return {
            success: false,
            error: canMove.errors[0],
          };
        }
      }

      // Validate color and icon
      if (updates.color && !this.isValidColor(updates.color)) {
        return {
          success: false,
          error: `Invalid color: ${updates.color}`,
        };
      }

      if (updates.icon && !this.isValidIcon(updates.icon)) {
        return {
          success: false,
          error: `Invalid icon: ${updates.icon}`,
        };
      }

      // Update folder
      const oldParentId = folder.parentId;
      const updatedFolder: WorkflowFolder = {
        ...folder,
        name: updates.name !== undefined ? updates.name.trim() : folder.name,
        parentId:
          updates.parentId !== undefined ? updates.parentId : folder.parentId,
        color: updates.color !== undefined ? updates.color : folder.color,
        icon: updates.icon !== undefined ? updates.icon : folder.icon,
        description:
          updates.description !== undefined
            ? updates.description?.trim()
            : folder.description,
        order: updates.order !== undefined ? updates.order : folder.order,
        metadata: {
          ...folder.metadata,
          updated: new Date().toISOString(),
        },
      };

      this.folders.set(id, updatedFolder);

      // Update descendant counts if parent changed
      if (oldParentId !== updatedFolder.parentId) {
        this.updateDescendantCounts(oldParentId);
        this.updateDescendantCounts(updatedFolder.parentId);
      }

      this.save();

      return {
        success: true,
        folder: updatedFolder,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to update folder: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Delete a folder
   */
  deleteFolder(
    id: string,
    options: DeleteFolderOptions = {}
  ): FolderOperationResult {
    try {
      const folder = this.folders.get(id);
      if (!folder) {
        return {
          success: false,
          error: `Folder not found: ${id}`,
        };
      }

      const { recursive = false, moveWorkflowsTo = null } = options;

      // Get children
      const children = this.getChildren(id);

      // Handle non-recursive deletion with children
      if (children.length > 0 && !recursive) {
        return {
          success: false,
          error: `Folder has ${children.length} subfolder(s). Use recursive option to delete.`,
        };
      }

      // Get workflows in this folder
      const workflowIds = this.getWorkflowsInFolder(id, false).workflowIds;

      // Handle workflows
      if (workflowIds.length > 0) {
        if (moveWorkflowsTo !== undefined) {
          // Move workflows to specified folder
          for (const workflowId of workflowIds) {
            if (moveWorkflowsTo === null) {
              // Remove from folder (make orphaned)
              this.removeWorkflowFromFolder(workflowId);
            } else {
              // Move to another folder
              this.moveWorkflow(workflowId, moveWorkflowsTo);
            }
          }
        } else {
          // Remove all workflows from folder
          for (const workflowId of workflowIds) {
            this.removeWorkflowFromFolder(workflowId);
          }
        }
      }

      // Delete children recursively
      if (recursive) {
        for (const child of children) {
          this.deleteFolder(child.id, { recursive: true, moveWorkflowsTo });
        }
      }

      // Delete folder
      this.folders.delete(id);
      this.updateDescendantCounts(folder.parentId);
      this.save();

      return {
        success: true,
        folder,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete folder: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get a single folder by ID
   */
  getFolder(id: string): FolderOperationResult {
    const folder = this.folders.get(id);
    if (!folder) {
      return {
        success: false,
        error: `Folder not found: ${id}`,
      };
    }

    return {
      success: true,
      folder: { ...folder },
    };
  }

  /**
   * Get folder path (breadcrumb trail)
   */
  getFolderPath(id: string): FolderPath[] {
    const path: FolderPath[] = [];
    let currentId: string | null = id;

    while (currentId) {
      const folder = this.folders.get(currentId);
      if (!folder) break;

      path.unshift({
        id: folder.id,
        name: folder.name,
      });

      currentId = folder.parentId;
    }

    return path;
  }

  /**
   * Get all folders (flat list)
   */
  getAllFolders(): FolderListResult {
    try {
      const folders = Array.from(this.folders.values());
      return {
        success: true,
        folders: folders.map((f) => ({ ...f })),
      };
    } catch (error) {
      return {
        success: false,
        folders: [],
        error: `Failed to get folders: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get folder tree (hierarchical structure)
   */
  getFolderTree(rootId: string | null = null): FolderTreeResult {
    try {
      const tree = this.buildTree(rootId);
      return {
        success: true,
        tree,
      };
    } catch (error) {
      return {
        success: false,
        tree: [],
        error: `Failed to build folder tree: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ==========================================================================
  // Workflow Management
  // ==========================================================================

  /**
   * Add workflow to folder
   */
  addWorkflowToFolder(workflowId: string, folderId: string): MoveResult {
    try {
      // Validate folder exists
      if (!this.folders.has(folderId)) {
        return {
          success: false,
          error: `Folder not found: ${folderId}`,
        };
      }

      // Check if already in a folder
      const existing = this.associations.find(
        (a) => a.workflowId === workflowId
      );
      if (existing) {
        if (existing.folderId === folderId) {
          return {
            success: true,
            warnings: ["Workflow already in this folder"],
          };
        }

        // Remove from old folder
        this.removeWorkflowFromFolder(workflowId);
      }

      // Add association
      this.associations.push({
        workflowId,
        folderId,
        addedAt: new Date().toISOString(),
      });

      // Update workflow count
      this.updateWorkflowCounts(folderId);
      this.save();

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add workflow to folder: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Remove workflow from its folder
   */
  removeWorkflowFromFolder(workflowId: string): MoveResult {
    try {
      const index = this.associations.findIndex(
        (a) => a.workflowId === workflowId
      );
      if (index === -1) {
        return {
          success: true,
          warnings: ["Workflow not in any folder"],
        };
      }

      const association = this.associations[index];
      this.associations.splice(index, 1);

      // Update workflow count
      this.updateWorkflowCounts(association?.folderId);
      this.save();

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to remove workflow from folder: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Move workflow to different folder
   */
  moveWorkflow(workflowId: string, newFolderId: string): MoveResult {
    return this.addWorkflowToFolder(workflowId, newFolderId);
  }

  /**
   * Get folder containing a workflow
   */
  getWorkflowFolder(workflowId: string): FolderOperationResult {
    const association = this.associations.find(
      (a) => a.workflowId === workflowId
    );
    if (!association) {
      return {
        success: false,
        error: `Workflow not in any folder: ${workflowId}`,
      };
    }

    return this.getFolder(association.folderId);
  }

  /**
   * Get all workflows in a folder
   */
  getWorkflowsInFolder(
    folderId: string,
    recursive = false
  ): WorkflowListResult {
    try {
      if (!this.folders.has(folderId)) {
        return {
          success: false,
          workflowIds: [],
          error: `Folder not found: ${folderId}`,
        };
      }

      const workflowIds = new Set<string>();

      // Add workflows from this folder
      this.associations
        .filter((a) => a.folderId === folderId)
        .forEach((a) => workflowIds.add(a.workflowId));

      // Add workflows from subfolders if recursive
      if (recursive) {
        const descendants = this.getFolderDescendants(folderId);
        for (const descendant of descendants) {
          this.associations
            .filter((a) => a.folderId === descendant.id)
            .forEach((a) => workflowIds.add(a.workflowId));
        }
      }

      return {
        success: true,
        workflowIds: Array.from(workflowIds),
      };
    } catch (error) {
      return {
        success: false,
        workflowIds: [],
        error: `Failed to get workflows: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ==========================================================================
  // Tree Operations
  // ==========================================================================

  /**
   * Move folder to a new parent
   */
  moveFolder(folderId: string, newParentId: string | null): MoveResult {
    try {
      const folder = this.folders.get(folderId);
      if (!folder) {
        return {
          success: false,
          error: `Folder not found: ${folderId}`,
        };
      }

      // Validate move
      const validation = this.canMoveFolder(folderId, newParentId);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.errors[0],
        };
      }

      // Update folder
      return this.updateFolder(folderId, { parentId: newParentId });
    } catch (error) {
      return {
        success: false,
        error: `Failed to move folder: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Get all descendants of a folder
   */
  getFolderDescendants(folderId: string): WorkflowFolder[] {
    const descendants: WorkflowFolder[] = [];
    const children = this.getChildren(folderId);

    for (const child of children) {
      descendants.push(child);
      descendants.push(...this.getFolderDescendants(child.id));
    }

    return descendants;
  }

  /**
   * Get all ancestors of a folder
   */
  getFolderAncestors(folderId: string): WorkflowFolder[] {
    const ancestors: WorkflowFolder[] = [];
    let currentId: string | null = folderId;

    while (currentId) {
      const folder = this.folders.get(currentId);
      if (!folder) break;

      if (folder.parentId) {
        const parent = this.folders.get(folder.parentId);
        if (parent) {
          ancestors.unshift(parent);
        }
      }

      currentId = folder.parentId;
    }

    return ancestors;
  }

  /**
   * Check if folder can be moved to new parent (prevents circular dependencies)
   */
  canMoveFolder(
    folderId: string,
    newParentId: string | null
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Cannot move to itself
    if (folderId === newParentId) {
      errors.push("Cannot move folder to itself");
      return { valid: false, errors, warnings };
    }

    // Check if new parent exists
    if (newParentId && !this.folders.has(newParentId)) {
      errors.push(`Parent folder not found: ${newParentId}`);
      return { valid: false, errors, warnings };
    }

    // Check for circular dependency
    if (newParentId) {
      const descendants = this.getFolderDescendants(folderId);
      if (descendants.some((d) => d.id === newParentId)) {
        errors.push(
          "Cannot move folder to one of its descendants (circular dependency)"
        );
        return { valid: false, errors, warnings };
      }
    }

    // Check depth
    const newDepth = this.calculateDepth(newParentId) + 1;
    const maxDescendantDepth = this.getMaxDescendantDepth(folderId);
    if (newDepth + maxDescendantDepth > DEFAULT_VALIDATION_RULES.maxDepth) {
      errors.push(
        `Move would exceed maximum depth of ${DEFAULT_VALIDATION_RULES.maxDepth}`
      );
      return { valid: false, errors, warnings };
    }

    return { valid: true, errors, warnings };
  }

  // ==========================================================================
  // Search
  // ==========================================================================

  /**
   * Search folders by name and description
   */
  searchFolders(options: FolderSearchOptions): FolderSearchResult[] {
    const {
      query,
      includeDescription = true,
      caseSensitive = false,
      exactMatch = false,
    } = options;

    const searchTerm = caseSensitive ? query : query.toLowerCase();
    const results: FolderSearchResult[] = [];

    for (const folder of this.folders.values()) {
      const matches: FolderSearchResult["matches"] = [];
      let score = 0;

      // Search name
      const folderName = caseSensitive
        ? folder.name
        : folder.name.toLowerCase();
      if (
        exactMatch ? folderName === searchTerm : folderName.includes(searchTerm)
      ) {
        matches.push({
          field: "name",
          value: folder.name,
          matchedText: query,
        });
        score += exactMatch ? 100 : 50;
      }

      // Search description
      if (includeDescription && folder.description) {
        const folderDesc = caseSensitive
          ? folder.description
          : folder.description.toLowerCase();
        if (
          exactMatch
            ? folderDesc === searchTerm
            : folderDesc.includes(searchTerm)
        ) {
          matches.push({
            field: "description",
            value: folder.description,
            matchedText: query,
          });
          score += exactMatch ? 50 : 25;
        }
      }

      if (matches.length > 0) {
        results.push({
          folder: { ...folder },
          matches,
          score,
        });
      }
    }

    // Sort by score (descending)
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Find folder by path (e.g., "/Projects/Web/Frontend")
   */
  findFolderByPath(path: string): FolderOperationResult {
    try {
      const parts = path.split("/").filter((p) => p.trim());
      if (parts.length === 0) {
        return {
          success: false,
          error: "Invalid path",
        };
      }

      let currentParentId: string | null = null;

      for (const part of parts) {
        const children = this.getChildren(currentParentId);
        const found = children.find((c) => c.name === part);

        if (!found) {
          return {
            success: false,
            error: `Folder not found at path: ${path}`,
          };
        }

        currentParentId = found.id;
      }

      if (!currentParentId) {
        return {
          success: false,
          error: "Folder not found",
        };
      }

      return this.getFolder(currentParentId);
    } catch (error) {
      return {
        success: false,
        error: `Failed to find folder by path: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Save to localStorage
   */
  private save(): void {
    if (!this.autoSaveEnabled) return;

    try {
      const data: FolderStorageData = {
        folders: Object.fromEntries(this.folders),
        associations: this.associations,
        version: STORAGE_VERSION,
        lastModified: new Date().toISOString(),
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("Failed to save folders to storage:", error);
    }
  }

  /**
   * Load from localStorage
   */
  private loadFromStorage(): void {
    try {
      const json = localStorage.getItem(STORAGE_KEY);
      if (!json) return;

      const data: FolderStorageData = JSON.parse(json);

      // Validate version
      if (data.version !== STORAGE_VERSION) {
        console.warn(
          `Storage version mismatch. Expected ${STORAGE_VERSION}, got ${data.version}`
        );
        // Could trigger migration here
      }

      // Load folders
      this.folders = new Map(Object.entries(data.folders || {}));

      // Load associations
      this.associations = data.associations || [];

      // Update counts
      this.recalculateAllCounts();
    } catch (error) {
      console.error("Failed to load folders from storage:", error);
    }
  }

  /**
   * Export folder structure
   */
  exportFolders(): ImportExportData {
    return {
      folders: Array.from(this.folders.values()),
      associations: this.associations,
      exportedAt: new Date().toISOString(),
      exportedBy: "Qontinui",
      version: STORAGE_VERSION,
    };
  }

  /**
   * Import folder structure
   */
  importFolders(data: ImportExportData, merge = false): MigrationResult {
    const result: MigrationResult = {
      success: true,
      migratedFolders: 0,
      migratedAssociations: 0,
      errors: [],
      warnings: [],
    };

    try {
      // Clear existing data if not merging
      if (!merge) {
        this.folders.clear();
        this.associations = [];
      }

      // Import folders
      for (const folder of data.folders) {
        if (this.folders.has(folder.id) && merge) {
          result.warnings.push(
            `Skipped duplicate folder: ${folder.name} (${folder.id})`
          );
          continue;
        }

        this.folders.set(folder.id, folder);
        result.migratedFolders++;
      }

      // Import associations
      for (const association of data.associations) {
        const exists = this.associations.some(
          (a) =>
            a.workflowId === association.workflowId &&
            a.folderId === association.folderId
        );

        if (exists && merge) {
          result.warnings.push(
            `Skipped duplicate association for workflow: ${association.workflowId}`
          );
          continue;
        }

        if (!exists) {
          this.associations.push(association);
          result.migratedAssociations++;
        }
      }

      // Recalculate counts
      this.recalculateAllCounts();
      this.save();
    } catch (error) {
      result.success = false;
      result.errors.push(
        `Import failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    return result;
  }

  /**
   * Clear all folders and associations
   */
  clearAll(): void {
    this.folders.clear();
    this.associations = [];
    this.save();
  }

  /**
   * Enable/disable auto-save
   */
  setAutoSave(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
  }

  // ==========================================================================
  // Validation
  // ==========================================================================

  /**
   * Validate folder name
   */
  private validateFolderName(
    name: string,
    parentId: string | null | undefined,
    excludeId?: string
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check empty
    if (!name || !name.trim()) {
      errors.push("Folder name cannot be empty");
      return { valid: false, errors, warnings };
    }

    // Check length
    if (name.length > DEFAULT_VALIDATION_RULES.maxNameLength) {
      errors.push(
        `Folder name cannot exceed ${DEFAULT_VALIDATION_RULES.maxNameLength} characters`
      );
      return { valid: false, errors, warnings };
    }

    // Check reserved names
    if (DEFAULT_VALIDATION_RULES.reservedNames.includes(name.toLowerCase())) {
      errors.push(`"${name}" is a reserved folder name`);
      return { valid: false, errors, warnings };
    }

    // Check uniqueness within parent
    const siblings = this.getChildren(parentId || null);
    const duplicate = siblings.find(
      (s) => s.name === name && s.id !== excludeId
    );
    if (duplicate) {
      errors.push(`A folder named "${name}" already exists in this location`);
      return { valid: false, errors, warnings };
    }

    return { valid: true, errors, warnings };
  }

  /**
   * Validate color
   */
  private isValidColor(color: string): boolean {
    // Allow hex colors
    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return true;
    }

    // Check allowed colors
    return DEFAULT_VALIDATION_RULES.allowedColors.includes(color);
  }

  /**
   * Validate icon
   */
  private isValidIcon(icon: string): boolean {
    return DEFAULT_VALIDATION_RULES.allowedIcons.includes(icon);
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `folder-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get children of a folder
   */
  private getChildren(parentId: string | null): WorkflowFolder[] {
    return Array.from(this.folders.values())
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /**
   * Get next order number for a parent
   */
  private getNextOrder(parentId: string | null | undefined): number {
    const children = this.getChildren(parentId || null);
    if (children.length === 0) return 0;

    const maxOrder = Math.max(...children.map((c) => c.order ?? 0));
    return maxOrder + 1;
  }

  /**
   * Calculate depth of a folder
   */
  private calculateDepth(folderId: string | null | undefined): number {
    let depth = 0;
    let currentId = folderId;

    while (currentId) {
      const folder = this.folders.get(currentId);
      if (!folder) break;
      depth++;
      currentId = folder.parentId;
    }

    return depth;
  }

  /**
   * Get maximum depth of descendants
   */
  private getMaxDescendantDepth(folderId: string, currentDepth = 0): number {
    const children = this.getChildren(folderId);
    if (children.length === 0) return currentDepth;

    const childDepths = children.map((c) =>
      this.getMaxDescendantDepth(c.id, currentDepth + 1)
    );
    return Math.max(...childDepths);
  }

  /**
   * Build folder tree
   */
  private buildTree(rootId: string | null, depth = 0): FolderTreeNode[] {
    const children = this.getChildren(rootId);

    return children.map((folder) => {
      const node: FolderTreeNode = {
        ...folder,
        children: this.buildTree(folder.id, depth + 1),
        depth,
        path: this.getFolderPath(folder.id).map((p) => p.name),
        hasChildren: this.getChildren(folder.id).length > 0,
      };

      return node;
    });
  }

  /**
   * Update workflow counts for a folder and its ancestors
   */
  private updateWorkflowCounts(folderId: string | null | undefined): void {
    if (!folderId) return;

    const folder = this.folders.get(folderId);
    if (!folder) return;

    // Count workflows in this folder
    const count = this.associations.filter(
      (a) => a.folderId === folderId
    ).length;

    folder.metadata.workflowCount = count;
    folder.metadata.updated = new Date().toISOString();

    // Update parent
    if (folder.parentId) {
      this.updateWorkflowCounts(folder.parentId);
    }
  }

  /**
   * Update descendant counts for a folder and its ancestors
   */
  private updateDescendantCounts(folderId: string | null | undefined): void {
    if (!folderId) return;

    const folder = this.folders.get(folderId);
    if (!folder) return;

    // Count descendants
    const descendants = this.getFolderDescendants(folderId);
    folder.metadata.descendantCount = descendants.length;
    folder.metadata.updated = new Date().toISOString();

    // Update parent
    if (folder.parentId) {
      this.updateDescendantCounts(folder.parentId);
    }
  }

  /**
   * Recalculate all counts
   */
  private recalculateAllCounts(): void {
    // Update workflow counts
    for (const folder of this.folders.values()) {
      const count = this.associations.filter(
        (a) => a.folderId === folder.id
      ).length;
      folder.metadata.workflowCount = count;
    }

    // Update descendant counts (bottom-up)
    const folders = Array.from(this.folders.values());
    const byDepth = folders.sort((a, b) => {
      const depthA = this.calculateDepth(a.id);
      const depthB = this.calculateDepth(b.id);
      return depthB - depthA; // Descending order
    });

    for (const folder of byDepth) {
      const descendants = this.getFolderDescendants(folder.id);
      folder.metadata.descendantCount = descendants.length;
    }
  }

  /**
   * Handle orphaned workflows (workflows in deleted folders)
   */
  cleanupOrphanedWorkflows(): number {
    const validFolderIds = new Set(this.folders.keys());
    const orphaned = this.associations.filter(
      (a) => !validFolderIds.has(a.folderId)
    );

    // Remove orphaned associations
    this.associations = this.associations.filter((a) =>
      validFolderIds.has(a.folderId)
    );

    if (orphaned.length > 0) {
      this.save();
    }

    return orphaned.length;
  }
}

// ============================================================================
// Exports
// ============================================================================

export const workflowFolderManager = WorkflowFolderManager.getInstance();
