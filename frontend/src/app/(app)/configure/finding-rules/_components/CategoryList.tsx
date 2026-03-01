"use client";

import { Settings2, Search } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type {
  FindingCategoryConfig,
  FindingCategoryActionType,
} from "@/lib/api-client";
import { CategoryEditRow } from "./CategoryEditRow";
import { CategoryViewRow } from "./CategoryViewRow";

interface CategoryListProps {
  categories: FindingCategoryConfig[];
  filteredCategories: FindingCategoryConfig[];
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  editingId: string | null;
  editName: string;
  editDescription: string;
  editIcon: string;
  editColor: string;
  editActionType: FindingCategoryActionType;
  onEditNameChange: (value: string) => void;
  onEditDescriptionChange: (value: string) => void;
  onEditIconChange: (value: string) => void;
  onEditColorChange: (value: string) => void;
  onEditActionTypeChange: (value: FindingCategoryActionType) => void;
  onCancelEdit: () => void;
  onSaveEdit: (cat: FindingCategoryConfig) => void;
  togglingId: string | null;
  onReorder: (cat: FindingCategoryConfig, direction: "up" | "down") => void;
  onToggleEnabled: (cat: FindingCategoryConfig) => void;
  onStartEdit: (cat: FindingCategoryConfig) => void;
  onDelete: (id: string) => void;
}

export function CategoryList({
  categories,
  filteredCategories,
  searchQuery,
  onSearchQueryChange,
  editingId,
  editName,
  editDescription,
  editIcon,
  editColor,
  editActionType,
  onEditNameChange,
  onEditDescriptionChange,
  onEditIconChange,
  onEditColorChange,
  onEditActionTypeChange,
  onCancelEdit,
  onSaveEdit,
  togglingId,
  onReorder,
  onToggleEnabled,
  onStartEdit,
  onDelete,
}: CategoryListProps) {
  const showReorderButtons = !searchQuery.trim();

  return (
    <Card className="bg-muted border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg text-white flex items-center gap-2">
              <Settings2 className="w-5 h-5" />
              Categories
            </CardTitle>
            <CardDescription className="text-muted-foreground mt-1">
              Configure how AI-detected findings are classified
            </CardDescription>
          </div>
          {categories.length > 0 && (
            <Badge variant="secondary">{categories.length} categories</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        {categories.length > 3 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search categories..."
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className="pl-10 bg-muted border-border text-white placeholder:text-muted-foreground"
            />
          </div>
        )}

        {!filteredCategories.length ? (
          <div className="text-center py-12">
            <Settings2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {categories.length > 0
                ? "No categories match your search"
                : "No categories configured."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredCategories.map((cat, index) => {
              const isEditing = editingId === cat.id;

              if (isEditing && !cat.is_built_in) {
                return (
                  <CategoryEditRow
                    key={cat.id}
                    cat={cat}
                    editName={editName}
                    editDescription={editDescription}
                    editIcon={editIcon}
                    editColor={editColor}
                    editActionType={editActionType}
                    onEditNameChange={onEditNameChange}
                    onEditDescriptionChange={onEditDescriptionChange}
                    onEditIconChange={onEditIconChange}
                    onEditColorChange={onEditColorChange}
                    onEditActionTypeChange={onEditActionTypeChange}
                    onCancel={onCancelEdit}
                    onSave={onSaveEdit}
                  />
                );
              }

              return (
                <CategoryViewRow
                  key={cat.id}
                  cat={cat}
                  isFirst={index === 0}
                  isLast={index === filteredCategories.length - 1}
                  showReorderButtons={showReorderButtons}
                  isToggling={togglingId === cat.id}
                  onReorder={onReorder}
                  onToggleEnabled={onToggleEnabled}
                  onEdit={onStartEdit}
                  onDelete={onDelete}
                />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
