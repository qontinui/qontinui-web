"use client";

import { Plus, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AssertionEditor } from "./AssertionEditor";
import type { Assertion } from "@/services/workflow-testing-service";
import type { ValidationErrors } from "../test-case-editor-types";

interface AssertionsCardProps {
  expanded: boolean;
  onToggle: () => void;
  assertions: Assertion[];
  onAddAssertion: () => void;
  onUpdateAssertion: (id: string, updates: Partial<Assertion>) => void;
  onRemoveAssertion: (id: string) => void;
  errors: ValidationErrors;
}

export function AssertionsCard({
  expanded,
  onToggle,
  assertions,
  onAddAssertion,
  onUpdateAssertion,
  onRemoveAssertion,
  errors,
}: AssertionsCardProps) {
  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          <CardTitle>
            Assertions <span className="text-destructive">*</span>
          </CardTitle>
        </div>
        <CardDescription>
          Define assertions to validate test results
        </CardDescription>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4">
          {assertions.map((assertion) => (
            <AssertionEditor
              key={assertion.id}
              assertion={assertion}
              onUpdate={(updates) => onUpdateAssertion(assertion.id, updates)}
              onRemove={() => onRemoveAssertion(assertion.id)}
            />
          ))}
          <Button onClick={onAddAssertion} variant="outline" className="w-full">
            <Plus />
            Add Assertion
          </Button>
          {errors.assertions && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="size-4" />
              {errors.assertions}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
