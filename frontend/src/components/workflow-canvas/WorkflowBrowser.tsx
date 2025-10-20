/**
 * Workflow Browser Component
 *
 * Browse and manage workflows:
 * - List recent workflows
 * - Search workflows
 * - Filter by tags/category
 * - Thumbnail previews (placeholder)
 * - Quick actions (open, duplicate, delete)
 * - Sort by date/name/usage
 * - Folder organization (future)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Workflow } from '../../lib/action-schema/action-types';
import { workflowFileManager, LoadResult } from '../../services/workflow-file-manager';
import { workflowSnapshots } from '../../services/workflow-snapshots';
import { cloneWorkflow } from '../../lib/action-schema/workflow-utils';

// ============================================================================
// Types
// ============================================================================

interface WorkflowListItem {
  key: string;
  workflow: Workflow;
  lastModified?: Date;
  snapshotCount: number;
}

type SortBy = 'date' | 'name' | 'actions';
type SortOrder = 'asc' | 'desc';

interface WorkflowBrowserProps {
  onOpen: (workflow: Workflow) => void;
  onClose: () => void;
  open: boolean;
}

// ============================================================================
// Workflow Browser
// ============================================================================

export function WorkflowBrowser({ onOpen, onClose, open }: WorkflowBrowserProps) {
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [loading, setLoading] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Load workflows
  const loadWorkflows = useCallback(async () => {
    setLoading(true);

    try {
      const keys = workflowFileManager.listWorkflows();
      const items: WorkflowListItem[] = [];

      for (const key of keys) {
        const result = await workflowFileManager.loadWorkflowFromStorage(key);
        if (result.success && result.workflow) {
          const snapshotCount = workflowSnapshots.getSnapshotCount(result.workflow.id);

          items.push({
            key,
            workflow: result.workflow,
            lastModified: result.workflow.metadata?.updated
              ? new Date(result.workflow.metadata.updated)
              : undefined,
            snapshotCount,
          });
        }
      }

      setWorkflows(items);
    } catch (error) {
      console.error('Failed to load workflows:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadWorkflows();
    }
  }, [open, loadWorkflows]);

  // Filter workflows
  const filteredWorkflows = workflows.filter((item) => {
    // Search filter
    if (searchQuery) {
      const search = searchQuery.toLowerCase();
      const matchesName = item.workflow.name.toLowerCase().includes(search);
      const matchesDescription =
        item.workflow.metadata?.description?.toLowerCase().includes(search);
      const matchesTags = item.workflow.tags?.some((tag) =>
        tag.toLowerCase().includes(search)
      );

      if (!matchesName && !matchesDescription && !matchesTags) {
        return false;
      }
    }

    // Tag filter
    if (selectedTags.length > 0) {
      const hasTag = selectedTags.some((tag) => item.workflow.tags?.includes(tag));
      if (!hasTag) {
        return false;
      }
    }

    return true;
  });

  // Sort workflows
  const sortedWorkflows = [...filteredWorkflows].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'date':
        const dateA = a.lastModified?.getTime() || 0;
        const dateB = b.lastModified?.getTime() || 0;
        comparison = dateA - dateB;
        break;
      case 'name':
        comparison = a.workflow.name.localeCompare(b.workflow.name);
        break;
      case 'actions':
        comparison = a.workflow.actions.length - b.workflow.actions.length;
        break;
    }

    return sortOrder === 'asc' ? comparison : -comparison;
  });

  // Get all tags
  const allTags = Array.from(
    new Set(workflows.flatMap((item) => item.workflow.tags || []))
  );

  // Handlers
  const handleOpenWorkflow = useCallback(
    (item: WorkflowListItem) => {
      onOpen(item.workflow);
      onClose();
    },
    [onOpen, onClose]
  );

  const handleDuplicateWorkflow = useCallback(
    async (item: WorkflowListItem) => {
      const duplicated = cloneWorkflow(item.workflow);
      duplicated.name = `${item.workflow.name} (Copy)`;
      await workflowFileManager.saveWorkflow(duplicated);
      loadWorkflows();
    },
    [loadWorkflows]
  );

  const handleDeleteWorkflow = useCallback(
    async (item: WorkflowListItem) => {
      if (confirm(`Delete workflow "${item.workflow.name}"?`)) {
        await workflowFileManager.deleteWorkflow(item.key);
        loadWorkflows();
      }
    },
    [loadWorkflows]
  );

  const handleToggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const handleToggleSort = useCallback((newSortBy: SortBy) => {
    setSortBy((prevSortBy) => {
      if (prevSortBy === newSortBy) {
        setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortOrder('desc');
      }
      return newSortBy;
    });
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">Browse Workflows</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl"
            >
              ×
            </button>
          </div>

          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search workflows..."
            className="w-full border border-gray-300 rounded-md px-3 py-2 mb-4"
          />

          {/* Tags Filter */}
          {allTags.length > 0 && (
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">Filter by tags:</p>
              <div className="flex flex-wrap gap-2">
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => handleToggleTag(tag)}
                    className={`text-sm px-3 py-1 rounded-full ${selectedTags.includes(tag) ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sort Controls */}
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-600">Sort by:</span>
            <button
              onClick={() => handleToggleSort('date')}
              className={`text-sm px-3 py-1 rounded ${sortBy === 'date' ? 'bg-blue-100 text-blue-800' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              Date {sortBy === 'date' && (sortOrder === 'asc' ? '↑' : '↓')}
            </button>
            <button
              onClick={() => handleToggleSort('name')}
              className={`text-sm px-3 py-1 rounded ${sortBy === 'name' ? 'bg-blue-100 text-blue-800' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              Name {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
            </button>
            <button
              onClick={() => handleToggleSort('actions')}
              className={`text-sm px-3 py-1 rounded ${sortBy === 'actions' ? 'bg-blue-100 text-blue-800' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              Actions {sortBy === 'actions' && (sortOrder === 'asc' ? '↑' : '↓')}
            </button>
          </div>
        </div>

        {/* Workflow List */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Loading workflows...</p>
            </div>
          ) : sortedWorkflows.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No workflows found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedWorkflows.map((item) => (
                <WorkflowCard
                  key={item.key}
                  item={item}
                  onOpen={() => handleOpenWorkflow(item)}
                  onDuplicate={() => handleDuplicateWorkflow(item)}
                  onDelete={() => handleDeleteWorkflow(item)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t flex items-center justify-between">
          <p className="text-sm text-gray-600">
            {sortedWorkflows.length} workflow{sortedWorkflows.length !== 1 ? 's' : ''}
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Workflow Card Component
// ============================================================================

interface WorkflowCardProps {
  item: WorkflowListItem;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function WorkflowCard({ item, onOpen, onDuplicate, onDelete }: WorkflowCardProps) {
  const [showActions, setShowActions] = useState(false);

  return (
    <div
      className="border border-gray-200 rounded-lg p-4 hover:border-blue-500 hover:shadow-md transition cursor-pointer"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {/* Name and Version */}
          <div className="flex items-center space-x-2 mb-2">
            <h3 className="font-semibold text-lg">{item.workflow.name}</h3>
            <span className="text-xs text-gray-500">{item.workflow.version}</span>
          </div>

          {/* Description */}
          {item.workflow.metadata?.description && (
            <p className="text-sm text-gray-600 mb-3 line-clamp-2">
              {item.workflow.metadata.description}
            </p>
          )}

          {/* Stats */}
          <div className="flex items-center space-x-4 text-sm text-gray-500 mb-2">
            <span>{item.workflow.actions.length} actions</span>
            <span>
              {Object.keys(item.workflow.connections || {}).length} connections
            </span>
            {item.snapshotCount > 0 && <span>{item.snapshotCount} snapshots</span>}
          </div>

          {/* Tags */}
          {item.workflow.tags && item.workflow.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {item.workflow.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Last Modified */}
          {item.lastModified && (
            <p className="text-xs text-gray-400">
              Last modified: {item.lastModified.toLocaleDateString()}{' '}
              {item.lastModified.toLocaleTimeString()}
            </p>
          )}
        </div>

        {/* Actions */}
        {showActions && (
          <div className="flex flex-col space-y-2 ml-4">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Open
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              Duplicate
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
