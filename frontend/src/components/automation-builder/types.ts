/**
 * Unified Automation Builder - Shared Types
 *
 * Central type definitions for the unified builder that supports
 * both sequential and graph workflows. All items are Workflows -
 * sequential workflows are just linear graphs with no branching.
 */

import type { Workflow, Action } from '@/lib/action-schema/action-types'

/**
 * Builder mode - Sequential for linear workflows, Graph for visual workflows
 */
export type BuilderMode = 'sequential' | 'graph'

/**
 * Library item - always a Workflow (sequential or graph)
 * The viewMode metadata suggests which editor to use
 */
export type LibraryItem = Workflow

/**
 * Editor state for Sequential mode
 */
export interface SequentialEditorState {
  scrollPosition: number
  expandedOptions: boolean
  selectedActionId?: string
}

/**
 * Editor state for Graph mode
 */
export interface GraphEditorState {
  viewport: { x: number; y: number; zoom: number }
  selectedNodes: string[]
  selectedActionId?: string
}

/**
 * Combined editor state (preserved during mode switches)
 */
export interface EditorState {
  sequential: SequentialEditorState | null
  graph: GraphEditorState | null
}

/**
 * Main state for AutomationBuilder component
 */
export interface AutomationBuilderState {
  mode: BuilderMode
  selectedItem: LibraryItem | null
  selectedAction: Action | null
  editorState: EditorState
  conversionDialogOpen: boolean
  conversionItem: LibraryItem | null
}

/**
 * Props for AutomationBuilder component
 */
export interface AutomationBuilderProps {
  /** Initial mode (defaults to 'sequential') */
  initialMode?: BuilderMode
  /** Allow manual mode switching (defaults to true) */
  allowModeSwitch?: boolean
}

/**
 * Props for SequentialEditor component
 */
export interface SequentialEditorProps {
  actions: Action[]
  selectedAction: Action | null
  onSelectAction: (action: Action | null) => void
  onUpdateActions: (actions: Action[]) => void
  onAddAction: (action: Action) => void
  onDeleteAction: (actionId: string) => void
  onDuplicateAction: (actionId: string) => void
  onReorderActions: (startIndex: number, endIndex: number) => void
}

/**
 * Props for GraphEditor component
 */
export interface GraphEditorProps {
  workflow: Workflow
  selectedNode: Action | null
  onSelectNode: (action: Action | null) => void
  onUpdateWorkflow: (workflow: Workflow) => void
  onAddNode: (nodeType: any) => void
}

/**
 * Props for BuilderModeSelector component
 */
export interface BuilderModeSelectorProps {
  mode: BuilderMode
  onModeChange: (mode: BuilderMode) => void
  selectedItem: LibraryItem | null
  className?: string
}

/**
 * Props for ItemMetadataPanel component
 */
export interface ItemMetadataPanelProps {
  item: LibraryItem
  onUpdate: (item: LibraryItem) => void
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

/**
 * Props for EditorToolbar component
 */
export interface EditorToolbarProps {
  mode: BuilderMode
  selectedItem: LibraryItem | null
  onModeChange: (mode: BuilderMode) => void
  onExport?: () => void
  onImport?: () => void
  onConvert?: () => void
}

/**
 * Props for EmptyState component
 */
export interface EmptyStateProps {
  mode: BuilderMode
  onCreateNew?: () => void
}

/**
 * Check if a workflow is linear (no branching)
 */
export function isLinearWorkflow(workflow: Workflow): boolean {
  // Check if workflow has any branching in connections
  for (const sourceId in workflow.connections) {
    const outputs = workflow.connections[sourceId]

    // Check for error/success connections (non-linear)
    if (outputs.error && outputs.error.length > 0) return false
    if (outputs.success && outputs.success.length > 0) return false

    // Check for multiple main outputs (branching)
    if (outputs.main) {
      if (outputs.main.length > 1) return false  // Multiple output indices
      if (outputs.main[0] && outputs.main[0].length > 1) return false  // Multiple connections
    }
  }
  return true
}

/**
 * Get the suggested mode for a workflow
 * Uses viewMode metadata if available, otherwise detects based on structure
 */
export function getSuggestedMode(workflow: LibraryItem | null): BuilderMode {
  if (!workflow) return 'sequential'

  // Use viewMode hint if available
  if (workflow.metadata?.viewMode) {
    return workflow.metadata.viewMode
  }

  // Otherwise detect based on structure
  return isLinearWorkflow(workflow) ? 'sequential' : 'graph'
}

/**
 * Check if workflow is compatible with current mode
 */
export function isItemCompatibleWithMode(workflow: LibraryItem | null, mode: BuilderMode): boolean {
  if (!workflow) return true

  // Sequential mode requires linear workflow
  if (mode === 'sequential') {
    return isLinearWorkflow(workflow)
  }

  // Graph mode supports all workflows
  return true
}
