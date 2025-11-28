"use client";

import React from "react";
import { State } from "@/contexts/automation-context/types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";
import { TransitionFilters as FiltersType } from "./types";

interface TransitionFiltersProps {
  filters: FiltersType;
  states: State[];
  onFiltersChange: (filters: FiltersType) => void;
}

export function TransitionFilters({
  filters,
  states,
  onFiltersChange,
}: TransitionFiltersProps) {
  return (
    <div className="grid grid-cols-4 gap-3">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search transitions..."
          value={filters.searchQuery}
          onChange={(e) =>
            onFiltersChange({ ...filters, searchQuery: e.target.value })
          }
          className="pl-8 bg-transparent border-gray-700"
        />
      </div>

      <Select
        value={filters.fromState}
        onValueChange={(value) =>
          onFiltersChange({ ...filters, fromState: value })
        }
      >
        <SelectTrigger className="bg-transparent border-gray-700">
          <SelectValue placeholder="From State" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All From States</SelectItem>
          {states.map((state) => (
            <SelectItem key={state.id} value={state.id}>
              {state.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.toState}
        onValueChange={(value) =>
          onFiltersChange({ ...filters, toState: value })
        }
      >
        <SelectTrigger className="bg-transparent border-gray-700">
          <SelectValue placeholder="To State" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All To States</SelectItem>
          {states.map((state) => (
            <SelectItem key={state.id} value={state.id}>
              {state.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.actionType}
        onValueChange={(value: any) =>
          onFiltersChange({ ...filters, actionType: value })
        }
      >
        <SelectTrigger className="bg-transparent border-gray-700">
          <SelectValue placeholder="Action Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="with_workflow">With Workflow</SelectItem>
          <SelectItem value="without_workflow">Without Workflow</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
