/**
 * VariableTable Component
 *
 * Displays global variables in a sortable, filterable table with
 * row actions and bulk operations support.
 */

'use client';

import React, { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MoreHorizontal,
  Edit,
  Trash2,
  Copy,
  ChevronDown,
  ChevronUp,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GlobalVariable } from '@/types/variables';
import { formatDistanceToNow } from 'date-fns';

interface VariableTableProps {
  variables: GlobalVariable[];
  onEdit: (variable: GlobalVariable) => void;
  onDelete: (name: string) => void;
  onDuplicate: (variable: GlobalVariable) => void;
  selectedVariables: string[];
  onSelectionChange: (names: string[]) => void;
  isLoading?: boolean;
}

type SortField = 'name' | 'type' | 'updated_at';
type SortDirection = 'asc' | 'desc';

export function VariableTable({
  variables,
  onEdit,
  onDelete,
  onDuplicate,
  selectedVariables,
  onSelectionChange,
  isLoading = false,
}: VariableTableProps) {
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Handle sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Sort variables
  const sortedVariables = useMemo(() => {
    const sorted = [...variables].sort((a, b) => {
      let aValue: string | number = '';
      let bValue: string | number = '';

      if (sortField === 'name') {
        aValue = a.name.toLowerCase();
        bValue = b.name.toLowerCase();
      } else if (sortField === 'type') {
        aValue = a.type;
        bValue = b.type;
      } else if (sortField === 'updated_at') {
        aValue = a.updated_at || '';
        bValue = b.updated_at || '';
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [variables, sortField, sortDirection]);

  // Handle select all
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      onSelectionChange(variables.map((v) => v.name));
    } else {
      onSelectionChange([]);
    }
  };

  // Handle individual selection
  const handleSelect = (name: string, checked: boolean) => {
    if (checked) {
      onSelectionChange([...selectedVariables, name]);
    } else {
      onSelectionChange(selectedVariables.filter((n) => n !== name));
    }
  };

  // Toggle row expansion
  const toggleRowExpansion = (name: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(name)) {
      newExpanded.delete(name);
    } else {
      newExpanded.add(name);
    }
    setExpandedRows(newExpanded);
  };

  // Render sort icon
  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <ChevronUp className="inline ml-1 h-4 w-4" />
    ) : (
      <ChevronDown className="inline ml-1 h-4 w-4" />
    );
  };

  // Get type badge color
  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'string':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'number':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'boolean':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'object':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'array':
        return 'bg-pink-500/20 text-pink-400 border-pink-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  // Format value for preview
  const formatValuePreview = (value: unknown): string => {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    const str = JSON.stringify(value);
    return str.length > 50 ? str.substring(0, 50) + '...' : str;
  };

  // Empty state
  if (!isLoading && variables.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-gray-100 dark:bg-gray-800 p-6 mb-4">
          <svg
            className="h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold mb-2">No variables yet</h3>
        <p className="text-muted-foreground max-w-sm">
          Create your first global variable to share data across all workflows in this
          project.
        </p>
      </div>
    );
  }

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 animate-pulse rounded" />
        ))}
      </div>
    );
  }

  const allSelected = variables.length > 0 && selectedVariables.length === variables.length;
  const someSelected = selectedVariables.length > 0 && selectedVariables.length < variables.length;

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">
              <Checkbox
                checked={allSelected}
                onCheckedChange={handleSelectAll}
                aria-label="Select all"
                className={cn(someSelected && 'data-[state=checked]:bg-gray-500')}
              />
            </TableHead>
            <TableHead className="w-12"></TableHead>
            <TableHead
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => handleSort('name')}
            >
              Name {renderSortIcon('name')}
            </TableHead>
            <TableHead
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => handleSort('type')}
            >
              Type {renderSortIcon('type')}
            </TableHead>
            <TableHead>Value</TableHead>
            <TableHead
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => handleSort('updated_at')}
            >
              Last Updated {renderSortIcon('updated_at')}
            </TableHead>
            <TableHead className="w-12"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedVariables.map((variable) => {
            const isExpanded = expandedRows.has(variable.name);
            const isSelected = selectedVariables.includes(variable.name);

            return (
              <React.Fragment key={variable.name}>
                <TableRow className={cn(isSelected && 'bg-muted/50')}>
                  <TableCell>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) =>
                        handleSelect(variable.name, checked as boolean)
                      }
                      aria-label={`Select ${variable.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => toggleRowExpansion(variable.name)}
                    >
                      <ChevronRight
                        className={cn(
                          'h-4 w-4 transition-transform',
                          isExpanded && 'rotate-90'
                        )}
                      />
                    </Button>
                  </TableCell>
                  <TableCell className="font-mono font-medium">{variable.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn('border', getTypeBadgeColor(variable.type))}>
                      {variable.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground max-w-md truncate">
                    {formatValuePreview(variable.value)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {variable.updated_at
                      ? formatDistanceToNow(new Date(variable.updated_at), {
                          addSuffix: true,
                        })
                      : '-'}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(variable)}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onDuplicate(variable)}>
                          <Copy className="mr-2 h-4 w-4" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onDelete(variable.name)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow>
                    <TableCell colSpan={7} className="bg-muted/30">
                      <div className="py-4 px-6 space-y-3">
                        {variable.description && (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground mb-1">
                              Description
                            </div>
                            <div className="text-sm">{variable.description}</div>
                          </div>
                        )}
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground mb-1">
                            Full Value
                          </div>
                          <pre className="text-xs bg-gray-900 text-gray-100 p-3 rounded overflow-x-auto">
                            {JSON.stringify(variable.value, null, 2)}
                          </pre>
                        </div>
                        {variable.created_at && (
                          <div className="text-xs text-muted-foreground">
                            Created{' '}
                            {formatDistanceToNow(new Date(variable.created_at), {
                              addSuffix: true,
                            })}
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
