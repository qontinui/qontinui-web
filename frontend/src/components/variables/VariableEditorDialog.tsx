/**
 * VariableEditorDialog Component
 *
 * Modal dialog for creating and editing global variables with
 * JSON validation, type detection, and value preview.
 */

"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  GlobalVariable,
  CreateVariableRequest,
  UpdateVariableRequest,
  VariableType,
} from "@/types/variables";
import Editor from "@monaco-editor/react";

interface VariableEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (
    data: CreateVariableRequest | UpdateVariableRequest,
    originalName?: string
  ) => Promise<void>;
  variable?: GlobalVariable | null;
  existingNames?: string[];
}

type EditorMode = "simple" | "json";

export function VariableEditorDialog({
  open,
  onOpenChange,
  onSave,
  variable,
  existingNames = [],
}: VariableEditorDialogProps) {
  const isEditing = !!variable;
  const [name, setName] = useState("");
  const [valueType, setValueType] = useState<VariableType>("string");
  const [simpleValue, setSimpleValue] = useState("");
  const [jsonValue, setJsonValue] = useState("");
  const [description, setDescription] = useState("");
  const [editorMode, setEditorMode] = useState<EditorMode>("simple");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Initialize form when dialog opens or variable changes
  useEffect(() => {
    if (open) {
      if (variable) {
        setName(variable.name);
        setValueType(variable.type);
        setDescription(variable.description || "");

        // Set value based on type
        if (variable.type === "object" || variable.type === "array") {
          setEditorMode("json");
          setJsonValue(JSON.stringify(variable.value, null, 2));
        } else {
          setEditorMode("simple");
          setSimpleValue(String(variable.value));
        }
      } else {
        // Reset for new variable
        setName("");
        setValueType("string");
        setSimpleValue("");
        setJsonValue("");
        setDescription("");
        setEditorMode("simple");
      }
      setErrors({});
    }
  }, [open, variable]);

  // Validate form
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Validate name
    if (!name.trim()) {
      newErrors.name = "Name is required";
    } else if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      newErrors.name =
        "Name can only contain letters, numbers, and underscores";
    } else if (!isEditing && existingNames.includes(name)) {
      newErrors.name = "A variable with this name already exists";
    }

    // Validate value
    if (editorMode === "simple") {
      if (!simpleValue.trim() && valueType !== "boolean") {
        newErrors.value = "Value is required";
      }
    } else {
      if (!jsonValue.trim()) {
        newErrors.value = "Value is required";
      } else {
        try {
          JSON.parse(jsonValue);
        } catch (_e) {
          newErrors.value = "Invalid JSON syntax";
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Parse value based on mode and type
  const parseValue = (): unknown => {
    if (editorMode === "json") {
      return JSON.parse(jsonValue);
    }

    switch (valueType) {
      case "number":
        return Number(simpleValue);
      case "boolean":
        return simpleValue.toLowerCase() === "true";
      case "string":
      default:
        return simpleValue;
    }
  };

  // Handle save
  const handleSave = async () => {
    if (!validate()) return;

    setIsSaving(true);
    try {
      const value = parseValue();
      const data = {
        value,
        description: description.trim() || undefined,
      };

      if (isEditing) {
        await onSave(data as UpdateVariableRequest, variable.name);
      } else {
        await onSave({ name: name.trim(), ...data } as CreateVariableRequest);
      }

      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save variable:", error);
      setErrors({ submit: "Failed to save variable. Please try again." });
    } finally {
      setIsSaving(false);
    }
  };

  // Handle type change
  const handleTypeChange = (newType: VariableType) => {
    setValueType(newType);

    // Switch to JSON mode for complex types
    if (newType === "object" || newType === "array") {
      setEditorMode("json");
      if (!jsonValue) {
        setJsonValue(newType === "array" ? "[]" : "{}");
      }
    } else {
      setEditorMode("simple");
    }
  };

  // Computed value preview
  const valuePreview = useMemo(() => {
    try {
      const value = parseValue();
      return JSON.stringify(value, null, 2);
    } catch {
      return "Invalid value";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simpleValue, jsonValue, valueType, editorMode]);

  // Is JSON valid
  const isJsonValid = useMemo(() => {
    if (editorMode !== "json") return true;
    try {
      JSON.parse(jsonValue);
      return true;
    } catch {
      return false;
    }
  }, [jsonValue, editorMode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-y-auto"
        data-ui-id="dialog-variable-editor"
      >
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Variable" : "Create Variable"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the variable value and description."
              : "Create a new global variable that can be used across all workflows."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Name field (only for new variables) */}
          {!isEditing && (
            <div className="space-y-2">
              <Label htmlFor="name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my_variable"
                className={cn(errors.name && "border-destructive")}
                data-ui-id="dialog-variable-editor-name-input"
              />
              {errors.name && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.name}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Use only letters, numbers, and underscores.
              </p>
            </div>
          )}

          {/* Type selector */}
          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <Select value={valueType} onValueChange={handleTypeChange}>
              <SelectTrigger
                id="type"
                data-ui-id="dialog-variable-editor-type-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="string">String</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="boolean">Boolean</SelectItem>
                <SelectItem value="object">Object (JSON)</SelectItem>
                <SelectItem value="array">Array (JSON)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Value editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="value">
                Value <span className="text-destructive">*</span>
              </Label>
              {(valueType === "object" || valueType === "array") && (
                <Badge
                  variant={isJsonValid ? "default" : "destructive"}
                  className="text-xs"
                >
                  {isJsonValid ? (
                    <>
                      <Check className="h-3 w-3 mr-1" />
                      Valid JSON
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Invalid JSON
                    </>
                  )}
                </Badge>
              )}
            </div>

            {editorMode === "simple" ? (
              <>
                {valueType === "boolean" ? (
                  <Select value={simpleValue} onValueChange={setSimpleValue}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select value" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">true</SelectItem>
                      <SelectItem value="false">false</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="value"
                    type={valueType === "number" ? "number" : "text"}
                    value={simpleValue}
                    onChange={(e) => setSimpleValue(e.target.value)}
                    placeholder={valueType === "number" ? "42" : "Enter value"}
                    className={cn(errors.value && "border-destructive")}
                    data-ui-id="dialog-variable-editor-value-input"
                  />
                )}
              </>
            ) : (
              <div
                className={cn(
                  "border rounded-md overflow-hidden",
                  errors.value && "border-destructive"
                )}
              >
                <Editor
                  height="200px"
                  defaultLanguage="json"
                  value={jsonValue}
                  onChange={(value) => setJsonValue(value || "")}
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                  }}
                />
              </div>
            )}

            {errors.value && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {errors.value}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description of what this variable is used for"
              rows={2}
              data-ui-id="dialog-variable-editor-description-input"
            />
          </div>

          {/* Value preview */}
          <div className="space-y-2">
            <Label>Preview</Label>
            <div className="rounded-md bg-muted p-3">
              <pre className="text-xs overflow-x-auto">{valuePreview}</pre>
            </div>
          </div>

          {/* Submit error */}
          {errors.submit && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              {errors.submit}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            data-ui-id="dialog-variable-editor-cancel-btn"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            data-ui-id="dialog-variable-editor-confirm-btn"
          >
            {isSaving ? "Saving..." : isEditing ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
