import { useState, useMemo, useCallback } from "react";
import { useTutorialStore } from "@/stores/tutorial-store";
import type { Tutorial, DifficultyLevel } from "@/types/tutorial";
import type { CompletionFilter, TutorialStatus } from "../_types/tutorial-menu";

export function useTutorialFilters(
  tutorials: Tutorial[],
  customFilter?: (tutorial: Tutorial) => boolean
) {
  const { completedTutorials, inProgressTutorials } = useTutorialStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [difficultyFilter, setDifficultyFilter] = useState<
    DifficultyLevel | "all"
  >("all");
  const [completionFilter, setCompletionFilter] =
    useState<CompletionFilter>("all");

  const getTutorialStatus = useCallback(
    (tutorialId: string): TutorialStatus => {
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
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return tutorial.metadata.createdAt > weekAgo;
  }, []);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    tutorials.forEach((tutorial) => {
      if (tutorial.category) {
        cats.add(tutorial.category);
      }
    });
    return Array.from(cats).sort();
  }, [tutorials]);

  const filteredTutorials = useMemo(() => {
    return tutorials.filter((tutorial) => {
      if (customFilter && !customFilter(tutorial)) {
        return false;
      }

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

      if (categoryFilter !== "all" && tutorial.category !== categoryFilter) {
        return false;
      }

      if (
        difficultyFilter !== "all" &&
        tutorial.difficulty !== difficultyFilter
      ) {
        return false;
      }

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

  const hasActiveFilters =
    searchQuery !== "" ||
    categoryFilter !== "all" ||
    difficultyFilter !== "all" ||
    completionFilter !== "all";

  const handleClearFilters = useCallback(() => {
    setSearchQuery("");
    setCategoryFilter("all");
    setDifficultyFilter("all");
    setCompletionFilter("all");
  }, []);

  return {
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
  };
}
