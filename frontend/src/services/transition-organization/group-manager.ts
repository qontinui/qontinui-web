import type { TransitionGroup } from "./types";

export class GroupManager {
  private groups: Map<string, TransitionGroup> = new Map();

  constructor() {
    this.loadGroups();
  }

  createTransitionGroup(
    name: string,
    transitionIds: string[],
    options: {
      description?: string;
      color?: string;
      tags?: string[];
      enabled?: boolean;
    } = {}
  ): TransitionGroup {
    const group: TransitionGroup = {
      id: `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      description: options.description || "",
      color: options.color,
      transitionIds,
      enabled: options.enabled !== false,
      tags: options.tags || [],
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    this.groups.set(group.id, group);
    this.saveGroups();
    return group;
  }

  getGroup(id: string): TransitionGroup | undefined {
    return this.groups.get(id);
  }

  getAllGroups(): TransitionGroup[] {
    return Array.from(this.groups.values());
  }

  updateGroup(id: string, updates: Partial<TransitionGroup>): boolean {
    const group = this.groups.get(id);
    if (!group) return false;

    Object.assign(group, updates);
    group.metadata = {
      ...group.metadata,
      updated: new Date().toISOString(),
    };

    this.saveGroups();
    return true;
  }

  deleteGroup(id: string): boolean {
    const deleted = this.groups.delete(id);
    if (deleted) {
      this.saveGroups();
    }
    return deleted;
  }

  addToGroup(groupId: string, transitionIds: string[]): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    group.transitionIds = [
      ...new Set([...group.transitionIds, ...transitionIds]),
    ];
    group.metadata = {
      ...group.metadata,
      updated: new Date().toISOString(),
    };

    this.saveGroups();
    return true;
  }

  removeFromGroup(groupId: string, transitionIds: string[]): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    group.transitionIds = group.transitionIds.filter(
      (id) => !transitionIds.includes(id)
    );
    group.metadata = {
      ...group.metadata,
      updated: new Date().toISOString(),
    };

    this.saveGroups();
    return true;
  }

  toggleGroupEnabled(groupId: string, enabled: boolean): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    group.enabled = enabled;
    this.saveGroups();
    return true;
  }

  getGroupsForTransition(transitionId: string): TransitionGroup[] {
    return Array.from(this.groups.values()).filter((g) =>
      g.transitionIds.includes(transitionId)
    );
  }

  clearGroups(): void {
    this.groups.clear();
    this.saveGroups();
  }

  loadGroups(): void {
    try {
      const json = localStorage.getItem("transition-groups");
      if (json) {
        const groups = JSON.parse(json) as TransitionGroup[];
        groups.forEach((g) => this.groups.set(g.id, g));
      }
    } catch (error) {
      console.error("Failed to load transition groups:", error);
    }
  }

  saveGroups(): void {
    try {
      const groups = Array.from(this.groups.values());
      localStorage.setItem("transition-groups", JSON.stringify(groups));
    } catch (error) {
      console.error("Failed to save transition groups:", error);
    }
  }
}
