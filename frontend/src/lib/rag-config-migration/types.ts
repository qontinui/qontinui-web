/**
 * RAG Configuration Migration System - Type Definitions
 *
 * Provides type-safe migration infrastructure for RAG configuration formats
 */

/**
 * Current RAG configuration version
 */
export const CURRENT_RAG_VERSION = "1.0.0";

/**
 * Bounding box coordinates for UI elements
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Metadata for RAG configuration
 */
export interface RAGMetadata {
  name: string;
  description?: string;
  author?: string;
  createdAt: string;
  modifiedAt: string;
  tags?: string[];
  targetApplication?: string;
}

/**
 * Configuration for embedding models
 */
export interface EmbeddingConfig {
  textModel: string;
  textModelVersion: string;
  textEmbeddingDim: number;
  clipModel: string;
  clipModelVersion: string;
  clipEmbeddingDim: number;
  dinov2Model: string;
  dinov2ModelVersion: string;
  dinov2EmbeddingDim: number;
}

/**
 * UI element with semantic information and embeddings
 */
export interface RAGElement {
  id: string;
  name: string;
  elementType: string;
  textDescription?: string;
  ocrText?: string;
  boundingBox: BoundingBox;
  dominantColors?: string[];
  isInteractive: boolean;
  interactionType?: string;
  semanticRole?: string;
  semanticAction?: string;
  stateId: string;
  stateName: string;
  isDefiningElement: boolean;
  similarityThreshold?: number;
  sourceScreenshotId: string;
  elementHash: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Application state defined by UI elements
 */
export interface RAGState {
  id: string;
  name: string;
  description?: string;
  definingElementIds: string[];
  optionalElementIds?: string[];
  expectedText?: string[];
}

/**
 * Action within a workflow
 */
export interface RAGAction {
  actionType: string;
  config: Record<string, unknown>;
}

/**
 * Workflow containing a sequence of actions
 */
export interface RAGWorkflow {
  id: string;
  name: string;
  description?: string;
  actions: RAGAction[];
}

/**
 * State transition triggered by a workflow
 */
export interface RAGTransition {
  id: string;
  name: string;
  fromStates: string[];
  toStates: string[];
  workflowId: string;
}

/**
 * Information about a captured screenshot
 */
export interface ScreenshotInfo {
  filename: string;
  width: number;
  height: number;
  capturedAt: string;
}

/**
 * Information about the vector database
 */
export interface VectorDBInfo {
  filename: string;
  elementCount: number;
  lastIndexedAt: string;
  indexHash: string;
}

/**
 * Main RAG configuration container
 */
export interface RAGConfig {
  version: string;
  configType: string;
  metadata: RAGMetadata;
  embeddingConfig: EmbeddingConfig;
  elements: RAGElement[];
  states: RAGState[];
  workflows: RAGWorkflow[];
  transitions: RAGTransition[];
  screenshots: Record<string, ScreenshotInfo>;
  vectorDb?: VectorDBInfo;
}

/**
 * Context passed through migration pipeline
 * Accumulates warnings and errors during migration
 */
export interface RAGMigrationContext {
  fromVersion: string;
  toVersion: string;
  timestamp: Date;
  warnings: string[];
  errors: string[];
}

/**
 * Result returned from migration operations
 */
export interface RAGMigrationResult {
  config: RAGConfig;
  context: RAGMigrationContext;
  success: boolean;
  requiresReembedding?: boolean;
}

/**
 * History entry added to config metadata
 */
export interface RAGMigrationHistoryEntry {
  fromVersion: string;
  toVersion: string;
  date: string; // ISO 8601 timestamp
  path: string[]; // Array of version transitions, e.g., ["1.0.0→2.0.0", "2.0.0→2.1.0"]
  requiresReembedding: boolean;
}

/**
 * Definition of a single version-to-version migration for RAG configs
 *
 * Each migration is a pure function that transforms a RAG config
 * from one version to the next version.
 */
export interface RAGMigration {
  /** Source version (e.g., "1.0.0") */
  fromVersion: string;

  /** Target version (e.g., "2.0.0") */
  toVersion: string;

  /** Human-readable description of changes */
  description: string;

  /**
   * Transform config from fromVersion to toVersion
   * Should not mutate input config
   */
  migrate(config: RAGConfig, context: RAGMigrationContext): RAGConfig;

  /**
   * Optional: Check if this migration needs to run
   * Returns true if the config has elements that need migration
   */
  isApplicable?(config: RAGConfig): boolean;

  /**
   * Optional: Validate that migration was successful
   * Returns true if the migrated config is valid
   */
  validate?(config: RAGConfig): boolean;

  /**
   * Optional: Indicates if this migration requires re-embedding
   * If true, the user should be prompted to re-embed all elements
   * because the structure or metadata has changed in ways that affect embeddings
   */
  requiresReembedding?: boolean;
}
