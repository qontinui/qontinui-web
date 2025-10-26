/**
 * AutomationBuilder - Unified Builder Component
 *
 * Single builder component that handles both sequential processes and graph workflows.
 * Features:
 * - Mode switching (Sequential <-> Graph)
 * - Unified library panel
 * - Automatic format detection
 * - Format conversion support
 * - Three-panel layout (Library | Editor | Properties)
 */

'use client'

import React, { useState, useCallback, useMemo, useEffect } from 'react'
import { UnifiedProcessLibrary } from '@/components/unified-process-library'
import { ActionProperties } from '@/components/action-properties'
import { useAutomation } from '@/contexts/automation-context'
import { toast } from 'sonner'
import type { Workflow, Action, ActionType } from '@/lib/action-schema/action-types'

// Import our new components
import {
  BuilderMode,
  LibraryItem,
  getSuggestedMode,
  isLinearWorkflow,
  useItemManagement,
  useModeDetection,
  useFormatConversion,
  EmptyState,
  SequentialEditor,
  GraphEditor,
  BuilderModeSelector,
  ItemMetadataPanel,
  EditorToolbar,
} from './index'

export function AutomationBuilder() {
  // State
  const [mode, setMode] = useState<BuilderMode>('sequential')
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null)
  const [selectedAction, setSelectedAction] = useState<Action | null>(null)

  // Context
  const { addWorkflow, updateWorkflow, deleteWorkflow } = useAutomation()

  // Hooks
  const { allItems, createProcess, createWorkflow, updateItem, deleteItem } = useItemManagement()
  const { handleItemSelection } = useModeDetection({
    currentMode: mode,
    autoSwitch: true,
    onModeChange: setMode,
  })
  const { openConversion, ConversionDialog } = useFormatConversion({
    onModeChange: setMode,
  })

  /**
   * Handle item selection from library
   */
  const handleSelectItem = useCallback(
    (item: LibraryItem) => {
      // Check if item is compatible with current mode, auto-switch if needed
      const canProceed = handleItemSelection(item)
      if (canProceed) {
        setSelectedItem(item)
        setSelectedAction(null)
      }
    },
    [handleItemSelection]
  )

  /**
   * Handle creating a new sequential workflow
   */
  const handleCreateSequential = useCallback(
    (category: string = 'Main') => {
      const newWorkflow = createWorkflow({ viewMode: 'sequential', category })
      setSelectedItem(newWorkflow)
      setSelectedAction(null)
      setMode('sequential')
    },
    [createWorkflow]
  )

  /**
   * Handle creating a new graph workflow
   */
  const handleCreateGraph = useCallback(
    (category: string = 'Main') => {
      const newWorkflow = createWorkflow({ viewMode: 'graph', category })
      setSelectedItem(newWorkflow)
      setSelectedAction(null)
      setMode('graph')
    },
    [createWorkflow]
  )

  /**
   * Handle updating the current item
   */
  const handleUpdateItem = useCallback(
    (item: LibraryItem) => {
      updateItem(item)
      setSelectedItem(item)
    },
    [updateItem]
  )

  /**
   * Handle deleting an item
   * Note: Confirmation dialog is shown in UnifiedProcessLibrary
   */
  const handleDeleteItem = useCallback(
    (item: LibraryItem) => {
      deleteItem(item)

      // Clear selection if this was the selected item
      if (selectedItem?.id === item.id) {
        setSelectedItem(null)
        setSelectedAction(null)
      }
    },
    [deleteItem, selectedItem]
  )

  /**
   * Handle duplicating an item
   */
  const handleDuplicateItem = useCallback(() => {
    if (!selectedItem) return

    const isLinear = isLinearWorkflow(selectedItem)
    const duplicated: Workflow = {
      ...selectedItem,
      id: `workflow-${Date.now()}`,
      name: `${selectedItem.name} (Copy)`,
      metadata: {
        ...selectedItem.metadata,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    }

    addWorkflow(duplicated)
    setSelectedItem(duplicated)
    toast.success(`${isLinear ? 'Sequential' : 'Graph'} workflow duplicated`, {
      description: `Created "${duplicated.name}"`,
    })
  }, [selectedItem, addWorkflow])

  /**
   * Update workflow
   */
  const handleUpdateWorkflow = useCallback(
    (workflow: Workflow) => {
      updateWorkflow(workflow)
      if (selectedItem?.id === workflow.id) {
        setSelectedItem(workflow)
      }
    },
    [updateWorkflow, selectedItem]
  )

  /**
   * Handle updating actions for sequential editor
   */
  const handleUpdateActions = useCallback(
    (actions: Action[]) => {
      if (!selectedItem) return

      const updatedWorkflow = {
        ...selectedItem,
        actions,
      }
      handleUpdateWorkflow(updatedWorkflow)
    },
    [selectedItem, handleUpdateWorkflow]
  )

  /**
   * Handle selecting an action
   */
  const handleSelectAction = useCallback((action: Action | null) => {
    setSelectedAction(action)
  }, [])

  /**
   * Handle adding a node in graph mode
   */
  const handleAddNode = useCallback(
    (nodeType: ActionType) => {
      if (!selectedItem) return

      const newAction: Action = {
        id: `action-${Date.now()}`,
        type: nodeType,
        config: {},
        position: [100, 100], // Auto-position
      }

      const updatedWorkflow = {
        ...selectedItem,
        actions: [...selectedItem.actions, newAction],
      }

      handleUpdateWorkflow(updatedWorkflow)
    },
    [selectedItem, handleUpdateWorkflow]
  )

  /**
   * Handle updating an action from the properties panel
   */
  const handleUpdateAction = useCallback(
    (updatedAction: Action) => {
      if (!selectedItem) return

      const updatedActions = selectedItem.actions.map((a: Action) =>
        a.id === updatedAction.id ? updatedAction : a
      )

      handleUpdateActions(updatedActions)
      setSelectedAction(updatedAction)
    },
    [selectedItem, handleUpdateActions]
  )

  // Render the editor based on mode
  const renderEditor = () => {
    if (!selectedItem) {
      return <EmptyState mode={mode} onCreateNew={mode === 'sequential' ? () => handleCreateSequential() : () => handleCreateGraph()} />
    }

    if (mode === 'sequential') {
      // Sequential mode - SequentialEditor
      // Warn if workflow has branching
      if (!isLinearWorkflow(selectedItem)) {
        return (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-lg">This workflow has branching logic</p>
              <p className="text-sm">Switch to graph mode to edit</p>
            </div>
          </div>
        )
      }

      return (
        <SequentialEditor
          actions={selectedItem.actions}
          selectedAction={selectedAction}
          onSelectAction={handleSelectAction}
          onUpdateActions={handleUpdateActions}
          onAddAction={(action) => handleUpdateActions([...selectedItem.actions, action])}
          onDeleteAction={(actionId) =>
            handleUpdateActions(selectedItem.actions.filter((a: Action) => a.id !== actionId))
          }
          onDuplicateAction={(actionId) => {
            const action = selectedItem.actions.find((a: Action) => a.id === actionId)
            if (action) {
              const duplicated = { ...action, id: `action-${Date.now()}` }
              handleUpdateActions([...selectedItem.actions, duplicated])
            }
          }}
          onReorderActions={(startIndex, endIndex) => {
            const actions = [...selectedItem.actions]
            const [removed] = actions.splice(startIndex, 1)
            actions.splice(endIndex, 0, removed)
            handleUpdateActions(actions)
          }}
        />
      )
    } else {
      // Graph mode - GraphEditor (works with all workflows)
      return (
        <GraphEditor
          workflow={selectedItem}
          selectedNode={selectedAction}
          onSelectNode={handleSelectAction}
          onUpdateWorkflow={handleUpdateWorkflow}
          onAddNode={handleAddNode}
        />
      )
    }
  }

  return (
    <div className="flex h-full">
      {/* Left Panel - Library */}
      <div className="w-64 xl:w-72 2xl:w-80 flex-shrink-0 border-r border-gray-800 bg-[#27272A]/50 overflow-hidden flex flex-col">
        {/* Mode Selector */}
        <div className="p-4 border-b border-gray-800">
          <BuilderModeSelector mode={mode} onModeChange={setMode} />
        </div>

        {/* Library */}
        <div className="flex-1 p-4 overflow-y-auto">
          <UnifiedProcessLibrary
            selectedItem={selectedItem}
            onSelectItem={handleSelectItem}
            onDeleteItem={handleDeleteItem}
            onUpdateWorkflow={handleUpdateWorkflow}
            onCreateSequential={handleCreateSequential}
            onCreateGraph={handleCreateGraph}
            onConvertItem={openConversion}
          />
        </div>
      </div>

      {/* Center Panel - Editor */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <EditorToolbar
          item={selectedItem}
          mode={mode}
          onDelete={() => selectedItem && handleDeleteItem(selectedItem)}
          onDuplicate={handleDuplicateItem}
          onConvert={() => selectedItem && openConversion(selectedItem)}
        />

        {/* Editor Content */}
        <div className="flex-1 overflow-y-auto">{renderEditor()}</div>
      </div>

      {/* Right Panel - Properties */}
      <div className="w-64 xl:w-72 2xl:w-80 flex-shrink-0 border-l border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto">
        {selectedItem && !selectedAction ? (
          // Show item metadata when no action is selected
          <ItemMetadataPanel item={selectedItem} onUpdate={handleUpdateItem} />
        ) : (
          // Show action properties when an action is selected
          <ActionProperties action={selectedAction} onUpdateAction={handleUpdateAction} />
        )}
      </div>

      {/* Conversion Dialog */}
      <ConversionDialog />
    </div>
  )
}
