"use client";

import * as React from "react";
import {
  Search,
  Grid3x3,
  List,
  Plus,
  Star,
  StarOff,
  MoreVertical,
  Eye,
  Trash2,
  Edit,
  Copy,
  Package,
  Folder,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  Filter,
  X,
} from "lucide-react";
import { SubflowComponent } from "@/lib/workflow-organization/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface ComponentLibraryProps {
  components: SubflowComponent[];
  onSelectComponent: (component: SubflowComponent) => void;
  onInsertComponent: (componentId: string, parameters: Record<string, any>) => void;
  onCreateComponent: (component: SubflowComponent) => void;
  onUpdateComponent: (id: string, updates: Partial<SubflowComponent>) => void;
  onDeleteComponent: (id: string) => void;
  className?: string;
}

type ViewMode = "grid" | "list";
type SortBy = "name" | "usage" | "date" | "category";

interface FilterState {
  search: string;
  category: string;
  tags: string[];
  onlyFavorites: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function ComponentLibrary({
  components,
  onSelectComponent,
  onInsertComponent,
  onCreateComponent,
  onUpdateComponent,
  onDeleteComponent,
  className,
}: ComponentLibraryProps) {
  const [viewMode, setViewMode] = React.useState<ViewMode>("grid");
  const [sortBy, setSortBy] = React.useState<SortBy>("name");
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("asc");
  const [filter, setFilter] = React.useState<FilterState>({
    search: "",
    category: "all",
    tags: [],
    onlyFavorites: false,
  });
  const [favorites, setFavorites] = React.useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = React.useState<Set<string>>(
    new Set(["all"])
  );
  const [draggedComponent, setDraggedComponent] = React.useState<SubflowComponent | null>(null);

  // Extract unique categories and tags
  const categories = React.useMemo(() => {
    const cats = new Set<string>();
    components.forEach((comp) => {
      if (comp.category) cats.add(comp.category);
    });
    return ["all", "built-in", "custom", ...Array.from(cats).sort()];
  }, [components]);

  const allTags = React.useMemo(() => {
    const tags = new Set<string>();
    components.forEach((comp) => {
      comp.tags?.forEach((tag) => tags.add(tag));
    });
    return Array.from(tags).sort();
  }, [components]);

  // Filter and sort components
  const filteredComponents = React.useMemo(() => {
    let filtered = components;

    // Apply search filter
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      filtered = filtered.filter(
        (comp) =>
          comp.name.toLowerCase().includes(searchLower) ||
          comp.description?.toLowerCase().includes(searchLower) ||
          comp.tags?.some((tag) => tag.toLowerCase().includes(searchLower))
      );
    }

    // Apply category filter
    if (filter.category !== "all") {
      if (filter.category === "built-in") {
        filtered = filtered.filter((comp) => !comp.author || comp.author === "system");
      } else if (filter.category === "custom") {
        filtered = filtered.filter((comp) => comp.author && comp.author !== "system");
      } else {
        filtered = filtered.filter((comp) => comp.category === filter.category);
      }
    }

    // Apply tags filter
    if (filter.tags.length > 0) {
      filtered = filtered.filter((comp) =>
        filter.tags.every((tag) => comp.tags?.includes(tag))
      );
    }

    // Apply favorites filter
    if (filter.onlyFavorites) {
      filtered = filtered.filter((comp) => favorites.has(comp.id));
    }

    // Sort components
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "usage":
          comparison = (a.usageCount || 0) - (b.usageCount || 0);
          break;
        case "date":
          comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
        case "category":
          comparison = (a.category || "").localeCompare(b.category || "");
          break;
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [components, filter, sortBy, sortOrder, favorites]);

  // Group components by category
  const groupedComponents = React.useMemo(() => {
    const groups = new Map<string, SubflowComponent[]>();

    filteredComponents.forEach((comp) => {
      const category = comp.category || "Uncategorized";
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(comp);
    });

    return groups;
  }, [filteredComponents]);

  // Handlers
  const toggleFavorite = (componentId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(componentId)) {
        next.delete(componentId);
      } else {
        next.add(componentId);
      }
      return next;
    });
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleDragStart = (comp: SubflowComponent) => (e: React.DragEvent) => {
    setDraggedComponent(comp);
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/json", JSON.stringify(comp));
  };

  const handleDragEnd = () => {
    setDraggedComponent(null);
  };

  const toggleSortOrder = () => {
    setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
  };

  const removeTag = (tag: string) => {
    setFilter((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tag),
    }));
  };

  return (
    <div className={cn("flex h-full flex-col gap-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Package className="size-5" />
          <h2 className="text-lg font-semibold">Component Library</h2>
          <Badge variant="secondary">{filteredComponents.length}</Badge>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="grid">
                <Grid3x3 className="size-4" />
              </TabsTrigger>
              <TabsTrigger value="list">
                <List className="size-4" />
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Create Button */}
          <Button onClick={() => onCreateComponent({} as SubflowComponent)}>
            <Plus />
            New Component
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search components..."
              value={filter.search}
              onChange={(e) => setFilter((prev) => ({ ...prev, search: e.target.value }))}
              className="pl-9"
            />
          </div>

          {/* Category Filter */}
          <Select
            value={filter.category}
            onValueChange={(v) => setFilter((prev) => ({ ...prev, category: v }))}
          >
            <SelectTrigger className="w-[180px]">
              <Folder className="size-4" />
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Sort */}
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="w-[140px]">
              <ArrowUpDown className="size-4" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="usage">Usage</SelectItem>
              <SelectItem value="date">Date</SelectItem>
              <SelectItem value="category">Category</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="icon" onClick={toggleSortOrder}>
            <ArrowUpDown className={cn("size-4", sortOrder === "desc" && "rotate-180")} />
          </Button>

          {/* Favorites Toggle */}
          <Button
            variant={filter.onlyFavorites ? "default" : "outline"}
            size="icon"
            onClick={() => setFilter((prev) => ({ ...prev, onlyFavorites: !prev.onlyFavorites }))}
          >
            {filter.onlyFavorites ? <Star className="size-4 fill-current" /> : <Star className="size-4" />}
          </Button>
        </div>

        {/* Active Filters */}
        {(filter.tags.length > 0 || filter.search || filter.category !== "all") && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">Active filters:</span>
            {filter.search && (
              <Badge variant="secondary">
                Search: {filter.search}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-1 size-3 p-0"
                  onClick={() => setFilter((prev) => ({ ...prev, search: "" }))}
                >
                  <X className="size-3" />
                </Button>
              </Badge>
            )}
            {filter.category !== "all" && (
              <Badge variant="secondary">
                Category: {filter.category}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-1 size-3 p-0"
                  onClick={() => setFilter((prev) => ({ ...prev, category: "all" }))}
                >
                  <X className="size-3" />
                </Button>
              </Badge>
            )}
            {filter.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-1 size-3 p-0"
                  onClick={() => removeTag(tag)}
                >
                  <X className="size-3" />
                </Button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Component List/Grid */}
      <ScrollArea className="flex-1">
        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-1">
            {filteredComponents.map((comp) => (
              <ComponentCard
                key={comp.id}
                component={comp}
                isFavorite={favorites.has(comp.id)}
                onToggleFavorite={() => toggleFavorite(comp.id)}
                onSelect={() => onSelectComponent(comp)}
                onInsert={() => onInsertComponent(comp.id, {})}
                onEdit={() => onUpdateComponent(comp.id, {})}
                onDelete={() => onDeleteComponent(comp.id)}
                onDragStart={handleDragStart(comp)}
                onDragEnd={handleDragEnd}
                isDragging={draggedComponent?.id === comp.id}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(groupedComponents.entries()).map(([category, comps]) => (
              <div key={category} className="space-y-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => toggleCategory(category)}
                >
                  {expandedCategories.has(category) ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                  <Folder className="size-4" />
                  <span className="font-medium">{category}</span>
                  <Badge variant="secondary" className="ml-auto">
                    {comps.length}
                  </Badge>
                </Button>

                {expandedCategories.has(category) && (
                  <div className="space-y-2 pl-6">
                    {comps.map((comp) => (
                      <ComponentListItem
                        key={comp.id}
                        component={comp}
                        isFavorite={favorites.has(comp.id)}
                        onToggleFavorite={() => toggleFavorite(comp.id)}
                        onSelect={() => onSelectComponent(comp)}
                        onInsert={() => onInsertComponent(comp.id, {})}
                        onEdit={() => onUpdateComponent(comp.id, {})}
                        onDelete={() => onDeleteComponent(comp.id)}
                        onDragStart={handleDragStart(comp)}
                        onDragEnd={handleDragEnd}
                        isDragging={draggedComponent?.id === comp.id}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {filteredComponents.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-muted-foreground">
            <Package className="size-12" />
            <div className="text-center">
              <p className="font-medium">No components found</p>
              <p className="text-sm">Try adjusting your filters or create a new component</p>
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Component Card (Grid View)
// ============================================================================

interface ComponentCardProps {
  component: SubflowComponent;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onSelect: () => void;
  onInsert: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}

function ComponentCard({
  component,
  isFavorite,
  onToggleFavorite,
  onSelect,
  onInsert,
  onEdit,
  onDelete,
  onDragStart,
  onDragEnd,
  isDragging,
}: ComponentCardProps) {
  return (
    <Card
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "cursor-grab active:cursor-grabbing transition-all hover:shadow-lg",
        isDragging && "opacity-50 scale-95"
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {component.icon && (
              <div className="flex items-center justify-center size-8 rounded-md bg-primary/10 text-primary shrink-0">
                <Package className="size-4" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base truncate">{component.name}</CardTitle>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onToggleFavorite}
            >
              {isFavorite ? (
                <Star className="size-3.5 fill-current text-yellow-500" />
              ) : (
                <StarOff className="size-3.5" />
              )}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <MoreVertical className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onSelect}>
                  <Eye className="size-4" />
                  Preview
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onEdit}>
                  <Edit className="size-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onInsert}>
                  <Copy className="size-4" />
                  Insert
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {component.description && (
          <CardDescription className="line-clamp-2 text-xs">
            {component.description}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-3">
          {/* Stats */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{component.actions.length} actions</span>
            <span>{component.parameters.length} params</span>
            <span>{component.usageCount || 0} uses</span>
          </div>

          {/* Tags */}
          {component.tags && component.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {component.tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {component.tags.length > 3 && (
                <Badge variant="secondary" className="text-xs">
                  +{component.tags.length - 3}
                </Badge>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm" className="flex-1" onClick={onInsert}>
              Insert
            </Button>
            <Button variant="outline" size="sm" onClick={onSelect}>
              <Eye className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Component List Item (List View)
// ============================================================================

function ComponentListItem({
  component,
  isFavorite,
  onToggleFavorite,
  onSelect,
  onInsert,
  onEdit,
  onDelete,
  onDragStart,
  onDragEnd,
  isDragging,
}: ComponentCardProps) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 cursor-grab active:cursor-grabbing transition-all",
        isDragging && "opacity-50 scale-95"
      )}
    >
      {/* Icon */}
      {component.icon && (
        <div className="flex items-center justify-center size-10 rounded-md bg-primary/10 text-primary shrink-0">
          <Package className="size-5" />
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-medium truncate">{component.name}</h3>
          {component.tags?.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
        {component.description && (
          <p className="text-sm text-muted-foreground truncate">{component.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span>{component.actions.length} actions</span>
          <span>{component.parameters.length} parameters</span>
          <span>{component.usageCount || 0} uses</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="icon" className="size-8" onClick={onToggleFavorite}>
          {isFavorite ? (
            <Star className="size-4 fill-current text-yellow-500" />
          ) : (
            <StarOff className="size-4" />
          )}
        </Button>

        <Button variant="outline" size="sm" onClick={onInsert}>
          Insert
        </Button>

        <Button variant="outline" size="sm" onClick={onSelect}>
          <Eye className="size-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Edit className="size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onInsert}>
              <Copy className="size-4" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
