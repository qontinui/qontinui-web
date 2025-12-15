"use client";

import * as React from "react";
import {
  Package,
  AlertCircle,
  Info,
  CheckCircle,
  Copy,
  Eye,
  X,
} from "lucide-react";
import {
  SubflowComponent,
  ComponentParameter,
} from "@/lib/workflow-organization/types";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface ComponentInsertDialogProps {
  component: SubflowComponent;
  open: boolean;
  onClose: () => void;
  onInsert: (parameters: Record<string, unknown>) => void;
  className?: string;
}

interface ValidationError {
  parameter: string;
  message: string;
}

interface ParameterValue {
  value: unknown;
  isValid: boolean;
  error?: string;
}

// ============================================================================
// Component
// ============================================================================

export function ComponentInsertDialog({
  component,
  open,
  onClose,
  onInsert,
  className,
}: ComponentInsertDialogProps) {
  const [parameterValues, setParameterValues] = React.useState<
    Record<string, ParameterValue>
  >({});
  const [validationErrors, setValidationErrors] = React.useState<
    ValidationError[]
  >([]);
  const [activeTab, setActiveTab] = React.useState<"parameters" | "preview">(
    "parameters"
  );

  // Initialize parameter values
  React.useEffect(() => {
    if (open) {
      const initialValues: Record<string, ParameterValue> = {};
      component.parameters.forEach((param) => {
        initialValues[param.name] = {
          value: param.defaultValue !== undefined ? param.defaultValue : "",
          isValid: !param.required || param.defaultValue !== undefined,
        };
      });
      setParameterValues(initialValues);
      setValidationErrors([]);
      setActiveTab("parameters");
    }
  }, [open, component.parameters]);

  // Validation
  const validate = React.useCallback((): boolean => {
    const errors: ValidationError[] = [];

    component.parameters.forEach((param) => {
      const paramValue = parameterValues[param.name];

      // Check required
      if (
        param.required &&
        (paramValue?.value === "" || paramValue?.value === undefined)
      ) {
        errors.push({
          parameter: param.name,
          message: `${param.name} is required`,
        });
      }

      // Type validation
      if (paramValue?.value !== "" && paramValue?.value !== undefined) {
        const value = paramValue.value;
        let isValidType = true;

        switch (param.type) {
          case "number":
            isValidType = !isNaN(Number(value));
            if (!isValidType) {
              errors.push({
                parameter: param.name,
                message: `${param.name} must be a number`,
              });
            }
            break;
          case "boolean":
            isValidType =
              value === "true" ||
              value === "false" ||
              typeof value === "boolean";
            if (!isValidType) {
              errors.push({
                parameter: param.name,
                message: `${param.name} must be a boolean`,
              });
            }
            break;
          case "array":
            try {
              if (typeof value === "string") {
                JSON.parse(value);
              }
            } catch {
              errors.push({
                parameter: param.name,
                message: `${param.name} must be a valid JSON array`,
              });
            }
            break;
          case "object":
            try {
              if (typeof value === "string") {
                JSON.parse(value);
              }
            } catch {
              errors.push({
                parameter: param.name,
                message: `${param.name} must be a valid JSON object`,
              });
            }
            break;
        }
      }

      // Validation rules
      if (
        param.validation &&
        paramValue?.value !== "" &&
        paramValue?.value !== undefined
      ) {
        const value = paramValue.value;

        if (
          param.validation.min !== undefined &&
          Number(value) < param.validation.min
        ) {
          errors.push({
            parameter: param.name,
            message: `${param.name} must be at least ${param.validation.min}`,
          });
        }

        if (
          param.validation.max !== undefined &&
          Number(value) > param.validation.max
        ) {
          errors.push({
            parameter: param.name,
            message: `${param.name} must be at most ${param.validation.max}`,
          });
        }

        if (
          param.validation.pattern &&
          !new RegExp(param.validation.pattern).test(String(value))
        ) {
          errors.push({
            parameter: param.name,
            message: `${param.name} format is invalid`,
          });
        }

        if (param.validation.enum && !param.validation.enum.includes(value)) {
          errors.push({
            parameter: param.name,
            message: `${param.name} must be one of: ${param.validation.enum.join(", ")}`,
          });
        }
      }
    });

    setValidationErrors(errors);
    return errors.length === 0;
  }, [component.parameters, parameterValues]);

  // Handlers
  const handleInsert = () => {
    if (!validate()) {
      setActiveTab("parameters");
      return;
    }

    const parameters: Record<string, unknown> = {};
    Object.entries(parameterValues).forEach(([name, paramValue]) => {
      const param = component.parameters.find((p) => p.name === name);
      if (!param) return;

      let value = paramValue.value;

      // Type conversion
      switch (param.type) {
        case "number":
          value = value !== "" ? Number(value) : undefined;
          break;
        case "boolean":
          value = value === "true" || value === true;
          break;
        case "array":
        case "object":
          if (typeof value === "string" && value !== "") {
            try {
              value = JSON.parse(value);
            } catch {
              // Keep as string if invalid JSON
            }
          }
          break;
      }

      parameters[name] = value;
    });

    onInsert(parameters);
    onClose();
  };

  const handleParameterChange = (paramName: string, value: unknown) => {
    setParameterValues((prev) => ({
      ...prev,
      [paramName]: {
        value,
        isValid: true,
      },
    }));
  };

  const getErrorForParameter = (paramName: string): string | undefined => {
    return validationErrors.find((err) => err.parameter === paramName)?.message;
  };

  const requiredParams = component.parameters.filter((p) => p.required);
  const optionalParams = component.parameters.filter((p) => !p.required);

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn("max-w-2xl max-h-[90vh] flex flex-col", className)}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10 text-primary">
              <Package className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-xl">Insert Component</DialogTitle>
              <DialogDescription className="truncate">
                {component.name}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as unknown)}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList>
            <TabsTrigger value="parameters" className="flex items-center gap-2">
              Parameters
              {requiredParams.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {requiredParams.length} required
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="preview" className="flex items-center gap-2">
              <Eye className="size-4" />
              Preview
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4">
            {/* Parameters Tab */}
            <TabsContent value="parameters" className="mt-0 space-y-4">
              {/* Component Info */}
              {component.description && (
                <Alert>
                  <Info className="size-4" />
                  <AlertDescription>{component.description}</AlertDescription>
                </Alert>
              )}

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

              {/* Required Parameters */}
              {requiredParams.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Required Parameters
                    </CardTitle>
                    <CardDescription>
                      These parameters must be provided
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {requiredParams.map((param) => (
                      <ParameterInput
                        key={param.name}
                        parameter={param}
                        value={parameterValues[param.name]?.value}
                        error={getErrorForParameter(param.name)}
                        onChange={(value) =>
                          handleParameterChange(param.name, value)
                        }
                      />
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Optional Parameters */}
              {optionalParams.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Optional Parameters
                    </CardTitle>
                    <CardDescription>
                      These parameters have default values
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {optionalParams.map((param) => (
                      <ParameterInput
                        key={param.name}
                        parameter={param}
                        value={parameterValues[param.name]?.value}
                        error={getErrorForParameter(param.name)}
                        onChange={(value) =>
                          handleParameterChange(param.name, value)
                        }
                      />
                    ))}
                  </CardContent>
                </Card>
              )}

              {component.parameters.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <CheckCircle className="size-12 mb-4" />
                  <p className="font-medium">No parameters required</p>
                  <p className="text-sm">
                    This component can be inserted directly
                  </p>
                </div>
              )}
            </TabsContent>

            {/* Preview Tab */}
            <TabsContent value="preview" className="mt-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Component Details</CardTitle>
                  <CardDescription>
                    Review the component before inserting
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Component Info */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Name:</span>
                      <span className="text-sm text-muted-foreground">
                        {component.name}
                      </span>
                    </div>
                    {component.category && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Category:</span>
                        <Badge variant="secondary">{component.category}</Badge>
                      </div>
                    )}
                    {component.tags && component.tags.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Tags:</span>
                        <div className="flex flex-wrap gap-1">
                          {component.tags.map((tag) => (
                            <Badge
                              key={tag}
                              variant="outline"
                              className="text-xs"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold">
                        {component.actions.length}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Actions
                      </div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold">
                        {component.parameters.length}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Parameters
                      </div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold">
                        {component.usageCount || 0}
                      </div>
                      <div className="text-xs text-muted-foreground">Uses</div>
                    </div>
                  </div>

                  <Separator />

                  {/* Parameter Values */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Parameter Values</h4>
                    {component.parameters.length > 0 ? (
                      <div className="space-y-2">
                        {component.parameters.map((param) => {
                          const value = parameterValues[param.name]?.value;
                          const displayValue =
                            value !== undefined && value !== ""
                              ? String(value)
                              : param.defaultValue !== undefined
                                ? `${param.defaultValue} (default)`
                                : "-";

                          return (
                            <div
                              key={param.name}
                              className="flex items-start justify-between gap-4 p-2 rounded-md bg-muted/50"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">
                                    {param.name}
                                  </span>
                                  <Badge variant="outline" className="text-xs">
                                    {param.type}
                                  </Badge>
                                  {param.required && (
                                    <Badge
                                      variant="secondary"
                                      className="text-xs"
                                    >
                                      Required
                                    </Badge>
                                  )}
                                </div>
                                {param.description && (
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {param.description}
                                  </p>
                                )}
                              </div>
                              <div className="text-sm text-muted-foreground font-mono truncate max-w-[200px]">
                                {displayValue}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No parameters
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <X />
            Cancel
          </Button>
          <Button onClick={handleInsert}>
            <Copy />
            Insert Component
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Parameter Input
// ============================================================================

interface ParameterInputProps {
  parameter: ComponentParameter;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
}

function ParameterInput({
  parameter,
  value,
  error,
  onChange,
}: ParameterInputProps) {
  const inputId = `param-${parameter.name}`;

  // Render input based on type
  const renderInput = () => {
    switch (parameter.type) {
      case "boolean":
        return (
          <div className="flex items-center gap-2 h-9">
            <Checkbox
              id={inputId}
              checked={value === true || value === "true"}
              onCheckedChange={(checked) => onChange(checked)}
            />
            <Label htmlFor={inputId} className="cursor-pointer">
              {parameter.description || "Enable this option"}
            </Label>
          </div>
        );

      case "number":
        return (
          <Input
            id={inputId}
            type="number"
            placeholder={
              parameter.defaultValue?.toString() || "Enter a number..."
            }
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={!!error}
            min={parameter.validation?.min}
            max={parameter.validation?.max}
          />
        );

      case "array":
      case "object":
        return (
          <Textarea
            id={inputId}
            placeholder={`Enter JSON ${parameter.type}...`}
            value={
              typeof value === "string" ? value : JSON.stringify(value, null, 2)
            }
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={!!error}
            rows={4}
            className="font-mono text-sm"
          />
        );

      default:
        // String or any type
        if (parameter.validation?.enum) {
          return (
            <Select value={value || ""} onValueChange={onChange}>
              <SelectTrigger id={inputId} aria-invalid={!!error}>
                <SelectValue placeholder="Select an option..." />
              </SelectTrigger>
              <SelectContent>
                {parameter.validation.enum.map((option) => (
                  <SelectItem key={String(option)} value={String(option)}>
                    {String(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }

        return (
          <Input
            id={inputId}
            placeholder={
              parameter.defaultValue?.toString() || "Enter a value..."
            }
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={!!error}
          />
        );
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={inputId} className="flex items-center gap-2">
          {parameter.name}
          {parameter.required && <span className="text-destructive">*</span>}
          <Badge variant="outline" className="text-xs font-normal">
            {parameter.type}
          </Badge>
        </Label>
        {parameter.defaultValue !== undefined && !parameter.required && (
          <span className="text-xs text-muted-foreground">
            Default: {String(parameter.defaultValue)}
          </span>
        )}
      </div>

      {renderInput()}

      {parameter.description && parameter.type !== "boolean" && (
        <p className="text-xs text-muted-foreground">{parameter.description}</p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {parameter.validation && (
        <div className="text-xs text-muted-foreground space-y-0.5">
          {parameter.validation.min !== undefined && (
            <div>Min: {parameter.validation.min}</div>
          )}
          {parameter.validation.max !== undefined && (
            <div>Max: {parameter.validation.max}</div>
          )}
          {parameter.validation.pattern && (
            <div>Pattern: {parameter.validation.pattern}</div>
          )}
        </div>
      )}
    </div>
  );
}
