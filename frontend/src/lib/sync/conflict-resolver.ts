/**
 * Conflict Resolver
 *
 * Handles conflicts between local and backend data.
 * Implements last-write-wins strategy with optional user intervention.
 */

import { projectLogger } from "@/lib/project-logger";

/**
 * Conflict resolution strategy
 */
export type ConflictStrategy = "local-wins" | "server-wins" | "merge" | "ask-user";

/**
 * Conflict information
 */
export interface ConflictInfo<T = unknown> {
  /** Entity type (workflow, state, transition, image) */
  entityType: string;
  /** Entity ID */
  entityId: string;
  /** Local version of the data */
  localData: T;
  /** Server version of the data */
  serverData: T;
  /** Timestamp of local change */
  localTimestamp: Date;
  /** Timestamp of server change */
  serverTimestamp: Date;
}

/**
 * Resolution result
 */
export interface ResolutionResult<T = unknown> {
  /** The resolved data */
  resolvedData: T;
  /** Which source was used */
  source: "local" | "server" | "merged";
  /** Whether user intervention was required */
  userIntervened: boolean;
}

/**
 * Conflict resolver configuration
 */
export interface ConflictResolverConfig {
  /** Default strategy for automatic resolution */
  defaultStrategy: ConflictStrategy;
  /** Grace period (ms) where concurrent edits are considered the same */
  gracePeriodMs: number;
  /** Callback for user intervention */
  onUserIntervention?: <T>(conflict: ConflictInfo<T>) => Promise<T>;
}

/**
 * Conflict Resolver implementation
 */
class ConflictResolverImpl {
  private config: ConflictResolverConfig = {
    defaultStrategy: "local-wins",
    gracePeriodMs: 5000,
  };

  /**
   * Configure the resolver
   */
  configure(config: Partial<ConflictResolverConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Resolve a conflict between local and server data
   */
  async resolve<T>(
    conflict: ConflictInfo<T>,
    strategy?: ConflictStrategy
  ): Promise<ResolutionResult<T>> {
    const effectiveStrategy = strategy || this.config.defaultStrategy;

    projectLogger.debug("ConflictResolver", "Resolving conflict", {
      entityType: conflict.entityType,
      entityId: conflict.entityId,
      strategy: effectiveStrategy,
    });

    // Check if within grace period (concurrent edits)
    const timeDiff = Math.abs(
      conflict.localTimestamp.getTime() - conflict.serverTimestamp.getTime()
    );
    if (timeDiff < this.config.gracePeriodMs) {
      // Within grace period, use last-write-wins
      const useLocal = conflict.localTimestamp > conflict.serverTimestamp;
      projectLogger.debug("ConflictResolver", "Within grace period", {
        timeDiff,
        useLocal,
      });

      return {
        resolvedData: useLocal ? conflict.localData : conflict.serverData,
        source: useLocal ? "local" : "server",
        userIntervened: false,
      };
    }

    switch (effectiveStrategy) {
      case "local-wins":
        return {
          resolvedData: conflict.localData,
          source: "local",
          userIntervened: false,
        };

      case "server-wins":
        return {
          resolvedData: conflict.serverData,
          source: "server",
          userIntervened: false,
        };

      case "merge":
        return this.attemptMerge(conflict);

      case "ask-user":
        return this.askUser(conflict);

      default:
        // Default to local-wins
        return {
          resolvedData: conflict.localData,
          source: "local",
          userIntervened: false,
        };
    }
  }

  /**
   * Attempt to merge local and server data
   */
  private attemptMerge<T>(conflict: ConflictInfo<T>): ResolutionResult<T> {
    // For now, merge strategy just uses last-write-wins
    // In the future, this could do field-level merging for objects
    const useLocal = conflict.localTimestamp > conflict.serverTimestamp;

    projectLogger.debug("ConflictResolver", "Merge fallback to last-write-wins", {
      entityType: conflict.entityType,
      entityId: conflict.entityId,
      useLocal,
    });

    return {
      resolvedData: useLocal ? conflict.localData : conflict.serverData,
      source: useLocal ? "local" : "server",
      userIntervened: false,
    };
  }

  /**
   * Ask user to resolve conflict
   */
  private async askUser<T>(conflict: ConflictInfo<T>): Promise<ResolutionResult<T>> {
    if (this.config.onUserIntervention) {
      try {
        const resolvedData = await this.config.onUserIntervention(conflict);
        return {
          resolvedData,
          source: "merged",
          userIntervened: true,
        };
      } catch (error) {
        projectLogger.error("ConflictResolver", "User intervention failed", { error });
        // Fall back to local-wins
        return {
          resolvedData: conflict.localData,
          source: "local",
          userIntervened: false,
        };
      }
    }

    // No callback configured, fall back to local-wins
    projectLogger.warn(
      "ConflictResolver",
      "ask-user strategy but no callback configured, using local-wins"
    );
    return {
      resolvedData: conflict.localData,
      source: "local",
      userIntervened: false,
    };
  }

  /**
   * Check if two items are in conflict
   */
  hasConflict<T extends { updatedAt?: Date | string }>(
    local: T,
    server: T,
    lastSyncTime: Date
  ): boolean {
    const localUpdated = local.updatedAt
      ? new Date(local.updatedAt)
      : new Date(0);
    const serverUpdated = server.updatedAt
      ? new Date(server.updatedAt)
      : new Date(0);

    // Conflict exists if both were modified after last sync
    return localUpdated > lastSyncTime && serverUpdated > lastSyncTime;
  }

  /**
   * Detect conflicts in a collection
   */
  detectConflicts<T extends { id: string; updatedAt?: Date | string }>(
    localItems: T[],
    serverItems: T[],
    lastSyncTime: Date,
    entityType: string
  ): ConflictInfo<T>[] {
    const conflicts: ConflictInfo<T>[] = [];
    const serverMap = new Map(serverItems.map((item) => [item.id, item]));

    for (const localItem of localItems) {
      const serverItem = serverMap.get(localItem.id);
      if (serverItem && this.hasConflict(localItem, serverItem, lastSyncTime)) {
        conflicts.push({
          entityType,
          entityId: localItem.id,
          localData: localItem,
          serverData: serverItem,
          localTimestamp: localItem.updatedAt
            ? new Date(localItem.updatedAt)
            : new Date(),
          serverTimestamp: serverItem.updatedAt
            ? new Date(serverItem.updatedAt)
            : new Date(),
        });
      }
    }

    if (conflicts.length > 0) {
      projectLogger.info("ConflictResolver", "Conflicts detected", {
        entityType,
        count: conflicts.length,
      });
    }

    return conflicts;
  }
}

// Export singleton instance
export const conflictResolver = new ConflictResolverImpl();
