"use client";

import { TestTube2, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RunnerTest } from "@/components/builders/hooks/useRunnerEntity";
import { TEST_TYPE_MAP } from "../test-config";

interface TestListItemProps {
  item: RunnerTest;
}

export function TestListItem({ item }: TestListItemProps) {
  const testTypeInfo = TEST_TYPE_MAP[item.test_type];
  const TypeIcon = testTypeInfo?.icon || TestTube2;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <TypeIcon className={`size-3.5 flex-shrink-0 ${
          item.test_type === "python_script" ? "text-emerald-400" :
          item.test_type === "qontinui_vision" ? "text-purple-400" :
          item.test_type === "repository_test" ? "text-orange-400" :
          "text-muted-foreground"
        }`} />
        <div className="font-semibold text-foreground truncate">
          {item.name}
        </div>
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {item.description}
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <Badge
          variant="outline"
          className={`text-[10px] px-1.5 py-0 ${testTypeInfo?.badgeClasses || ""}`}
        >
          {testTypeInfo?.label || item.test_type}
        </Badge>
        {item.tags && item.tags.length > 0 && (
          <div className="flex items-center gap-0.5">
            <Tag className="size-2.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">
              {item.tags.length}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
