'use client';

import React from 'react';
import { CheckSquare, Square, Workflow as WorkflowIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import type { WorkflowSelectorProps } from '@/types/integration-tests';

export const WorkflowSelector: React.FC<WorkflowSelectorProps> = ({
  workflows,
  selectedIds,
  onSelectionChange,
  disabled = false,
}) => {
  const handleToggleWorkflow = (workflowId: string) => {
    if (disabled) return;

    if (selectedIds.includes(workflowId)) {
      onSelectionChange(selectedIds.filter(id => id !== workflowId));
    } else {
      onSelectionChange([...selectedIds, workflowId]);
    }
  };

  const handleSelectAll = () => {
    if (disabled) return;
    onSelectionChange(workflows.map(w => w.id));
  };

  const handleSelectNone = () => {
    if (disabled) return;
    onSelectionChange([]);
  };

  const allSelected = workflows.length > 0 && selectedIds.length === workflows.length;
  const noneSelected = selectedIds.length === 0;

  return (
    <Card className="bg-white border border-gray-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <WorkflowIcon className="w-4 h-4" />
            Workflows
          </CardTitle>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSelectAll}
              disabled={disabled || allSelected}
              className="h-7 text-xs"
            >
              Select All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSelectNone}
              disabled={disabled || noneSelected}
              className="h-7 text-xs"
            >
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {workflows.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <WorkflowIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No workflows available</p>
            <p className="text-xs mt-1">Create workflows to run integration tests</p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-1">
            {workflows.map((workflow) => {
              const isSelected = selectedIds.includes(workflow.id);
              return (
                <div
                  key={workflow.id}
                  className={`flex items-center gap-3 p-2 rounded-lg border transition-colors cursor-pointer hover:bg-gray-50 ${
                    isSelected
                      ? 'bg-blue-50 border-blue-200'
                      : 'bg-white border-gray-200'
                  } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  onClick={() => handleToggleWorkflow(workflow.id)}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => handleToggleWorkflow(workflow.id)}
                    disabled={disabled}
                    className="pointer-events-none"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      )}
                      <span className="text-sm font-medium truncate">
                        {workflow.name}
                      </span>
                    </div>
                    {workflow.description && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {workflow.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400">
                        {workflow.actions?.length || 0} actions
                      </span>
                      {workflow.category && (
                        <>
                          <span className="text-xs text-gray-300">•</span>
                          <span className="text-xs text-gray-400">
                            {workflow.category}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {workflows.length > 0 && (
          <div className="pt-2 border-t mt-3">
            <div className="text-xs text-gray-500">
              {selectedIds.length} of {workflows.length} selected
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default WorkflowSelector;
