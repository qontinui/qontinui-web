"use client";

import {
  AlertTriangle,
  Check,
  X,
  User,
  Users,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  ConflictChange,
  MergeChoices,
  ViewMode,
} from "../_types/conflict";
import { ConflictValueDisplay } from "./ConflictValueDisplay";

interface ConflictDiffItemProps {
  change: ConflictChange;
  viewMode: ViewMode;
  mergeChoices: MergeChoices;
  remoteUserName: string;
  onChoose: (field: string, choice: "local" | "remote") => void;
}

function ChoiceKeyHandler({
  field,
  choice,
  onChoose,
  children,
  className,
}: {
  field: string;
  choice: "local" | "remote";
  onChoose: (field: string, choice: "local" | "remote") => void;
  children: React.ReactNode;
  className: string;
}) {
  return (
    <div
      className={className}
      role="button"
      tabIndex={0}
      onClick={() => onChoose(field, choice)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onChoose(field, choice);
        }
      }}
    >
      {children}
    </div>
  );
}

function NonConflictedItem({ change }: { change: ConflictChange }) {
  return (
    <div className="p-3 border rounded-lg bg-muted/30">
      <div className="flex items-center gap-2 mb-2">
        <Check className="h-4 w-4 text-green-500" />
        <span className="text-sm font-medium">{change.field}</span>
        <Badge
          variant="outline"
          className="bg-green-500/10 text-green-500 border-green-500/20"
        >
          No Conflict
        </Badge>
      </div>
      <div className="text-sm">
        <ConflictValueDisplay value={change.local_value} />
      </div>
    </div>
  );
}

function SplitView({
  change,
  mergeChoices,
  remoteUserName,
  onChoose,
}: Omit<ConflictDiffItemProps, "viewMode">) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between bg-muted px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <span className="text-sm font-medium">{change.field}</span>
        </div>
        <Badge
          variant="outline"
          className="bg-orange-500/10 text-orange-500 border-orange-500/20"
        >
          Conflict
        </Badge>
      </div>
      <div className="grid grid-cols-2 divide-x">
        <ChoiceKeyHandler
          field={change.field}
          choice="local"
          onChoose={onChoose}
          className={cn(
            "p-3 cursor-pointer transition-colors",
            mergeChoices[change.field] === "local"
              ? "bg-green-500/10"
              : "hover:bg-muted/50"
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <User className="h-3 w-3" />
              <span className="text-xs font-medium text-muted-foreground">
                Your Changes
              </span>
            </div>
            {mergeChoices[change.field] === "local" && (
              <Check className="h-4 w-4 text-green-500" />
            )}
          </div>
          <div className="text-sm">
            <ConflictValueDisplay value={change.local_value} />
          </div>
        </ChoiceKeyHandler>

        <ChoiceKeyHandler
          field={change.field}
          choice="remote"
          onChoose={onChoose}
          className={cn(
            "p-3 cursor-pointer transition-colors",
            mergeChoices[change.field] === "remote"
              ? "bg-blue-500/10"
              : "hover:bg-muted/50"
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Users className="h-3 w-3" />
              <span className="text-xs font-medium text-muted-foreground">
                {remoteUserName}&apos;s Changes
              </span>
            </div>
            {mergeChoices[change.field] === "remote" && (
              <Check className="h-4 w-4 text-blue-500" />
            )}
          </div>
          <div className="text-sm">
            <ConflictValueDisplay value={change.remote_value} />
          </div>
        </ChoiceKeyHandler>
      </div>
    </div>
  );
}

function UnifiedView({
  change,
  mergeChoices,
  remoteUserName,
  onChoose,
}: Omit<ConflictDiffItemProps, "viewMode">) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between bg-muted px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <span className="text-sm font-medium">{change.field}</span>
        </div>
      </div>
      <div className="space-y-2 p-3">
        <ChoiceKeyHandler
          field={change.field}
          choice="local"
          onChoose={onChoose}
          className={cn(
            "p-2 rounded border-l-2 cursor-pointer",
            mergeChoices[change.field] === "local"
              ? "border-green-500 bg-green-500/10"
              : "border-red-500 bg-red-500/5"
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <X className="h-3 w-3 text-red-500" />
            <span className="text-xs font-medium">Your Changes</span>
            {mergeChoices[change.field] === "local" && (
              <Check className="h-3 w-3 text-green-500 ml-auto" />
            )}
          </div>
          <div className="text-sm">
            <ConflictValueDisplay value={change.local_value} />
          </div>
        </ChoiceKeyHandler>
        <ChoiceKeyHandler
          field={change.field}
          choice="remote"
          onChoose={onChoose}
          className={cn(
            "p-2 rounded border-l-2 cursor-pointer",
            mergeChoices[change.field] === "remote"
              ? "border-blue-500 bg-blue-500/10"
              : "border-border-default bg-surface-raised/5"
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <ChevronRight className="h-3 w-3 text-blue-500" />
            <span className="text-xs font-medium">
              {remoteUserName}&apos;s Changes
            </span>
            {mergeChoices[change.field] === "remote" && (
              <Check className="h-3 w-3 text-blue-500 ml-auto" />
            )}
          </div>
          <div className="text-sm">
            <ConflictValueDisplay value={change.remote_value} />
          </div>
        </ChoiceKeyHandler>
      </div>
    </div>
  );
}

export function ConflictDiffItem({
  change,
  viewMode,
  mergeChoices,
  remoteUserName,
  onChoose,
}: ConflictDiffItemProps) {
  if (!change.conflicted) {
    return <NonConflictedItem change={change} />;
  }

  if (viewMode === "split") {
    return (
      <SplitView
        change={change}
        mergeChoices={mergeChoices}
        remoteUserName={remoteUserName}
        onChoose={onChoose}
      />
    );
  }

  return (
    <UnifiedView
      change={change}
      mergeChoices={mergeChoices}
      remoteUserName={remoteUserName}
      onChoose={onChoose}
    />
  );
}
