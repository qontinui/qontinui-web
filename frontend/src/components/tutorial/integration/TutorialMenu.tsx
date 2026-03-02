import React, { useCallback } from "react";
import { Award, X } from "lucide-react";
import { useTutorial } from "./TutorialProvider";
import type { Tutorial } from "@/types/tutorial";
import type { TutorialMenuProps } from "./_types/tutorial-menu";
import { useTutorialFilters } from "./_hooks/useTutorialFilters";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { TutorialCard } from "./_components/TutorialCard";
import { TutorialFilterBar } from "./_components/TutorialFilterBar";
import { TutorialEmptyState } from "./_components/TutorialEmptyState";
import { TutorialFooter } from "./_components/TutorialFooter";

export const TutorialMenu: React.FC<TutorialMenuProps> = ({
  tutorials,
  isOpen,
  onClose,
  title = "Tutorials",
  customFilter,
}) => {
  const { startTutorial } = useTutorial();

  const {
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    difficultyFilter,
    setDifficultyFilter,
    completionFilter,
    setCompletionFilter,
    categories,
    filteredTutorials,
    hasActiveFilters,
    handleClearFilters,
    getTutorialStatus,
    isNewTutorial,
    completedTutorials,
    inProgressTutorials,
  } = useTutorialFilters(tutorials, customFilter);

  const handleTutorialClick = useCallback(
    (tutorial: Tutorial) => {
      startTutorial(tutorial);
      onClose();
    },
    [startTutorial, onClose]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] flex flex-col">
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

        <TutorialFilterBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          categoryFilter={categoryFilter}
          onCategoryChange={setCategoryFilter}
          difficultyFilter={difficultyFilter}
          onDifficultyChange={setDifficultyFilter}
          completionFilter={completionFilter}
          onCompletionChange={setCompletionFilter}
          categories={categories}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={handleClearFilters}
        />

        <Separator />

        <ScrollArea className="flex-1 p-6">
          {filteredTutorials.length > 0 ? (
            <div className="space-y-4">
              {filteredTutorials.map((tutorial) => (
                <TutorialCard
                  key={tutorial.id}
                  tutorial={tutorial}
                  status={getTutorialStatus(tutorial.id)}
                  isNew={isNewTutorial(tutorial)}
                  onClick={handleTutorialClick}
                />
              ))}
            </div>
          ) : (
            <TutorialEmptyState
              hasActiveFilters={hasActiveFilters}
              onClearFilters={handleClearFilters}
            />
          )}
        </ScrollArea>

        <Separator />

        <TutorialFooter
          filteredCount={filteredTutorials.length}
          totalCount={tutorials.length}
          completedCount={completedTutorials.length}
          inProgressCount={inProgressTutorials.length}
        />
      </Card>
    </div>
  );
};

export type {
  TutorialMenuProps,
  CompletionFilter,
} from "./_types/tutorial-menu";
