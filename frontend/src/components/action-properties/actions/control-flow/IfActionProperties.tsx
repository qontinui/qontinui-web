"use client"

import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Plus, X, GitBranch } from "lucide-react"
import { ActionPropertiesComponentProps } from "../../types"
import { TimingProperties } from "../../TimingProperties"
import { ConditionEditor, ActionListEditor } from "../../shared"
import { IfActionConfig } from "@/lib/action-schema"

/**
 * Properties component for IF action.
 *
 * Allows users to:
 * - Define a condition to evaluate
 * - Specify actions to execute if condition is true (then-actions)
 * - Optionally specify actions to execute if condition is false (else-actions)
 * - Visual branch representation
 */
export function IfActionProperties({
  action,
  updateConfig,
  images,
}: ActionPropertiesComponentProps) {
  const config = action.config as IfActionConfig

  // Initialize config with defaults if needed
  const condition = config.condition || {
    type: 'variable',
    variableName: '',
    operator: '==',
    expectedValue: '',
  }
  const thenActions = config.thenActions || []
  const elseActions = config.elseActions || []

  const handleConditionChange = (newCondition: IfActionConfig['condition'] | undefined) => {
    updateConfig("condition", newCondition)
  }

  const handleThenActionsChange = (actions: string[]) => {
    updateConfig("thenActions", actions)
  }

  const handleElseActionsChange = (actions: string[]) => {
    updateConfig("elseActions", actions)
  }

  const handleAddElseBranch = () => {
    updateConfig("elseActions", [])
  }

  const handleRemoveElseBranch = () => {
    updateConfig("elseActions", undefined)
  }

  return (
    <>
      {/* Visual Branch Indicator */}
      <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-md">
        <GitBranch className="w-4 h-4 text-blue-400" />
        <div className="flex-1">
          <p className="text-sm font-medium text-blue-300">Conditional Branch</p>
          <p className="text-xs text-blue-400/70">
            Execute different actions based on a condition
          </p>
        </div>
      </div>

      {/* Condition Builder */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-400">Condition</Label>
        <div className="p-3 bg-gray-800/50 rounded-md border border-gray-700">
          <ConditionEditor
            condition={condition}
            onChange={handleConditionChange}
            label=""
            allowEmpty={false}
            images={images}
          />
        </div>
        <p className="text-xs text-gray-500">
          Define the condition that determines which branch to execute
        </p>
      </div>

      {/* Then Actions (True Branch) */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-1 h-4 bg-green-500 rounded" />
          <Label className="text-xs text-green-400">Then Actions (when true)</Label>
        </div>
        <div className="pl-3 border-l-2 border-green-500/30">
          <ActionListEditor
            actionIds={thenActions}
            onChange={handleThenActionsChange}
            emptyText="Add actions to execute when condition is true"
            minActions={0}
          />
        </div>
        <p className="text-xs text-gray-500">
          Actions to execute when the condition evaluates to true
        </p>
      </div>

      {/* Else Actions (False Branch) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-red-500 rounded" />
            <Label className="text-xs text-red-400">Else Actions (when false)</Label>
          </div>
          {config.elseActions === undefined ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-[#00D9FF] hover:text-[#00D9FF]/80 hover:bg-[#00D9FF]/10"
              onClick={handleAddElseBranch}
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Else Branch
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-gray-500 hover:text-red-400"
              onClick={handleRemoveElseBranch}
              title="Remove else branch"
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>

        {config.elseActions !== undefined && (
          <>
            <div className="pl-3 border-l-2 border-red-500/30">
              <ActionListEditor
                actionIds={elseActions}
                onChange={handleElseActionsChange}
                emptyText="Add actions to execute when condition is false"
                minActions={0}
              />
            </div>
            <p className="text-xs text-gray-500">
              Actions to execute when the condition evaluates to false
            </p>
          </>
        )}

        {config.elseActions === undefined && (
          <p className="text-xs text-gray-500">
            No else branch defined. If the condition is false, execution will continue to the next action.
          </p>
        )}
      </div>

      {/* Usage Tips */}
      <div className="p-3 bg-gray-800/30 border border-gray-700 rounded-md">
        <p className="text-xs text-gray-400 font-medium mb-2">Tips:</p>
        <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
          <li>Use action IDs from your workflow to reference actions</li>
          <li>Then-actions execute when condition is true</li>
          <li>Else-actions are optional and execute when condition is false</li>
          <li>Actions can be other IF statements for nested conditions</li>
        </ul>
      </div>

      {/* Timing Properties */}
      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  )
}
