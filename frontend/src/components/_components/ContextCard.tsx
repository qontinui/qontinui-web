"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Pencil,
  Trash2,
  Tag,
  Sparkles,
  AlertCircle,
  FileText,
  FolderOpen,
} from "lucide-react";
import type { Context } from "@qontinui/shared-types/config";
import {
  getCategoryColor,
  truncateContent,
  countAutoIncludeRules,
} from "../context-utils";

export interface ContextCardProps {
  context: Context;
  onEdit: (context: Context) => void;
  onDelete: (context: Context) => void;
}

export function ContextCard({ context, onEdit, onDelete }: ContextCardProps) {
  return (
    <Card className="border-border-default bg-surface-raised hover:border-border-subtle transition-colors group">
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="font-medium truncate" title={context.name}>
                {context.name}
              </h3>
              {context.category && (
                <Badge
                  className="mt-1 text-xs"
                  style={{
                    backgroundColor: getCategoryColor(context.category),
                    color: "black",
                  }}
                >
                  {context.category}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-text-muted hover:text-brand-primary"
                onClick={() => onEdit(context)}
                title="Edit Context"
              >
                <Pencil className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-text-muted hover:text-red-400"
                onClick={() => onDelete(context)}
                title="Delete Context"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Content Preview */}
          <div className="bg-surface-canvas/50 rounded p-2">
            <p className="text-sm text-text-muted font-mono whitespace-pre-wrap line-clamp-4">
              {truncateContent(context.content)}
            </p>
          </div>

          {/* Tags */}
          {context.tags && context.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {context.tags.slice(0, 5).map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="text-xs border-border-subtle text-text-muted"
                >
                  <Tag className="w-2.5 h-2.5 mr-1" />
                  {tag}
                </Badge>
              ))}
              {context.tags.length > 5 && (
                <Badge
                  variant="outline"
                  className="text-xs border-border-subtle text-text-muted"
                >
                  +{context.tags.length - 5} more
                </Badge>
              )}
            </div>
          )}

          {/* Auto-Include Indicators */}
          {countAutoIncludeRules(context.autoInclude) > 0 && (
            <div className="flex items-center gap-2 pt-2 border-t border-border-default">
              <Sparkles className="w-3.5 h-3.5 text-brand-primary" />
              <span className="text-xs text-text-muted">
                {countAutoIncludeRules(context.autoInclude)} auto-include rule
                {countAutoIncludeRules(context.autoInclude) > 1 ? "s" : ""}
              </span>
              <div className="flex gap-1 ml-auto">
                {context.autoInclude?.taskMentions?.length && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 h-5"
                  >
                    <FileText className="w-2.5 h-2.5 mr-0.5" />
                    {context.autoInclude.taskMentions.length}
                  </Badge>
                )}
                {context.autoInclude?.errorPatterns?.length && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 h-5"
                  >
                    <AlertCircle className="w-2.5 h-2.5 mr-0.5" />
                    {context.autoInclude.errorPatterns.length}
                  </Badge>
                )}
                {context.autoInclude?.filePatterns?.length && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 h-5"
                  >
                    <FolderOpen className="w-2.5 h-2.5 mr-0.5" />
                    {context.autoInclude.filePatterns.length}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Footer with dates */}
          <div className="flex items-center justify-between text-xs text-text-muted pt-2">
            <span>
              Created: {new Date(context.createdAt).toLocaleDateString()}
            </span>
            <span>
              Modified: {new Date(context.modifiedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
