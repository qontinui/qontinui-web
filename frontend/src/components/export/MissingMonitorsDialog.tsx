/**
 * MissingMonitorsDialog Component
 *
 * Displays validation errors for state elements missing monitor assignments.
 * Allows users to fix monitor associations before exporting configuration.
 */

"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MonitorSelector } from "@/components/monitor-selector";
import {
  AlertTriangle,
  Image,
  Square,
  MapPin,
  Type,
  Monitor,
  CheckSquare,
  XSquare,
} from "lucide-react";
import { toast } from "sonner";
import {
  getErrorDescription,
  groupErrorsByType,
  type MonitorValidationError,
} from "@/lib/monitor-validation";

export interface MissingMonitorsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  errors: MonitorValidationError[];
  onApply: (updates: MonitorUpdate[]) => void;
}

export interface MonitorUpdate {
  stateId: string;
  elementType: "image" | "region" | "location" | "string";
  elementId: string;
  monitors: number[];
}

export function MissingMonitorsDialog({
  open,
  onOpenChange,
  errors,
  onApply,
}: MissingMonitorsDialogProps) {
  const [selectedErrors, setSelectedErrors] = useState<Set<string>>(new Set());
  const [monitors, setMonitors] = useState<number[]>([0]);
  const [activeTab, setActiveTab] = useState<
    "image" | "region" | "location" | "string"
  >("image");

  // Group errors by type
  const errorsByType = useMemo(() => groupErrorsByType(errors), [errors]);

  // Create unique key for each error
  const getErrorKey = useCallback((error: MonitorValidationError) => {
    return `${error.stateId}:${error.elementType}:${error.elementId}`;
  }, []);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setSelectedErrors(new Set());
      setMonitors([0]);
      // Set active tab to first type with errors
      if (errorsByType.image.length > 0) setActiveTab("image");
      else if (errorsByType.region.length > 0) setActiveTab("region");
      else if (errorsByType.location.length > 0) setActiveTab("location");
      else if (errorsByType.string.length > 0) setActiveTab("string");
    }
  }, [open, errorsByType]);

  const handleSelectAll = useCallback(
    (type: "image" | "region" | "location" | "string") => {
      const typeErrors = errorsByType[type];
      setSelectedErrors((prev) => {
        const next = new Set(prev);
        typeErrors.forEach((error) => {
          next.add(getErrorKey(error));
        });
        return next;
      });
    },
    [errorsByType, getErrorKey]
  );

  const handleSelectNone = useCallback(
    (type: "image" | "region" | "location" | "string") => {
      const typeErrors = errorsByType[type];
      setSelectedErrors((prev) => {
        const next = new Set(prev);
        typeErrors.forEach((error) => {
          next.delete(getErrorKey(error));
        });
        return next;
      });
    },
    [errorsByType, getErrorKey]
  );

  const handleToggleError = useCallback(
    (error: MonitorValidationError) => {
      const key = getErrorKey(error);
      setSelectedErrors((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    },
    [getErrorKey]
  );

  const handleApply = useCallback(() => {
    if (selectedErrors.size === 0) {
      toast.error("Please select at least one element to update");
      return;
    }

    if (monitors.length === 0) {
      toast.error("Please select at least one monitor");
      return;
    }

    // Build updates from selected errors
    const updates: MonitorUpdate[] = [];
    errors.forEach((error) => {
      const key = getErrorKey(error);
      if (selectedErrors.has(key)) {
        updates.push({
          stateId: error.stateId,
          elementType: error.elementType,
          elementId: error.elementId,
          monitors,
        });
      }
    });

    onApply(updates);
    toast.success(`Applied monitors to ${updates.length} element(s)`, {
      description: `Monitors: ${monitors.map((m) => (m === 0 ? "Primary" : m === 1 ? "Left" : m === 2 ? "Right" : `Monitor ${m}`)).join(", ")}`,
    });
    onOpenChange(false);
  }, [selectedErrors, monitors, errors, getErrorKey, onApply, onOpenChange]);

  // Get icon for element type
  const getElementIcon = (type: "image" | "region" | "location" | "string") => {
    switch (type) {
      case "image":
        // eslint-disable-next-line jsx-a11y/alt-text -- This is a Lucide icon component, not an img element
        return <Image className="w-4 h-4" />;
      case "region":
        return <Square className="w-4 h-4" />;
      case "location":
        return <MapPin className="w-4 h-4" />;
      case "string":
        return <Type className="w-4 h-4" />;
    }
  };

  // Render error list for a specific type
  const errorList = (type: "image" | "region" | "location" | "string") => {
    const typeErrors = errorsByType[type];

    if (typeErrors.length === 0) {
      return (
        <div className="flex items-center justify-center h-40 text-text-muted">
          <div className="text-center">
            <CheckSquare className="w-12 h-12 mx-auto mb-3 opacity-50 text-green-500" />
            <p>All {type}s have monitors assigned</p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Selection Controls */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">
            {typeErrors.length} {type}(s) need monitor assignment
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSelectAll(type)}
              className="h-7 text-xs"
            >
              <CheckSquare className="w-3 h-3 mr-1" />
              Select All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSelectNone(type)}
              className="h-7 text-xs"
            >
              <XSquare className="w-3 h-3 mr-1" />
              Select None
            </Button>
          </div>
        </div>

        {/* Error List */}
        <ScrollArea className="h-[300px] border border-border-subtle rounded-lg">
          <div className="p-2 space-y-1">
            {typeErrors.map((error) => {
              const errorKey = getErrorKey(error);
              const isSelected = selectedErrors.has(errorKey);

              return (
                <div
                  key={errorKey}
                  role="button"
                  tabIndex={0}
                  className="flex items-start gap-3 p-3 rounded-lg hover:bg-surface-canvas cursor-pointer transition-colors"
                  onClick={() => handleToggleError(error)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleToggleError(error);
                    }
                  }}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => handleToggleError(error)}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {getElementIcon(error.elementType)}
                      <span className="text-sm font-medium text-text-secondary truncate">
                        {error.elementName}
                      </span>
                      {error.error === "invalid" && (
                        <Badge variant="destructive" className="text-xs">
                          Invalid
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-text-muted mb-1">
                      State: {error.stateName}
                    </div>
                    <div className="text-xs text-amber-400">
                      {getErrorDescription(error)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    );
  };

  // Calculate total counts
  const totalErrors = errors.length;
  const selectedCount = selectedErrors.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] bg-surface-canvas border-border-subtle">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Monitor Assignment Required
          </DialogTitle>
          <DialogDescription>
            {totalErrors} element(s) need monitor assignments before export.
            Select elements and assign monitors to continue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Monitor Selection */}
          <div className="bg-surface-canvas rounded-lg p-4 space-y-2">
            <p className="text-sm font-medium">Assign Monitors</p>
            <p className="text-xs text-text-muted mb-2">
              Select which monitors to apply to the selected elements
            </p>
            <MonitorSelector
              monitors={monitors}
              onChange={setMonitors}
              maxMonitors={4}
              showLabel={false}
            />
            {activeTab === "region" || activeTab === "location" ? (
              <p className="text-xs text-amber-400 flex items-center gap-1 mt-2">
                <AlertTriangle className="w-3 h-3" />
                <span>
                  Regions and Locations require specific monitors (cannot use
                  &quot;All Monitors&quot;)
                </span>
              </p>
            ) : null}
          </div>

          <Separator className="bg-border-subtle" />

          {/* Tabbed Error Lists */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as typeof activeTab)}
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="image" className="flex items-center gap-1">
                {/* eslint-disable-next-line jsx-a11y/alt-text -- This is a Lucide icon component, not an img element */}
                <Image className="w-3 h-3" />
                Images ({errorsByType.image.length})
              </TabsTrigger>
              <TabsTrigger value="region" className="flex items-center gap-1">
                <Square className="w-3 h-3" />
                Regions ({errorsByType.region.length})
              </TabsTrigger>
              <TabsTrigger value="location" className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                Locations ({errorsByType.location.length})
              </TabsTrigger>
              <TabsTrigger value="string" className="flex items-center gap-1">
                <Type className="w-3 h-3" />
                Strings ({errorsByType.string.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="image" className="mt-4">
              {errorList("image")}
            </TabsContent>

            <TabsContent value="region" className="mt-4">
              {errorList("region")}
            </TabsContent>

            <TabsContent value="location" className="mt-4">
              {errorList("location")}
            </TabsContent>

            <TabsContent value="string" className="mt-4">
              {errorList("string")}
            </TabsContent>
          </Tabs>

          {/* Selection Summary */}
          {selectedCount > 0 && (
            <div className="bg-blue-950/30 border border-blue-800 rounded-lg p-3">
              <p className="text-sm text-blue-400">
                {selectedCount} element(s) selected. Monitors will be applied
                when you click Apply.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border-default"
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={selectedCount === 0 || monitors.length === 0}
            className="bg-brand-primary hover:bg-brand-primary/80 text-black"
          >
            <Monitor className="w-4 h-4 mr-2" />
            Apply to {selectedCount} Element(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
