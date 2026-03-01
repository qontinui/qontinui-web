/**
 * TutorialMenu - UI Component for Tutorial Selection
 *
 * Displays available tutorials with filtering, search, and metadata.
 * Shows completion status and allows launching tutorials.
 */

import React, { useState, useMemo, useCallback } from "react";
import {
  BookOpen,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  Circle,
  PlayCircle,
  Star,
  Award,
  Zap,
  X,
} from "lucide-react";
import { useTutorial } from "./TutorialProvider";
import { useTutorialStore } from "@/stores/tutorial-store";
import type { Tutorial, DifficultyLevel } from "@/types/tutorial";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

// ============================================================================
// Types
// ============================================================================

interface TutorialMenuProps {
  /** Available tutorials to display */
  tutorials: Tutorial[];
  /** Whether the menu is open */
  isOpen: boolean;
  /** Callback to close the menu */
  onClose: () => void;
  /** Optional title for the menu */
  title?: string;
  /** Optional custom filter function */
  customFilter?: (tutorial: Tutorial) => boolean;
}

type CompletionFilter = "all" | "completed" | "in-progress" | "not-started";

// ============================================================================
// Component
// ============================================================================

function DifficultyBadge({ difficulty }: { difficulty: DifficultyLevel }) {
  const variants: Record<
    DifficultyLevel,
    { icon: React.ReactNode; color: string }
  > = {
    beginner: {
      icon: <Circle className="h-3 w-3" />,
      color: "bg-green-500/10 text-green-700",
    },
    intermediate: {
      icon: <Star className="h-3 w-3" />,
      color: "bg-yellow-500/10 text-yellow-700",
    },
    advanced: {
      icon: <Zap className="h-3 w-3" />,
      color: "bg-red-500/10 text-red-700",
    },
  };

  const { icon, color } = variants[difficulty];

  return (
    <Badge variant="secondary" className={`${color} flex items-center gap-1`}>
      {icon}
      <span className="capitalize">{difficulty}</span>
    </Badge>
  );
}

function StatusBadge({
  status,
}: {
  status: "completed" | "in-progress" | "not-started";
}) {
  if (status === "completed") {
    return (
      <Badge
        variant="secondary"
        className="bg-green-500/10 text-green-700 flex items-center gap-1"
      >
        <CheckCircle2 className="h-3 w-3" />
        Completed
      </Badge>
    );
  }

  if (status === "in-progress") {
    return (
      <Badge
        variant="secondary"
        className="bg-blue-500/10 text-blue-700 flex items-center gap-1"
      >
        <PlayCircle className="h-3 w-3" />
        In Progress
      </Badge>
    );
  }

  return null;
}

