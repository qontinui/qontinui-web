/**
 * Pattern Preview Card Component
 * Shows a preview of an extracted pattern with edit/delete controls
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Trash2, Edit2, Check, X } from 'lucide-react';
import type { ExtractedPattern } from '@/types/direct-pattern-creation';

interface PatternPreviewCardProps {
  pattern: ExtractedPattern;
  index: number;
  onDelete: () => void;
  onUpdate: (updates: Partial<ExtractedPattern>) => void;
}

export function PatternPreviewCard({
  pattern,
  index,
  onDelete,
  onUpdate,
}: PatternPreviewCardProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(pattern.name);
  const [isEditingStates, setIsEditingStates] = useState(false);
  const [stateInput, setStateInput] = useState(pattern.states.join(', '));

  const handleSaveName = () => {
    if (editedName.trim()) {
      onUpdate({ name: editedName.trim() });
      setIsEditingName(false);
    }
  };

  const handleCancelName = () => {
    setEditedName(pattern.name);
    setIsEditingName(false);
  };

  const handleSaveStates = () => {
    const states = stateInput
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    onUpdate({ states });
    setIsEditingStates(false);
  };

  const handleCancelStates = () => {
    setStateInput(pattern.states.join(', '));
    setIsEditingStates(false);
  };

  const handleRemoveState = (stateToRemove: string) => {
    const newStates = pattern.states.filter(s => s !== stateToRemove);
    onUpdate({ states: newStates });
  };

  return (
    <div className="border rounded-lg p-3 mb-2 bg-white shadow-sm hover:shadow-md transition-shadow">
      {/* Header with index */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-gray-500">Pattern #{index + 1}</div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-6 w-6 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Pattern Image */}
      <div className="mb-2 bg-gray-100 rounded overflow-hidden border border-gray-200">
        <img
          src={pattern.imageData}
          alt={pattern.name}
          className="w-full h-auto max-h-32 object-contain"
        />
      </div>

      {/* Pattern Name */}
      <div className="mb-2">
        {isEditingName ? (
          <div className="flex items-center gap-1">
            <Input
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              className="text-xs h-7"
              placeholder="Pattern name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName();
                if (e.key === 'Escape') handleCancelName();
              }}
              autoFocus
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSaveName}
              className="h-7 w-7 p-0 text-green-600 hover:text-green-700"
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancelName}
              className="h-7 w-7 p-0 text-gray-600 hover:text-gray-700"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between group">
            <div className="text-sm font-medium truncate flex-1">{pattern.name}</div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditingName(true)}
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Edit2 className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Region Info */}
      <div className="text-xs text-gray-600 mb-2">
        <div>Position: ({Math.round(pattern.region.x)}, {Math.round(pattern.region.y)})</div>
        <div>Size: {Math.round(pattern.region.width)} × {Math.round(pattern.region.height)}px</div>
      </div>

      {/* States */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs font-medium text-gray-700">States</div>
          {!isEditingStates && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditingStates(true)}
              className="h-5 text-xs px-2"
            >
              <Edit2 className="h-3 w-3 mr-1" />
              Edit
            </Button>
          )}
        </div>

        {isEditingStates ? (
          <div className="space-y-2">
            <Input
              value={stateInput}
              onChange={(e) => setStateInput(e.target.value)}
              className="text-xs h-7"
              placeholder="state1, state2, state3"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveStates();
                if (e.key === 'Escape') handleCancelStates();
              }}
            />
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveStates}
                className="h-6 text-xs flex-1"
              >
                <Check className="h-3 w-3 mr-1" />
                Save
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelStates}
                className="h-6 text-xs flex-1"
              >
                <X className="h-3 w-3 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {pattern.states.length === 0 ? (
              <span className="text-xs text-gray-400 italic">No states assigned</span>
            ) : (
              pattern.states.map((state) => (
                <Badge
                  key={state}
                  variant="secondary"
                  className="text-xs px-2 py-0.5 group cursor-pointer hover:bg-red-100"
                  onClick={() => handleRemoveState(state)}
                >
                  {state}
                  <X className="h-3 w-3 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Badge>
              ))
            )}
          </div>
        )}
      </div>

      {/* Source Info */}
      <div className="text-xs text-gray-500 pt-2 border-t">
        From screenshot #{pattern.sourceScreenshotIndex + 1}
      </div>
    </div>
  );
}
