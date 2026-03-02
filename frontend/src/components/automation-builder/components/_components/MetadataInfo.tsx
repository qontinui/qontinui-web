import React from "react";
import type { LibraryItem } from "../../types";

interface MetadataInfoProps {
  item: LibraryItem;
  isLinear: boolean;
}

export function MetadataInfo({ item, isLinear }: MetadataInfoProps) {
  return (
    <div className="mt-6 pt-6 border-t border-border-subtle">
      <div className="text-xs text-text-muted space-y-1">
        <div>
          <span className="font-medium">ID:</span> {item.id}
        </div>
        <div>
          <span className="font-medium">Format:</span> {item.format}
        </div>
        <div>
          <span className="font-medium">Version:</span> {item.version}
        </div>
        {item.metadata?.created && (
          <div>
            <span className="font-medium">Created:</span>{" "}
            {new Date(item.metadata.created).toLocaleDateString()}
          </div>
        )}
        {item.metadata?.updated && (
          <div>
            <span className="font-medium">Updated:</span>{" "}
            {new Date(item.metadata.updated).toLocaleDateString()}
          </div>
        )}
        <div>
          <span className="font-medium">Actions:</span> {item.actions.length}
        </div>
        <div>
          <span className="font-medium">Type:</span>{" "}
          {isLinear ? "Linear (no branching)" : "Graph (branching)"}
        </div>
      </div>
    </div>
  );
}
