"use client";

import { useState } from "react";
import type { ImageAsset } from "@/contexts/automation-context";

export function useImageFilter(images: ImageAsset[]) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const imageCounts = {
    all: images.length,
    uploaded: images.filter((img) => img.source === "uploaded").length,
    pattern_optimization: images.filter(
      (img) => img.source === "pattern_optimization"
    ).length,
    image_extraction: images.filter((img) => img.source === "image_extraction")
      .length,
    state_discovery: images.filter((img) => img.source === "state_discovery")
      .length,
  };

  const filteredImages = images.filter((image) => {
    const matchesSearch = image.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesSource = !activeFilter || image.source === activeFilter;
    return matchesSearch && matchesSource;
  });

  return {
    searchQuery,
    setSearchQuery,
    activeFilter,
    setActiveFilter,
    imageCounts,
    filteredImages,
  };
}
