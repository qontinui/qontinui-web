/**
 * Workflow Version Control - Tag Manager
 *
 * Tag CRUD operations: create, delete, get, list, and lookup by tag name.
 * Tags mark important versions with a human-readable name.
 */

import type { Tag, Version } from "./types";

// ============================================================================
// TagManager
// ============================================================================

export class TagManager {
  constructor(
    private tags: Map<string, Tag[]>,
    private getVersionById: (versionId: string) => Version | undefined,
    private generateId: (prefix: string) => string,
    private saveData: () => void
  ) {}

  /**
   * Create a tag for a version
   */
  createTag(
    workflowId: string,
    versionId: string,
    tagName: string,
    description?: string
  ): Tag {
    const version = this.getVersionById(versionId);
    if (!version || version.workflowId !== workflowId) {
      throw new Error("Version not found");
    }

    const tags = this.tags.get(workflowId) || [];

    // Check if tag name already exists
    if (tags.some((t) => t.name === tagName)) {
      throw new Error(`Tag "${tagName}" already exists`);
    }

    const tag: Tag = {
      id: this.generateId("tag"),
      workflowId,
      versionId,
      name: tagName,
      description,
      createdAt: new Date().toISOString(),
    };

    tags.push(tag);
    this.tags.set(workflowId, tags);
    this.saveData();

    return tag;
  }

  /**
   * Delete a tag
   */
  deleteTag(tagId: string): boolean {
    for (const [workflowId, tags] of this.tags.entries()) {
      const index = tags.findIndex((t) => t.id === tagId);
      if (index !== -1) {
        tags.splice(index, 1);
        this.tags.set(workflowId, tags);
        this.saveData();
        return true;
      }
    }
    return false;
  }

  /**
   * Get a tag by ID
   */
  getTag(tagId: string): Tag | undefined {
    for (const tags of this.tags.values()) {
      const tag = tags.find((t) => t.id === tagId);
      if (tag) return tag;
    }
    return undefined;
  }

  /**
   * Get all tags for a workflow
   */
  getAllTags(workflowId: string): Tag[] {
    return this.tags.get(workflowId) || [];
  }

  /**
   * Get version by tag name
   */
  getVersionByTag(workflowId: string, tagName: string): Version | undefined {
    const tags = this.getAllTags(workflowId);
    const tag = tags.find((t) => t.name === tagName);
    return tag ? this.getVersionById(tag.versionId) : undefined;
  }
}
