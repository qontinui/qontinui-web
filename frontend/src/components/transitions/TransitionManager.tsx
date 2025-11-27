"use client"

import React, { useState, useCallback } from "react"
import { useAutomation } from "@/contexts/automation-context"
import { Transition } from "@/contexts/automation-context/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Download,
  Trash2,
  List,
  Grid3x3,
  Network,
  BarChart3,
} from "lucide-react"
import { toast } from "sonner"

// Custom hooks
import { useTransitionValidation } from "./hooks/useTransitionValidation"
import { useTransitionFilters } from "./hooks/useTransitionFilters"
import { useTransitionOperations } from "./hooks/useTransitionOperations"

// Components
import { TransitionFilters } from "./TransitionFilters"
import { TransitionMatrixView } from "./TransitionMatrixView"
import { TransitionListView } from "./TransitionListView"
import { TransitionGraphView } from "./TransitionGraphView"
import { TransitionStatisticsView } from "./TransitionStatisticsView"
import { TransitionDetailsPanel } from "./TransitionDetailsPanel"
import { ValidationPanel } from "./ValidationPanel"
import { BulkCreationWizard } from "./BulkCreationWizard"

// Types
import { ViewMode, DEFAULT_FILTERS, TransitionFilters as FiltersType } from "./types"

export function TransitionManager() {
  const { states, workflows, transitions, addTransition, updateTransition, deleteTransition } =
    useAutomation()

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>("list")
  const [filters, setFilters] = useState<FiltersType>(DEFAULT_FILTERS)
  const [selectedTransitions, setSelectedTransitions] = useState<Set<string>>(new Set())
  const [selectedTransition, setSelectedTransition] = useState<Transition | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [transitionToDelete, setTransitionToDelete] = useState<string | null>(null)

  // Custom hooks for business logic
  const validation = useTransitionValidation(transitions, states)
  const filteredTransitions = useTransitionFilters(transitions, filters, states, validation)
  const operations = useTransitionOperations({
    addTransition,
    updateTransition,
    deleteTransition,
  })

  // Handlers
  const handleTransitionSelect = useCallback(
    (id: string, selected: boolean) => {
      const newSelection = new Set(selectedTransitions)
      if (selected) {
        newSelection.add(id)
      } else {
        newSelection.delete(id)
      }
      setSelectedTransitions(newSelection)
    },
    [selectedTransitions]
  )

  const handleBulkDelete = useCallback(() => {
    operations.handleBulkDelete(selectedTransitions)
    setSelectedTransitions(new Set())
  }, [selectedTransitions, operations])

  const handleMatrixCellClick = useCallback(
    (fromState: string, toState: string) => {
      const matchingTransitions = operations.findMatchingTransitions(
        transitions,
        fromState,
        toState
      )

      if (matchingTransitions.length === 1) {
        setSelectedTransition(matchingTransitions[0])
      } else if (matchingTransitions.length > 1) {
        setSelectedTransition(matchingTransitions[0])
      } else {
        toast.info("No transition exists for this cell")
      }
    },
    [transitions, operations]
  )

  const handleDeleteConfirm = useCallback(() => {
    if (transitionToDelete) {
      operations.handleDelete(transitionToDelete)
      setTransitionToDelete(null)
      setDeleteDialogOpen(false)
      setSelectedTransition(null)
    }
  }, [transitionToDelete, operations])

  const handleIssueClick = useCallback(
    (issueType: string, itemId: string) => {
      const transition = transitions.find((t) => t.id === itemId)
      if (transition) {
        setSelectedTransition(transition)
      }
    },
    [transitions]
  )

  return (
    <div className="h-screen flex flex-col bg-[#1A1A1B] text-white">
      {/* Top Toolbar */}
      <div className="flex-shrink-0 border-b border-gray-700 bg-[#27272A] p-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-[#00D9FF]">
            Transition Manager
          </h1>
          <div className="flex items-center gap-2">
            <BulkCreationWizard
              states={states}
              workflows={workflows}
              onComplete={operations.handleBulkCreate}
            />
            <Button
              variant="outline"
              onClick={() => operations.handleExport(transitions)}
              className="border-gray-700"
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            {selectedTransitions.size > 0 && (
              <Button
                variant="outline"
                onClick={handleBulkDelete}
                className="border-red-400 text-red-400 hover:bg-red-400/20"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete ({selectedTransitions.size})
              </Button>
            )}
          </div>
        </div>

        {/* Filters */}
        <TransitionFilters
          filters={filters}
          states={states}
          onFiltersChange={setFilters}
        />

        {/* View Mode Tabs */}
        <Tabs value={viewMode} onValueChange={(v: any) => setViewMode(v)} className="mt-4">
          <TabsList className="bg-[#1A1A1B]">
            <TabsTrigger value="list" className="data-[state=active]:bg-[#27272A]">
              <List className="w-4 h-4 mr-2" />
              List
            </TabsTrigger>
            <TabsTrigger value="matrix" className="data-[state=active]:bg-[#27272A]">
              <Grid3x3 className="w-4 h-4 mr-2" />
              Matrix
            </TabsTrigger>
            <TabsTrigger value="graph" className="data-[state=active]:bg-[#27272A]">
              <Network className="w-4 h-4 mr-2" />
              Graph
            </TabsTrigger>
            <TabsTrigger value="statistics" className="data-[state=active]:bg-[#27272A]">
              <BarChart3 className="w-4 h-4 mr-2" />
              Statistics
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex gap-4 p-4 overflow-hidden">
        {/* Left Panel - Transition View */}
        <div className="flex-[7] flex flex-col gap-4 overflow-hidden">
          {/* Validation Panel */}
          <ValidationPanel
            validation={validation}
            states={states}
            transitions={transitions}
            onIssueClick={handleIssueClick}
          />

          {/* Main View */}
          <Card className="flex-1 border-gray-700 bg-[#27272A] overflow-hidden">
            <CardContent className="p-4 h-full">
              {viewMode === "list" && (
                <TransitionListView
                  transitions={filteredTransitions}
                  states={states}
                  workflows={workflows}
                  validation={validation}
                  selectedTransitions={selectedTransitions}
                  onTransitionSelect={handleTransitionSelect}
                  onTransitionClick={setSelectedTransition}
                  onTransitionDelete={(id) => {
                    setTransitionToDelete(id)
                    setDeleteDialogOpen(true)
                  }}
                />
              )}

              {viewMode === "matrix" && (
                <TransitionMatrixView
                  transitions={filteredTransitions}
                  states={states}
                  validation={validation}
                  onTransitionClick={handleMatrixCellClick}
                />
              )}

              {viewMode === "graph" && (
                <TransitionGraphView
                  transitions={filteredTransitions}
                  states={states}
                  onTransitionClick={setSelectedTransition}
                />
              )}

              {viewMode === "statistics" && (
                <TransitionStatisticsView
                  transitions={filteredTransitions}
                  states={states}
                  validation={validation}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Panel - Transition Editor */}
        <div className="flex-[3] overflow-hidden">
          <TransitionDetailsPanel
            transition={selectedTransition}
            states={states}
            workflows={workflows}
            onUpdate={operations.handleUpdate}
            onDelete={(id) => {
              setTransitionToDelete(id)
              setDeleteDialogOpen(true)
            }}
            onClose={() => setSelectedTransition(null)}
          />
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-[#27272A] border-gray-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#FF4444]">
              Delete Transition
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this transition? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-700">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-400 hover:bg-red-500 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
