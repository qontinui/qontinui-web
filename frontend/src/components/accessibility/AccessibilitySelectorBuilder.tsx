"use client";

import * as React from "react";
import { useState, useCallback, useEffect } from "react";
import { Search, Copy, X, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type {
  AccessibilitySelector,
  AccessibilityNode,
  AccessibilityRole,
} from "@qontinui/shared-types/accessibility";

interface AccessibilitySelectorBuilderProps {
  selector: AccessibilitySelector;
  onChange: (selector: AccessibilitySelector) => void;
  onTest: () => void;
  matchCount: number;
  selectedNode?: AccessibilityNode | null;
  availableRoles?: AccessibilityRole[];
  className?: string;
}

const COMMON_ROLES: AccessibilityRole[] = [
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "menuitem",
  "heading",
  "img",
  "navigation",
] as AccessibilityRole[];

export function AccessibilitySelectorBuilder({
  selector,
  onChange,
  onTest,
  matchCount,
  selectedNode,
  availableRoles = COMMON_ROLES,
  className,
}: AccessibilitySelectorBuilderProps) {
  const [localSelector, setLocalSelector] =
    useState<AccessibilitySelector>(selector);
  const [multiRole, setMultiRole] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<AccessibilityRole[]>(
    Array.isArray(selector.role)
      ? selector.role
      : selector.role
        ? [selector.role]
        : []
  );

  // Sync local state with props
  useEffect(() => {
    setLocalSelector(selector);
    if (Array.isArray(selector.role)) {
      setSelectedRoles(selector.role);
      setMultiRole(true);
    } else if (selector.role) {
      setSelectedRoles([selector.role]);
      setMultiRole(false);
    } else {
      setSelectedRoles([]);
      setMultiRole(false);
    }
  }, [selector]);

  // Update selector when local state changes
  const updateSelector = useCallback(
    (updates: Partial<AccessibilitySelector>) => {
      const newSelector = { ...localSelector, ...updates };
      setLocalSelector(newSelector);
      onChange(newSelector);
    },
    [localSelector, onChange]
  );

  // Handle role selection
  const handleRoleChange = useCallback(
    (role: AccessibilityRole | null) => {
      if (role === null) {
        updateSelector({ role: null });
        setSelectedRoles([]);
      } else if (multiRole) {
        const newRoles = selectedRoles.includes(role)
          ? selectedRoles.filter((r) => r !== role)
          : [...selectedRoles, role];
        setSelectedRoles(newRoles);
        updateSelector({ role: newRoles.length > 0 ? newRoles : null });
      } else {
        setSelectedRoles([role]);
        updateSelector({ role });
      }
    },
    [multiRole, selectedRoles, updateSelector]
  );

  // Populate from selected node
  const handlePopulateFromNode = useCallback(() => {
    if (!selectedNode) return;

    const newSelector: AccessibilitySelector = {
      role: selectedNode.role,
      name: selectedNode.name ?? undefined,
      is_interactive: selectedNode.is_interactive ?? undefined,
      // case_sensitive defaults to true on the Rust side (serde default);
      // after the codegen's default→required promotion it's required in TS.
      case_sensitive: true,
    };

    if (selectedNode.automation_id) {
      newSelector.automation_id = selectedNode.automation_id;
    }

    if (selectedNode.class_name) {
      newSelector.class_name = selectedNode.class_name;
    }

    setLocalSelector(newSelector);
    onChange(newSelector);
    setSelectedRoles([selectedNode.role]);
    setMultiRole(false);
    toast.success("Selector populated from selected node");
  }, [selectedNode, onChange]);

  // Copy selector as JSON
  const handleCopySelector = useCallback(() => {
    // Remove undefined/null values for cleaner JSON
    const cleanSelector = Object.fromEntries(
      Object.entries(localSelector).filter(
        ([, v]) => v !== undefined && v !== null && v !== ""
      )
    );
    void navigator.clipboard.writeText(JSON.stringify(cleanSelector, null, 2));
    toast.success("Selector copied to clipboard");
  }, [localSelector]);

  // Clear selector
  const handleClearSelector = useCallback(() => {
    const emptySelector: AccessibilitySelector = { case_sensitive: true };
    setLocalSelector(emptySelector);
    onChange(emptySelector);
    setSelectedRoles([]);
    toast.info("Selector cleared");
  }, [onChange]);

  return (
    <Card
      className={cn("w-full", className)}
      data-slot="accessibility-selector-builder"
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold">
              Selector Builder
            </CardTitle>
            <CardDescription className="text-xs">
              Build accessibility selectors for element targeting
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            {selectedNode && (
              <Button
                variant="outline"
                size="sm"
                onClick={handlePopulateFromNode}
                title="Populate from selected node"
              >
                <Plus className="h-4 w-4 mr-1" />
                From Selection
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopySelector}
              title="Copy selector JSON"
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearSelector}
              title="Clear selector"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Role selector */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Role</Label>
            <div className="flex items-center gap-2">
              <Label
                htmlFor="multi-role"
                className="text-xs text-muted-foreground"
              >
                Multiple
              </Label>
              <Switch
                id="multi-role"
                checked={multiRole}
                onCheckedChange={setMultiRole}
              />
            </div>
          </div>

          {multiRole ? (
            <div className="flex flex-wrap gap-1">
              {availableRoles.map((role) => (
                <Badge
                  key={role}
                  variant={selectedRoles.includes(role) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => handleRoleChange(role)}
                >
                  {role}
                  {selectedRoles.includes(role) && (
                    <X className="h-3 w-3 ml-1" />
                  )}
                </Badge>
              ))}
            </div>
          ) : (
            <Select
              value={selectedRoles[0] ?? ""}
              onValueChange={(value) =>
                handleRoleChange(value ? (value as AccessibilityRole) : null)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a role..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Any role</SelectItem>
                {availableRoles.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Name matching */}
        <div className="space-y-2">
          <Label className="text-sm">Name</Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Exact match
              </Label>
              <Input
                placeholder="Button text..."
                value={localSelector.name ?? ""}
                onChange={(e) =>
                  updateSelector({
                    name: e.target.value || undefined,
                    name_contains: undefined,
                    name_pattern: undefined,
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Contains</Label>
              <Input
                placeholder="Partial match..."
                value={localSelector.name_contains ?? ""}
                onChange={(e) =>
                  updateSelector({
                    name_contains: e.target.value || undefined,
                    name: undefined,
                    name_pattern: undefined,
                  })
                }
              />
            </div>
          </div>
        </div>

        {/* Value matching */}
        <div className="space-y-2">
          <Label className="text-sm">Value</Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Exact match
              </Label>
              <Input
                placeholder="Input value..."
                value={localSelector.value ?? ""}
                onChange={(e) =>
                  updateSelector({
                    value: e.target.value || undefined,
                    value_contains: undefined,
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Contains</Label>
              <Input
                placeholder="Partial match..."
                value={localSelector.value_contains ?? ""}
                onChange={(e) =>
                  updateSelector({
                    value_contains: e.target.value || undefined,
                    value: undefined,
                  })
                }
              />
            </div>
          </div>
        </div>

        {/* ID matching */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Automation ID</Label>
            <Input
              placeholder="data-testid..."
              value={localSelector.automation_id ?? ""}
              onChange={(e) =>
                updateSelector({ automation_id: e.target.value || undefined })
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Class Name</Label>
            <Input
              placeholder="CSS class..."
              value={localSelector.class_name ?? ""}
              onChange={(e) =>
                updateSelector({ class_name: e.target.value || undefined })
              }
            />
          </div>
        </div>

        {/* Flags */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="is-interactive"
              checked={localSelector.is_interactive ?? false}
              onCheckedChange={(checked) =>
                updateSelector({ is_interactive: checked || undefined })
              }
            />
            <Label htmlFor="is-interactive" className="text-sm">
              Interactive only
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="case-sensitive"
              checked={localSelector.case_sensitive ?? true}
              onCheckedChange={(checked) =>
                updateSelector({ case_sensitive: checked })
              }
            />
            <Label htmlFor="case-sensitive" className="text-sm">
              Case sensitive
            </Label>
          </div>
        </div>

        {/* Test button and match count */}
        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm" onClick={onTest}>
              <Search className="h-4 w-4 mr-1" />
              Test Selector
            </Button>
            <Badge
              variant={matchCount > 0 ? "default" : "secondary"}
              className={cn(
                matchCount > 0 && "bg-green-500 hover:bg-green-600"
              )}
            >
              {matchCount} {matchCount === 1 ? "match" : "matches"}
            </Badge>
          </div>
          {matchCount === 0 && (
            <span className="text-xs text-muted-foreground">
              No elements match this selector
            </span>
          )}
        </div>

        {/* Selector preview */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Selector JSON</Label>
          <pre className="p-2 bg-muted rounded text-xs overflow-auto max-h-24">
            {JSON.stringify(
              Object.fromEntries(
                Object.entries(localSelector).filter(
                  ([, v]) => v !== undefined && v !== null && v !== ""
                )
              ),
              null,
              2
            )}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
