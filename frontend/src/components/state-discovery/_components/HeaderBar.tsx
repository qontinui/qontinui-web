"use client";

/**
 * Header bar for the State Discovery tab.
 * Contains title and Save/Export action buttons.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, Download } from "lucide-react";
import type { HeaderBarProps } from "../state-discovery-types";

const HeaderBar: React.FC<HeaderBarProps> = ({
  onSaveStructure,
  analysisResult,
  filteredStateImagesCount,
  isFilterActive,
}) => {
  return (
    <div className="flex items-center justify-between p-4 border-b">
      <h2 className="text-2xl font-bold">State Discovery</h2>
      <div className="flex gap-2">
        <Button
          onClick={onSaveStructure}
          disabled={!analysisResult || filteredStateImagesCount === 0}
          variant={isFilterActive ? "secondary" : "default"}
        >
          <Save className="mr-2 h-4 w-4" />
          Save Structure
          {isFilterActive && (
            <Badge variant="outline" className="ml-1 text-xs">
              Filtered
            </Badge>
          )}
        </Button>
        <Button variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </div>
    </div>
  );
};

export default HeaderBar;
