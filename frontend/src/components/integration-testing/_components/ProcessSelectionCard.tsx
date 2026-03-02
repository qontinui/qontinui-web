"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Layers, AlertCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Process {
  id: string;
  name: string;
  description?: string;
  category?: string;
  actions?: unknown[];
  initialStateIds?: string[];
}

interface ProcessSelectionCardProps {
  selectedCategory: string;
  selectedProcessId: string;
  processesByCategory: Map<string, Process[]>;
  categoryProcesses: Process[];
  selectedProcess: Process | undefined;
  onCategoryChange: (value: string) => void;
  onProcessChange: (value: string) => void;
  isExecuting: boolean;
}

export function ProcessSelectionCard({
  selectedCategory,
  selectedProcessId,
  processesByCategory,
  categoryProcesses,
  selectedProcess,
  onCategoryChange,
  onProcessChange,
  isExecuting,
}: ProcessSelectionCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Layers className="w-4 h-4" />
          Process Selection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Category</Label>
          <Select
            value={selectedCategory || "all"}
            onValueChange={onCategoryChange}
            disabled={isExecuting}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {Array.from(processesByCategory.keys()).map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Process</Label>
          <Select
            value={selectedProcessId}
            onValueChange={onProcessChange}
            disabled={isExecuting}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a process" />
            </SelectTrigger>
            <SelectContent>
              {categoryProcesses.map((proc) => {
                const actionCount = proc.actions ? proc.actions.length : 0;
                return (
                  <SelectItem key={proc.id} value={proc.id}>
                    {proc.name} ({actionCount} actions)
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {selectedProcess && (
          <div className="p-2 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5" />
              <div className="text-xs text-blue-900">
                <div className="font-medium">{selectedProcess.name}</div>
                {selectedProcess.description && (
                  <div className="mt-1 text-blue-800">
                    {selectedProcess.description}
                  </div>
                )}
                <div className="mt-1">
                  {selectedProcess.actions?.length || 0} action(s) configured
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
