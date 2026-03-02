import { Badge } from "@/components/ui/badge";
import type { ShellCommandItem } from "@/services/library-service";
import { inferCategory } from "../constants";

export function ShellCommandListItem({ item, isSelected }: { item: ShellCommandItem; isSelected: boolean }) {
  const category = inferCategory(item);
  const CategoryIcon = category.icon;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <CategoryIcon className={`size-4 shrink-0 ${item.enabled ? category.color : "text-muted-foreground"}`} />
        <span className={`text-sm font-medium truncate ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
          {item.name}
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-6">
        <Badge
          variant="secondary"
          className={`text-[10px] px-1.5 ${category.bgColor} ${category.color}`}
        >
          {category.label}
        </Badge>
        {item.platform && item.platform !== "any" && (
          <Badge variant="secondary" className="text-[10px] px-1.5">
            {item.platform}
          </Badge>
        )}
        <Badge variant="secondary" className={`text-[10px] px-1.5 ${item.enabled ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"}`}>
          {item.enabled ? "enabled" : "disabled"}
        </Badge>
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground truncate pl-6">{item.description}</p>
      )}
    </div>
  );
}
