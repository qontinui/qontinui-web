/**
 * Conflict Resolution and Synchronization Types
 *
 * Defines types for conflict detection, resolution, and operational transformation
 * in collaborative editing scenarios.
 */

/**
 * Types of conflicts that can occur during collaborative editing
 */
export type ConflictType =
  | "ActionModified" // Both users modified the same action
  | "ActionRemoved" // One user removed while another modified
  | "PropertyChanged" // Both changed the same property
  | "ConnectionChanged" // Both changed connections
  | "StructureChanged" // Structural changes to the workflow
  | "MetadataChanged"; // Metadata conflicts

/**
 * Strategies for resolving conflicts
 */
export type ResolutionStrategy =
  | "KeepLocal" // Use local changes
  | "KeepRemote" // Use server changes
  | "Merge" // Attempt automatic merge
  | "Manual"; // Require user decision

/**
 * Types of operations for operational transformation
 */
export type OperationType =
  | "insert" // Add action/node
  | "delete" // Remove action/node
  | "update" // Modify properties
  | "move" // Change position
  | "connect" // Add connection
  | "disconnect"; // Remove connection

/**
 * Severity levels for conflicts
 */
export type ConflictSeverity = "low" | "medium" | "high";

/**
 * Resource types that can have conflicts
 */
export type ResourceType =
  | "workflow"
  | "state"
  | "image"
  | "transition"
  | "action"
  | "connection";

/**
 * Status of sync operations
 */
export type SyncStatus =
  | "pending"
  | "syncing"
  | "success"
  | "conflict"
  | "error";

/**
 * Represents a conflict between local and server versions
 */
export interface Conflict {
  /** Unique identifier for the conflict */
  id: string;

  /** Type of conflict */
  type: ConflictType;

  /** Resource type (workflow, state, etc.) */
  resourceType: ResourceType;

  /** Resource identifier */
  resourceId: string;

  /** Local version of the resource */
  localVersion: any;

  /** Server version of the resource */
  serverVersion: any;

  /** Base version (common ancestor) */
  baseVersion: any;

  /** Path to the conflicting field */
  path: string[];

  /** Severity of the conflict */
  severity: ConflictSeverity;

  /** Whether the conflict can be auto-resolved */
  autoResolvable: boolean;

  /** When the conflict was detected */
  createdAt: Date;

  /** User who created the local version */
  localUserId?: string;

  /** User who created the server version */
  remoteUserId?: string;

  /** Description of the conflict */
  description?: string;
}

/**
 * Result of a merge operation
 */
export interface MergeResult {
  /** Whether the merge was successful */
  success: boolean;

  /** List of conflicts found during merge */
  conflicts: Conflict[];

  /** The merged version (if successful) */
  mergedVersion: any;

  /** Resolutions applied */
  resolutions: Resolution[];

  /** Any errors that occurred */
  errors?: string[];
}

/**
 * Represents the resolution of a conflict
 */
export interface Resolution {
  /** Conflict that was resolved */
  conflictId: string;

  /** Strategy used to resolve */
  strategy: ResolutionStrategy;

  /** Resulting value after resolution */
  resolvedValue: any;

  /** User who resolved the conflict */
  resolvedBy?: string;

  /** When the conflict was resolved */
  resolvedAt: Date;

  /** Additional notes about the resolution */
  notes?: string;
}

/**
 * Represents an operation for operational transformation
 */
export interface Operation {
  /** Type of operation */
  type: OperationType;

  /** Path to the field being operated on */
  path: string[];

  /** Value being set (for insert/update) */
  value?: any;

  /** Previous value (for update/delete) */
  oldValue?: any;

  /** When the operation was created */
  timestamp: Date;

  /** User who created the operation */
  userId: string;

  /** Unique identifier for the operation */
  operationId: string;

  /** Position for insert/move operations */
  position?: number;

  /** New position for move operations */
  newPosition?: number;

  /** Connection source/target for connect/disconnect */
  sourceId?: string;
  targetId?: string;
}

/**
 * Result of checking for conflicts
 */
export interface ConflictCheckResult {
  /** Whether conflicts were found */
  hasConflicts: boolean;

  /** List of conflicts */
  conflicts: Conflict[];

  /** Current server version */
  serverVersion: any;

  /** Whether the resource can be saved */
  canSave: boolean;

  /** Suggested resolution strategy */
  suggestedStrategy?: ResolutionStrategy;
}

/**
 * Detailed information about a conflict
 */
export interface ConflictDetails extends Conflict {
  /** Local changes */
  localChanges: Change[];

  /** Remote changes */
  remoteChanges: Change[];

  /** Available resolution strategies */
  availableStrategies: ResolutionStrategy[];

  /** Recommended strategy */
  recommendedStrategy: ResolutionStrategy;

  /** Preview of each resolution strategy */
  strategyPreviews: Record<ResolutionStrategy, any>;
}

/**
 * Represents a change to a resource
 */
export interface Change {
  /** Unique identifier for the change */
  id: string;

  /** Type of change */
  type: OperationType;

  /** Resource being changed */
  resourceType: ResourceType;
  resourceId: string;

  /** Path to the changed field */
  path: string[];

  /** New value */
  value: any;

  /** Previous value */
  oldValue?: any;

  /** When the change was made */
  timestamp: Date;

  /** User who made the change */
  userId: string;

  /** Whether this is an optimistic update */
  optimistic?: boolean;

  /** Version of the resource before the change */
  baseVersion?: string;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /** Whether the sync was successful */
  success: boolean;

  /** Sync status */
  status: SyncStatus;

  /** Conflicts detected during sync */
  conflicts: Conflict[];

