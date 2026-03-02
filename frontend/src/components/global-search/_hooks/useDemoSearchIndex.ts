"use client";

import { useEffect, useState } from "react";
import { globalSearchService } from "@/services/global-search-service";
import {
  mockWorkflows,
  mockStates,
  mockImages,
  mockTransitions,
  mockFolders,
} from "../_components/demo-mock-data";

export function useDemoSearchIndex() {
  const [indexLoaded, setIndexLoaded] = useState(false);

  const loadMockData = () => {
    globalSearchService.updateIndex({
      workflows: mockWorkflows,
      states: mockStates,
      images: mockImages,
      transitions: mockTransitions,
      folders: mockFolders,
    });
    setIndexLoaded(true);
  };

  useEffect(() => {
    loadMockData();
  }, []);

  const handleReset = () => {
    globalSearchService.clearIndex();
    globalSearchService.clearRecentSearches();
    setIndexLoaded(false);
    setTimeout(() => {
      loadMockData();
    }, 100);
  };

  return { indexLoaded, handleReset };
}
