/**
 * Single element type entry with a colored badge and description.
 */

import { Badge } from "@/components/ui/badge";
import type { ElementTypeItemData } from "./annotation-guidelines-data";

export function ElementTypeItem({
  type,
  description,
  color,
}: ElementTypeItemData) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Badge
        variant="outline"
        className="shrink-0 min-w-[100px] justify-center"
        style={color ? { borderColor: color, color } : undefined}
      >
        {type}
      </Badge>
      <span className="text-sm text-text-secondary">{description}</span>
    </div>
  );
}
