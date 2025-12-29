"use client";

import * as React from "react";
import {
  Save,
  X,
  Play,
  Plus,
  Trash2,
  Edit,
  GripVertical,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Tag,
  FileText,
  Settings,
  Code,
  Eye,
} from "lucide-react";
import {
  SubflowComponent,
  ComponentParameter,
} from "@/lib/workflow-organization/types";
import { Action, ActionType } from "@/lib/action-schema/action-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface ComponentEditorProps {
  component?: SubflowComponent;
  onSave: (component: SubflowComponent) => void;
  onCancel: () => void;
  onTest?: (
    component: SubflowComponent,
    parameters: Record<string, unknown>
  ) => void;
  className?: string;
}

interface ValidationError {
  field: string;
  message: string;
}

type ParameterType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "any";

// ============================================================================
// Component
// ============================================================================

export function ComponentEditor({
  component,
  onSave,
  onCancel,
  onTest,
  className,
}: ComponentEditorProps) {
  const [name, setName] = React.useState(component?.name || "");
  const [description, setDescription] = React.useState(
    component?.description || ""
  );
  const [category, setCategory] = React.useState(component?.category || "");
  const [icon, setIcon] = React.useState(component?.icon || "");
  const [tags, setTags] = React.useState<string[]>(component?.tags || []);
  const [tagInput, setTagInput] = React.useState("");
  const [parameters, setParameters] = React.useState<ComponentParameter[]>(
    component?.parameters || []
  );
  const [actions, setActions] = React.useState<Action[]>(
    component?.actions || []
  );
  const [validationErrors, setValidationErrors] = React.useState<
    ValidationError[]
  >([]);
  const [activeTab, setActiveTab] = React.useState("metadata");

  // Validation
  const validate = React.useCallback((): boolean => {
    const errors: ValidationError[] = [];

    if (!name.trim()) {
      errors.push({ field: "name", message: "Component name is required" });
    }

    if (parameters.length > 0) {
      parameters.forEach((param, index) => {
        if (!param.name.trim()) {
          errors.push({
            field: `parameter-${index}`,
            message: `Parameter ${index + 1} name is required`,
          });
        }
      });
    }

    if (actions.length === 0) {
      errors.push({
        field: "actions",
        message: "At least one action is required",
      });
    }

    setValidationErrors(errors);
    return errors.length === 0;
  }, [name, parameters, actions]);

  // Handlers
  const handleSave = () => {
    if (!validate()) {
      setActiveTab("metadata");
      return;
    }

    const componentData: SubflowComponent = {
      id: component?.id || crypto.randomUUID(),
      name: name.trim(),
      description: description.trim() || undefined,
      category: category.trim() || undefined,
      icon: icon.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      parameters,
      actions,
      usageCount: component?.usageCount || 0,
      createdAt: component?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: component?.version || "1.0.0",
      author: component?.author,
      metadata: component?.metadata,
    };

    onSave(componentData);
  };

  const handleTest = () => {
    if (!validate()) return;

    const testParameters: Record<string, unknown> = {};
    parameters.forEach((param) => {
      testParameters[param.name] = param.defaultValue;
    });

    onTest?.(
      {
        id: component?.id || crypto.randomUUID(),
        name,
        description,
        parameters,
        actions,
        usageCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: "1.0.0",
      },
      testParameters
    );
  };

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleAddParameter = () => {
    setParameters([
      ...parameters,
      {
        name: "",
        type: "string",
        required: false,
        description: "",
      },
    ]);
  };

  const handleUpdateParameter = (
    index: number,
    updates: Partial<ComponentParameter>
  ) => {
    const updated = [...parameters];
    updated[index] = { ...updated[index], ...updates } as ComponentParameter;
    setParameters(updated);
  };

  const handleRemoveParameter = (index: number) => {
    setParameters(parameters.filter((_, i) => i !== index));
  };

  const handleAddAction = () => {
    const newAction: Partial<Action> = {
      id: crypto.randomUUID(),
      type: "FIND" as ActionType,
      name: "New Action",
      position: [0, 0],
    };
    setActions([...actions, newAction as Action]);
  };

  const handleRemoveAction = (index: number) => {
    setActions(actions.filter((_, i) => i !== index));
  };

  const getErrorForField = (field: string): string | undefined => {
    return validationErrors.find((err) => err.field === field)?.message;
  };

  return (
    <div className={cn("flex h-full flex-col gap-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">
            {component ? "Edit Component" : "Create Component"}
          </h2>
          {component && <Badge variant="secondary">v{component.version}</Badge>}
        </div>

        <div className="flex items-center gap-2">
          {onTest && (
            <Button variant="outline" onClick={handleTest}>
              <Play />
              Test
            </Button>
          )}
          <Button variant="outline" onClick={onCancel}>
            <X />
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Save />
            Save
          </Button>
        </div>
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>
            <div className="font-medium mb-1">
              Please fix the following errors:
            </div>
            <ul className="list-disc list-inside text-sm space-y-0.5">
              {validationErrors.map((error, i) => (
                <li key={i}>{error.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Content */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col"
      >
        <TabsList>
          <TabsTrigger value="metadata">
            <Settings className="size-4" />
            Metadata
          </TabsTrigger>
          <TabsTrigger value="parameters">
            <Code className="size-4" />
            Parameters
          </TabsTrigger>
          <TabsTrigger value="actions">
            <FileText className="size-4" />
            Actions
          </TabsTrigger>
          <TabsTrigger value="preview">
            <Eye className="size-4" />
            Preview
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 mt-4">
          {/* Metadata Tab */}
          <TabsContent value="metadata" className="mt-0 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
                <CardDescription>
                  Define the component&apos;s name, description, and
                  organization
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Name */}
                <div className="space-y-2">
                  <Label htmlFor="name">
                    Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    placeholder="Component name..."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={!!getErrorForField("name")}
                  />
                  {getErrorForField("name") && (
                    <p className="text-xs text-destructive">
                      {getErrorForField("name")}
                    </p>
                  )}
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Describe what this component does..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                  />
                </div>

                {/* Category */}
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Input
                    id="category"
                    placeholder="e.g., Authentication, Data Processing..."
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  />
                </div>

                {/* Icon */}
                <div className="space-y-2">
                  <Label htmlFor="icon">Icon</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="icon"
                      placeholder="Icon name..."
                      value={icon}
                      onChange={(e) => setIcon(e.target.value)}
                      className="flex-1"
                    />
                    <Button variant="outline" size="icon">
                      <ImageIcon className="size-4" />
                    </Button>
                  </div>
                </div>

                {/* Tags */}
                <div className="space-y-2">
                  <Label htmlFor="tags">Tags</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="tags"
                      placeholder="Add a tag..."
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                      className="flex-1"
                    />
                    <Button variant="outline" onClick={handleAddTag}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          <Tag className="size-3 mr-1" />
                          {tag}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="ml-1 size-3 p-0"
                            onClick={() => handleRemoveTag(tag)}
                          >
                            <X className="size-3" />
                          </Button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Parameters Tab */}
          <TabsContent value="parameters" className="mt-0 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Parameters</CardTitle>
                    <CardDescription>
                      Define input parameters for this component
                    </CardDescription>
                  </div>
                  <Button onClick={handleAddParameter}>
                    <Plus />
                    Add Parameter
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {parameters.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Code className="size-12 mb-4" />
                    <p className="font-medium">No parameters defined</p>
                    <p className="text-sm">
                      Add parameters to make your component configurable
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {parameters.map((param, index) => (
                      <ParameterEditor
                        key={index}
                        parameter={param}
                        index={index}
                        error={getErrorForField(`parameter-${index}`)}
                        onUpdate={(updates) =>
                          handleUpdateParameter(index, updates)
                        }
                        onRemove={() => handleRemoveParameter(index)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Actions Tab */}
          <TabsContent value="actions" className="mt-0 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Actions</CardTitle>
                    <CardDescription>
                      Define the workflow logic for this component
                    </CardDescription>
                  </div>
                  <Button onClick={handleAddAction}>
                    <Plus />
                    Add Action
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {actions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <FileText className="size-12 mb-4" />
                    <p className="font-medium">No actions defined</p>
                    <p className="text-sm">
                      Add actions to define the component&apos;s behavior
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {actions.map((action, index) => (
                      <ActionListItem
                        key={action.id}
                        action={action}
                        index={index}
                        onRemove={() => handleRemoveAction(index)}
                      />
                    ))}
                  </div>
                )}
                {getErrorForField("actions") && (
                  <Alert variant="destructive" className="mt-4">
                    <AlertCircle className="size-4" />
                    <AlertDescription>
                      {getErrorForField("actions")}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Preview Tab */}
          <TabsContent value="preview" className="mt-0 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Component Preview</CardTitle>
                <CardDescription>
                  Preview how your component will appear in the library
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Preview Card */}
                <div className="border rounded-lg p-4 bg-card">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {icon && (
                        <div className="flex items-center justify-center size-10 rounded-md bg-primary/10 text-primary">
                          <ImageIcon className="size-5" />
                        </div>
                      )}
                      <div>
                        <h3 className="font-semibold text-lg">
                          {name || "Untitled Component"}
                        </h3>
                        {category && (
                          <p className="text-xs text-muted-foreground">
                            {category}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {description && (
                    <p className="text-sm text-muted-foreground mb-3">
                      {description}
                    </p>
                  )}

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                    <span>{actions.length} actions</span>
                    <span>{parameters.length} parameters</span>
                  </div>

                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="text-xs"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                {/* Summary */}
                <div className="space-y-3">
                  <h4 className="font-medium">Summary</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Name:</span>
                      <span className="ml-2 font-medium">{name || "-"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Category:</span>
                      <span className="ml-2 font-medium">
                        {category || "-"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Parameters:</span>
                      <span className="ml-2 font-medium">
                        {parameters.length}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Actions:</span>
                      <span className="ml-2 font-medium">{actions.length}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Tags:</span>
                      <span className="ml-2 font-medium">{tags.length}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

// ============================================================================
// Parameter Editor
// ============================================================================

interface ParameterEditorProps {
  parameter: ComponentParameter;
  index: number;
  error?: string;
  onUpdate: (updates: Partial<ComponentParameter>) => void;
  onRemove: () => void;
}

function ParameterEditor({
  parameter,
  index,
  error,
  onUpdate,
  onRemove,
}: ParameterEditorProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);

  return (
    <Card className={cn(error && "border-destructive")}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="flex items-center gap-2 flex-1 justify-start"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <GripVertical className="size-4 text-muted-foreground" />
            {isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <span className="font-medium">
              {parameter.name || `Parameter ${index + 1}`}
            </span>
            <Badge variant="outline" className="ml-2">
              {parameter.type}
            </Badge>
            {parameter.required && <Badge variant="secondary">Required</Badge>}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onRemove}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-3 pt-0">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* Name */}
            <div className="space-y-2">
              <Label>
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="parameterName"
                value={parameter.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                aria-invalid={!!error}
              />
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={parameter.type}
                onValueChange={(v) => onUpdate({ type: v as ParameterType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">String</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="boolean">Boolean</SelectItem>
                  <SelectItem value="object">Object</SelectItem>
                  <SelectItem value="array">Array</SelectItem>
                  <SelectItem value="any">Any</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              placeholder="Parameter description..."
              value={parameter.description || ""}
              onChange={(e) => onUpdate({ description: e.target.value })}
              rows={2}
            />
          </div>

          {/* Default Value */}
          <div className="space-y-2">
            <Label>Default Value</Label>
            <Input
              placeholder="Default value..."
              value={String(parameter.defaultValue || "")}
              onChange={(e) => onUpdate({ defaultValue: e.target.value })}
            />
          </div>

          {/* Required */}
          <div className="flex items-center gap-2">
            <Checkbox
              id={`required-${index}`}
              checked={parameter.required}
              onCheckedChange={(checked) =>
                onUpdate({ required: checked as boolean })
              }
            />
            <Label htmlFor={`required-${index}`}>Required parameter</Label>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ============================================================================
// Action List Item
// ============================================================================

interface ActionListItemProps {
  action: Action;
  index: number;
  onRemove: () => void;
}

function ActionListItem({
  action,
  index: _index,
  onRemove,
}: ActionListItemProps) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg border bg-card hover:bg-accent/50">
      <GripVertical className="size-4 text-muted-foreground cursor-grab" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">
            {action.name || action.type}
          </span>
          <Badge variant="outline" className="text-xs">
            {action.type}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="size-8">
          <Edit className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onRemove}
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
