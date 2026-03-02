"use client";

import { Plus, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import type { TestSuiteValidationErrors } from "../test-suite-editor-types";

interface SuiteDetailsCardProps {
  isEditing: boolean;
  name: string;
  onNameChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  executionOrder: "parallel" | "sequential";
  onExecutionOrderChange: (value: "parallel" | "sequential") => void;
  stopOnFailure: boolean;
  onStopOnFailureChange: (value: boolean) => void;
  tags: string[];
  newTag: string;
  onNewTagChange: (value: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  errors: TestSuiteValidationErrors;
}

export function SuiteDetailsCard({
  isEditing,
  name,
  onNameChange,
  description,
  onDescriptionChange,
  executionOrder,
  onExecutionOrderChange,
  stopOnFailure,
  onStopOnFailureChange,
  tags,
  newTag,
  onNewTagChange,
  onAddTag,
  onRemoveTag,
  errors,
}: SuiteDetailsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isEditing ? "Edit Test Suite" : "New Test Suite"}
        </CardTitle>
        <CardDescription>
          Group test cases together for organized execution
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">
            Suite Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g., Login Flow Tests"
            aria-invalid={!!errors.name}
          />
          {errors.name && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="size-4" />
              {errors.name}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Describe the purpose of this test suite..."
            rows={3}
          />
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="executionOrder">Execution Order</Label>
            <Select
              value={executionOrder}
              onValueChange={(value) =>
                onExecutionOrderChange(value as "parallel" | "sequential")
              }
            >
              <SelectTrigger id="executionOrder">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sequential">Sequential</SelectItem>
                <SelectItem value="parallel">Parallel</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="stopOnFailure">Stop on Failure</Label>
            <div className="flex items-center space-x-2 h-10">
              <Checkbox
                id="stopOnFailure"
                checked={stopOnFailure}
                onCheckedChange={(checked) =>
                  onStopOnFailureChange(checked === true)
                }
              />
              <label
                htmlFor="stopOnFailure"
                className="text-sm text-muted-foreground cursor-pointer"
              >
                Stop execution on first failure
              </label>
            </div>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="tags">Tags</Label>
          <div className="flex gap-2">
            <Input
              id="tags"
              value={newTag}
              onChange={(e) => onNewTagChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAddTag();
                }
              }}
              placeholder="Add tag..."
            />
            <Button onClick={onAddTag} variant="outline" size="sm">
              <Plus />
              Add
            </Button>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                  <button
                    onClick={() => onRemoveTag(tag)}
                    className="ml-1 hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