  /** Changes that were applied */
  appliedChanges: Change[];

  /** Changes that failed to apply */
  failedChanges: Change[];

  /** Current version after sync */
  currentVersion: any;

  /** Version identifier */
  versionId: string;

  /** Any errors that occurred */
  errors?: string[];
}

/**
 * Represents a sync operation in the queue
 */
export interface SyncOperation {
  /** Unique identifier */
  id: string;

  /** Type of operation */
  type: OperationType;

  /** Resource details */
  resourceType: ResourceType;
  resourceId: string;

  /** Change to sync */
  change: Change;

  /** Priority (higher = more important) */
  priority: number;

  /** Number of retry attempts */
  retryCount: number;

  /** When the operation was queued */
  queuedAt: Date;

  /** Status of the operation */
  status: "queued" | "processing" | "completed" | "failed";
}

/**
 * Remote update received via WebSocket
 */
export interface RemoteUpdate {
  /** Type of update */
  type: "change" | "conflict" | "version";

  /** Resource details */
  resourceType: ResourceType;
  resourceId: string;

  /** The change that was made */
  change?: Change;

  /** Conflict information (if applicable) */
  conflict?: Conflict;

  /** New version information */
  version?: {
    id: string;
    number: number;
    data: any;
  };

  /** User who made the change */
  userId: string;

  /** When the update occurred */
  timestamp: Date;
}

/**
 * Three-way merge information
 */
export interface ThreeWayMergeInfo {
  /** Base version (common ancestor) */
  base: any;

  /** Local version */
  local: any;

  /** Remote version */
  remote: any;

  /** Path being merged */
  path: string[];
}

/**
 * Optimistic update information
 */
export interface OptimisticUpdate {
  /** Unique identifier */
  id: string;

  /** The change being optimistically applied */
  change: Change;

  /** Original state before the update */
  originalState: any;

  /** When the update was applied */
  appliedAt: Date;

  /** Whether the update has been confirmed by server */
  confirmed: boolean;

  /** Whether the update needs to be rolled back */
  rollback: boolean;
}

/**
 * Conflict resolution context
 */
export interface ConflictResolutionContext {
  /** Project identifier */
  projectId: string;

  /** User resolving the conflict */
  userId: string;

  /** Available collaborators */
  collaborators: Array<{
    id: string;
    name: string;
    email: string;
  }>;

  /** History of changes */
  changeHistory: Change[];

  /** Current state of the resource */
  currentState: any;
}

/**
 * Auto-resolution result
 */
export interface AutoResolutionResult {
  /** Conflicts that were auto-resolved */
  resolved: Resolution[];

  /** Conflicts that require manual resolution */
  requiresManual: Conflict[];

  /** Success rate */
  successRate: number;
}

/**
 * Transformation result for operational transform
 */
export interface TransformResult {
  /** Transformed operation 1 */
  op1Prime: Operation;

  /** Transformed operation 2 */
  op2Prime: Operation;

  /** Whether the transformation was successful */
  success: boolean;

  /** Any warnings or notes */
  warnings?: string[];
}

/**
 * Composition of multiple operations
 */
export interface ComposedOperation extends Operation {
  /** Operations that were composed */
  composedFrom: Operation[];
}

/**
 * Inverted operation for undo
 */
export interface InvertedOperation extends Operation {
  /** Original operation that was inverted */
  invertedFrom: Operation;
}

/**
 * Path transformation result
 */
export interface PathTransformResult {
  /** Transformed path */
  transformedPath: string[];

  /** Whether the path still exists after transformation */
  exists: boolean;

  /** Reason if the path no longer exists */
  reason?: string;
}

/**
 * Offline change queue state
 */
export interface OfflineQueueState {
  /** Pending operations */
  pending: SyncOperation[];

  /** Failed operations */
  failed: SyncOperation[];

  /** Total size of the queue */
  size: number;

  /** Whether the queue is being processed */
  processing: boolean;

  /** Last sync attempt */
  lastSyncAttempt?: Date;

  /** Next scheduled sync */
  nextSync?: Date;
}

/**
 * Version information
 */
export interface VersionInfo {
  /** Version identifier */
  id: string;

  /** Version number */
  number: number;

  /** Version data */
  data: any;

  /** When the version was created */
  createdAt: Date;

  /** User who created the version */
  createdBy: string;

  /** Parent version */
  parentId?: string;

  /** Changes in this version */
  changes: Change[];
}

/**
 * Branch merge information
 */
export interface BranchMergeInfo {
  /** Source version/branch */
  sourceVersionId: string;

  /** Target version/branch */
  targetVersionId: string;

  /** Common ancestor */
  baseVersionId: string;

  /** Merge strategy */
  strategy: ResolutionStrategy;
}

/**
 * Conflict detector configuration
 */
export interface ConflictDetectorConfig {
  /** Whether to detect property changes */
  detectPropertyChanges: boolean;

  /** Whether to detect structural changes */
  detectStructuralChanges: boolean;

  /** Minimum severity to report */
  minimumSeverity: ConflictSeverity;

  /** Custom conflict detection rules */
  customRules?: Array<(local: any, remote: any, base: any) => Conflict | null>;
}

/**
 * Sync service configuration
 */
export interface SyncServiceConfig {
  /** WebSocket URL */
  wsUrl: string;

  /** Sync interval (ms) */
  syncInterval: number;

  /** Maximum retry attempts */
  maxRetries: number;

  /** Retry delay (ms) */
  retryDelay: number;

  /** Enable optimistic updates */
  enableOptimisticUpdates: boolean;

  /** Enable offline queue */
  enableOfflineQueue: boolean;

  /** Maximum queue size */
  maxQueueSize: number;
}
