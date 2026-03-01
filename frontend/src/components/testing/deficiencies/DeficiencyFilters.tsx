"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Filter,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  Calendar,
  Tag,
  User,
} from "lucide-react";
import {
  DeficiencyFilters as Filters,
  DeficiencySeverity,
  DeficiencyType,
  DeficiencyStatus,
  SEVERITY_CONFIG,
  STATUS_CONFIG,
} from "@/types/deficiency";
import { cn } from "@/lib/utils";

interface DeficiencyFiltersProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  availableUsers?: { id: string; name: string }[];
  availableTags?: string[];
  className?: string;
}

/**
 * DeficiencyFilters - Advanced filtering for deficiencies
 *
 * Features:
 * - Search by title/description
 * - Filter by severity (multiple selection)
 * - Filter by type (multiple selection)
 * - Filter by status (multiple selection)
 * - Filter by assignee (multiple selection)
 * - Filter by tags (multiple selection)
 * - Date range filtering (from/to)
 * - Clear all filters
 * - Active filter count badge
 * - Collapsible sections
 */
const DEFAULT_AVAILABLE_USERS: { id: string; name: string }[] = [];
const DEFAULT_AVAILABLE_TAGS: string[] = [];

export function DeficiencyFilters({
  filters,
  onFiltersChange,
  availableUsers = DEFAULT_AVAILABLE_USERS,
  availableTags = DEFAULT_AVAILABLE_TAGS,
  className,
}: DeficiencyFiltersProps) {
  const [localFilters, setLocalFilters] = useState<Filters>(filters);
  const [prevFilters, setPrevFilters] = useState<Filters>(filters);
  const [severityOpen, setSeverityOpen] = useState(true);
  const [typeOpen, setTypeOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(true);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  if (filters !== prevFilters) {
    setPrevFilters(filters);
    setLocalFilters(filters);
  }

  const handleSearchChange = (search: string) => {
    const updated = { ...localFilters, search };
    setLocalFilters(updated);
    onFiltersChange(updated);
  };

  const toggleSeverity = (severity: DeficiencySeverity) => {
    const current = localFilters.severity || [];
    const updated = {
      ...localFilters,
      severity: current.includes(severity)
        ? current.filter((s) => s !== severity)
        : [...current, severity],
    };
    setLocalFilters(updated);
    onFiltersChange(updated);
  };

  const toggleType = (type: DeficiencyType) => {
    const current = localFilters.deficiency_type || [];
    const updated = {
      ...localFilters,
      deficiency_type: current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type],
    };
    setLocalFilters(updated);
    onFiltersChange(updated);
  };

  const toggleStatus = (status: DeficiencyStatus) => {
    const current = localFilters.status || [];
    const updated = {
      ...localFilters,
      status: current.includes(status)
        ? current.filter((s) => s !== status)
        : [...current, status],
    };
    setLocalFilters(updated);
    onFiltersChange(updated);
  };

  const toggleAssignee = (userId: string) => {
    const current = localFilters.assigned_to || [];
    const updated = {
      ...localFilters,
      assigned_to: current.includes(userId)
        ? current.filter((u) => u !== userId)
        : [...current, userId],
    };
    setLocalFilters(updated);
    onFiltersChange(updated);
  };

  const toggleTag = (tag: string) => {
    const current = localFilters.tags || [];
    const updated = {
      ...localFilters,
      tags: current.includes(tag)
        ? current.filter((t) => t !== tag)
        : [...current, tag],
    };
    setLocalFilters(updated);
    onFiltersChange(updated);
  };

  const handleDateChange = (field: "date_from" | "date_to", value: string) => {
    const updated = { ...localFilters, [field]: value || undefined };
    setLocalFilters(updated);
    onFiltersChange(updated);
  };

  const clearFilters = () => {
    const cleared: Filters = {};
    setLocalFilters(cleared);
    onFiltersChange(cleared);
  };

  const getActiveFilterCount = (): number => {
    let count = 0;
    if (localFilters.search) count++;
    if (localFilters.severity?.length) count += localFilters.severity.length;
    if (localFilters.deficiency_type?.length)
      count += localFilters.deficiency_type.length;
    if (localFilters.status?.length) count += localFilters.status.length;
    if (localFilters.assigned_to?.length)
      count += localFilters.assigned_to.length;
    if (localFilters.tags?.length) count += localFilters.tags.length;
    if (localFilters.date_from) count++;
    if (localFilters.date_to) count++;
    return count;
  };

  const activeCount = getActiveFilterCount();

  return (
    <Card
      className={cn("w-full", className)}
      data-ui-id="testing-deficiency-filters"
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filters
              {activeCount > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {activeCount}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>Filter and search deficiencies</CardDescription>
          </div>
          {activeCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearFilters}
              data-ui-id="testing-deficiency-filters-clear-btn"
            >
              <X className="h-4 w-4 mr-2" />
              Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="space-y-2">
          <Label htmlFor="search" className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            Search
          </Label>
          <Input
            id="search"
            placeholder="Search title, description..."
            value={localFilters.search || ""}
            onChange={(e) => handleSearchChange(e.target.value)}
            data-ui-id="testing-deficiency-filters-search-input"
          />
        </div>

        <Separator />

        {/* Severity */}
        <Collapsible open={severityOpen} onOpenChange={setSeverityOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full">
            <Label className="cursor-pointer">Severity</Label>
            {severityOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 mt-2">
            {Object.values(DeficiencySeverity).map((severity) => {
              const config = SEVERITY_CONFIG[severity];
              return (
                <div key={severity} className="flex items-center gap-2">
                  <Checkbox
                    id={`severity-${severity}`}
                    checked={localFilters.severity?.includes(severity) || false}
                    onCheckedChange={() => toggleSeverity(severity)}
                  />
                  <Label
                    htmlFor={`severity-${severity}`}
                    className="flex-1 cursor-pointer"
                  >
                    <Badge
                      className={cn(
                        "text-xs",
                        config.bgColor,
                        config.color,
                        "border"
                      )}
                    >
                      {config.label}
                    </Badge>
                  </Label>
                </div>
              );
            })}
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Type */}
        <Collapsible open={typeOpen} onOpenChange={setTypeOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full">
            <Label className="cursor-pointer">Type</Label>
            {typeOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 mt-2">
            {Object.values(DeficiencyType).map((type) => (
              <div key={type} className="flex items-center gap-2">
                <Checkbox
                  id={`type-${type}`}
                  checked={
                    localFilters.deficiency_type?.includes(type) || false
                  }
                  onCheckedChange={() => toggleType(type)}
                />
                <Label
                  htmlFor={`type-${type}`}
                  className="flex-1 cursor-pointer capitalize"
                >
                  {type.replace(/_/g, " ")}
                </Label>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Status */}
        <Collapsible open={statusOpen} onOpenChange={setStatusOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full">
            <Label className="cursor-pointer">Status</Label>
            {statusOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 mt-2">
            {Object.values(DeficiencyStatus).map((status) => {
              const config = STATUS_CONFIG[status];
              return (
                <div key={status} className="flex items-center gap-2">
                  <Checkbox
                    id={`status-${status}`}
                    checked={localFilters.status?.includes(status) || false}
                    onCheckedChange={() => toggleStatus(status)}
                  />
                  <Label
                    htmlFor={`status-${status}`}
                    className="flex-1 cursor-pointer"
                  >
                    <Badge
                      className={cn(
                        "text-xs",
                        config.bgColor,
                        config.color,
                        "border"
                      )}
                    >
                      {config.label}
                    </Badge>
                  </Label>
                </div>
              );
            })}
          </CollapsibleContent>
        </Collapsible>

        {/* Assignee */}
        {availableUsers.length > 0 && (
          <>
            <Separator />
            <Collapsible open={assigneeOpen} onOpenChange={setAssigneeOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full">
                <Label className="flex items-center gap-2 cursor-pointer">
                  <User className="h-4 w-4" />
                  Assignee
                </Label>
                {assigneeOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 mt-2">
                {availableUsers.map((user) => (
                  <div key={user.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`user-${user.id}`}
                      checked={
                        localFilters.assigned_to?.includes(user.id) || false
                      }
                      onCheckedChange={() => toggleAssignee(user.id)}
                    />
                    <Label
                      htmlFor={`user-${user.id}`}
                      className="flex-1 cursor-pointer"
                    >
                      {user.name}
                    </Label>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          </>
        )}

        {/* Tags */}
        {availableTags.length > 0 && (
          <>
            <Separator />
            <Collapsible open={tagsOpen} onOpenChange={setTagsOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full">
                <Label className="flex items-center gap-2 cursor-pointer">
                  <Tag className="h-4 w-4" />
                  Tags
                </Label>
                {tagsOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 mt-2">
                {availableTags.map((tag) => (
                  <div key={tag} className="flex items-center gap-2">
                    <Checkbox
                      id={`tag-${tag}`}
                      checked={localFilters.tags?.includes(tag) || false}
                      onCheckedChange={() => toggleTag(tag)}
                    />
                    <Label
                      htmlFor={`tag-${tag}`}
                      className="flex-1 cursor-pointer"
                    >
                      {tag}
                    </Label>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          </>
        )}

        {/* Date Range */}
        <Separator />
        <Collapsible open={dateOpen} onOpenChange={setDateOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full">
            <Label className="flex items-center gap-2 cursor-pointer">
              <Calendar className="h-4 w-4" />
              Date Range
            </Label>
            {dateOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 mt-2">
            <div className="space-y-2">
              <Label htmlFor="date-from">From</Label>
              <Input
                id="date-from"
                type="date"
                value={localFilters.date_from || ""}
                onChange={(e) => handleDateChange("date_from", e.target.value)}
                data-ui-id="testing-deficiency-filters-date-from-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date-to">To</Label>
              <Input
                id="date-to"
                type="date"
                value={localFilters.date_to || ""}
                onChange={(e) => handleDateChange("date_to", e.target.value)}
                data-ui-id="testing-deficiency-filters-date-to-input"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
