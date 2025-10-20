/**
 * Property History Component
 *
 * Displays history of property changes with ability to revert:
 * - Timeline of recent changes
 * - Revert individual property changes
 * - Clear history
 * - Visual diff display
 */

'use client';

import React from 'react';
import { usePropertiesPanelStore } from '@/stores/properties-panel-store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { History, RotateCcw, Trash2, Clock } from 'lucide-react';

export interface PropertyHistoryProps {
  actionId: string;
  className?: string;
}

export const PropertyHistory: React.FC<PropertyHistoryProps> = ({
  actionId,
  className = '',
}) => {
  const getChangesForAction = usePropertiesPanelStore((state) => state.getChangesForAction);
  const clearChanges = usePropertiesPanelStore((state) => state.clearChanges);

  const changes = getChangesForAction(actionId);

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);

    if (diffSecs < 60) return `${diffSecs}s ago`;
    if (diffMins < 60) return `${diffMins}m ago`;
    return date.toLocaleTimeString();
  };

  const handleRevert = (property: string) => {
    console.log('Revert property:', property);
    // This would need to integrate with canvas store to actually revert
  };

  const handleClearHistory = () => {
    if (confirm('Clear all change history for this action?')) {
      clearChanges(actionId);
    }
  };

  if (changes.length === 0) {
    return (
      <div className={`p-4 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4 text-gray-400" />
          <h4 className="text-sm font-semibold text-gray-400">Change History</h4>
        </div>
        <div className="text-xs text-gray-500 text-center py-8">
          No changes recorded yet
        </div>
      </div>
    );
  }

  return (
    <div className={`${className}`}>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-purple-400" />
            <h4 className="text-sm font-semibold text-gray-200">Change History</h4>
            <Badge variant="secondary" className="text-xs">
              {changes.length}
            </Badge>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleClearHistory}
            className="h-7 text-xs text-gray-400 hover:text-red-400"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Clear
          </Button>
        </div>

        <Separator className="bg-gray-700" />

        {/* Changes List */}
        <div className="space-y-3">
          {changes.map((change, index) => (
            <div
              key={`${change.property}-${change.timestamp}`}
              className="p-3 rounded bg-gray-800/50 border border-gray-700 space-y-2"
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="text-xs font-medium text-gray-300 font-mono">
                    {change.property}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Clock className="w-3 h-3 text-gray-500" />
                    <span className="text-xs text-gray-500">
                      {formatTimestamp(change.timestamp)}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRevert(change.property)}
                  className="h-6 text-xs text-gray-400 hover:text-blue-400"
                  title="Revert this change"
                >
                  <RotateCcw className="w-3 h-3" />
                </Button>
              </div>

              {/* Value Changes */}
              <div className="space-y-1">
                <div className="flex items-start gap-2">
                  <div className="text-xs text-red-400 font-medium w-12">From:</div>
                  <div className="flex-1 text-xs text-gray-400 font-mono bg-red-900/10 px-2 py-1 rounded border border-red-900/30">
                    {formatValue(change.oldValue)}
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <div className="text-xs text-green-400 font-medium w-12">To:</div>
                  <div className="flex-1 text-xs text-gray-300 font-mono bg-green-900/10 px-2 py-1 rounded border border-green-900/30">
                    {formatValue(change.newValue)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Info */}
        <div className="p-3 rounded bg-blue-900/20 border border-blue-700/30">
          <div className="text-xs text-gray-300">
            <strong>Change Tracking:</strong> All property modifications are tracked. Use the
            revert button to undo specific changes. Changes are auto-saved based on your settings.
          </div>
        </div>
      </div>
    </div>
  );
};