export const TutorialMenu: React.FC<TutorialMenuProps> = ({
  tutorials,
  isOpen,
  onClose,
  title = "Tutorials",
  customFilter,
}) => {
  const { startTutorial } = useTutorial();
  const { completedTutorials, inProgressTutorials } = useTutorialStore();

  // ============================================================================
  // State
  // ============================================================================

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [difficultyFilter, setDifficultyFilter] = useState<
    DifficultyLevel | "all"
  >("all");
  const [completionFilter, setCompletionFilter] =
    useState<CompletionFilter>("all");

  // ============================================================================
  // Helpers
  // ============================================================================

  const getTutorialStatus = useCallback(
    (tutorialId: string): "completed" | "in-progress" | "not-started" => {
      if (completedTutorials.includes(tutorialId)) {
        return "completed";
      }
      if (inProgressTutorials.includes(tutorialId)) {
        return "in-progress";
      }
      return "not-started";
    },
    [completedTutorials, inProgressTutorials]
  );

  const isNewTutorial = useCallback((tutorial: Tutorial): boolean => {
    if (!tutorial.metadata?.createdAt) {
      return false;
    }
    // Consider tutorials created in the last 7 days as "new"
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return tutorial.metadata.createdAt > weekAgo;
  }, []);

  // ============================================================================
  // Get Available Categories
  // ============================================================================

  const categories = useMemo(() => {
    const cats = new Set<string>();
    tutorials.forEach((tutorial) => {
      if (tutorial.category) {
        cats.add(tutorial.category);
      }
    });
    return Array.from(cats).sort();
  }, [tutorials]);

  // ============================================================================
  // Filtered Tutorials
  // ============================================================================

  const filteredTutorials = useMemo(() => {
    return tutorials.filter((tutorial) => {
      // Custom filter
      if (customFilter && !customFilter(tutorial)) {
        return false;
      }

      // Search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = tutorial.title.toLowerCase().includes(query);
        const matchesDescription = tutorial.description
          ?.toLowerCase()
          .includes(query);
        const matchesTags = tutorial.tags?.some((tag) =>
          tag.toLowerCase().includes(query)
        );

        if (!matchesTitle && !matchesDescription && !matchesTags) {
          return false;
        }
      }

      // Category filter
      if (categoryFilter !== "all" && tutorial.category !== categoryFilter) {
        return false;
      }

      // Difficulty filter
      if (
        difficultyFilter !== "all" &&
        tutorial.difficulty !== difficultyFilter
      ) {
        return false;
      }

      // Completion filter
      const status = getTutorialStatus(tutorial.id);
      if (completionFilter !== "all" && status !== completionFilter) {
        return false;
      }

      return true;
    });
  }, [
    tutorials,
    customFilter,
    searchQuery,
    categoryFilter,
    difficultyFilter,
    completionFilter,
    getTutorialStatus,
  ]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleTutorialClick = useCallback(
    (tutorial: Tutorial) => {
      startTutorial(tutorial);
      onClose();
    },
    [startTutorial, onClose]
  );

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setCategoryFilter("all");
    setDifficultyFilter("all");
    setCompletionFilter("all");
  }, []);

  // ============================================================================
  // Render Helpers
  // ============================================================================

  const tutorialCard = (tutorial: Tutorial) => {
    const status = getTutorialStatus(tutorial.id);
    const isNew = isNewTutorial(tutorial);

    return (
      <Card
        key={tutorial.id}
        className="cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => handleTutorialClick(tutorial)}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <CardTitle className="text-lg flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                {tutorial.title}
                {isNew && (
                  <Badge
                    variant="secondary"
                    className="bg-blue-500/10 text-blue-700"
                  >
                    New
                  </Badge>
                )}
              </CardTitle>
              {tutorial.description && (
                <CardDescription className="mt-2">
                  {tutorial.description}
                </CardDescription>
              )}
            </div>
            <StatusBadge status={status} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <DifficultyBadge difficulty={tutorial.difficulty} />

            {tutorial.duration && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {tutorial.duration}
              </Badge>
            )}

            {tutorial.category && (
              <Badge variant="outline" className="capitalize">
                {tutorial.category}
              </Badge>
            )}

            <Badge variant="outline">
              {tutorial.steps.length}{" "}
              {tutorial.steps.length === 1 ? "step" : "steps"}
            </Badge>
          </div>

          {tutorial.learningObjectives &&
            tutorial.learningObjectives.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  You&apos;ll learn:
                </p>
                <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                  {tutorial.learningObjectives
                    .slice(0, 2)
                    .map((objective, idx) => (
                      <li key={idx}>{objective}</li>
                    ))}
                  {tutorial.learningObjectives.length > 2 && (
                    <li className="text-muted-foreground/70">
                      +{tutorial.learningObjectives.length - 2} more...
                    </li>
                  )}
                </ul>
              </div>
            )}
        </CardContent>
      </Card>
    );
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (!isOpen) {
    return null;
  }

  const hasActiveFilters =
    searchQuery !== "" ||
    categoryFilter !== "all" ||
    difficultyFilter !== "all" ||
    completionFilter !== "all";

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <CardHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="h-6 w-6 text-primary" />
              <CardTitle className="text-2xl">{title}</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close tutorial menu"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <CardDescription>
            Browse and launch interactive tutorials to learn Qontinui
          </CardDescription>
        </CardHeader>

        <Separator />

        {/* Filters */}
        <div className="flex-shrink-0 p-6 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tutorials..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              aria-label="Search tutorials"
            />
          </div>

          {/* Filter Row */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters:</span>
            </div>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger
                className="w-[180px]"
                aria-label="Filter by category"
              >
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem
                    key={category}
                    value={category}
                    className="capitalize"
                  >
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={difficultyFilter}
              onValueChange={(value) =>
                setDifficultyFilter(value as DifficultyLevel | "all")
              }
            >
              <SelectTrigger
                className="w-[180px]"
                aria-label="Filter by difficulty"
              >
                <SelectValue placeholder="Difficulty" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={completionFilter}
              onValueChange={(value) =>
                setCompletionFilter(value as CompletionFilter)
              }
            >
              <SelectTrigger
                className="w-[180px]"
                aria-label="Filter by completion status"
              >
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="not-started">Not Started</SelectItem>
                <SelectItem value="in-progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="ml-auto"
              >
                Clear Filters
              </Button>
            )}
          </div>
        </div>

        <Separator />

        {/* Tutorial List */}
        <ScrollArea className="flex-1 p-6">
          {filteredTutorials.length > 0 ? (
            <div className="space-y-4">
              {filteredTutorials.map((tutorial) => tutorialCard(tutorial))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <BookOpen className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No tutorials found</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                {hasActiveFilters
                  ? "Try adjusting your filters or search query to find tutorials."
                  : "No tutorials are available at the moment."}
              </p>
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  onClick={handleClearFilters}
                  className="mt-4"
                >
                  Clear Filters
                </Button>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Footer Stats */}
        <Separator />
        <div className="flex-shrink-0 p-4 bg-muted/50">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing {filteredTutorials.length} of {tutorials.length} tutorials
            </span>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                {completedTutorials.length} completed
              </span>
              <span className="flex items-center gap-1">
                <PlayCircle className="h-3 w-3" />
                {inProgressTutorials.length} in progress
              </span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

// ============================================================================
// Exports
// ============================================================================

export type { TutorialMenuProps, CompletionFilter };
