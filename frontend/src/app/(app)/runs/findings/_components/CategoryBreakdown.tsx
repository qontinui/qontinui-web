import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tag } from "lucide-react";

interface CategoryBreakdownProps {
  byCategory: Record<string, number>;
  categoryFilter: string;
  onCategoryFilterChange: (category: string) => void;
}

export function CategoryBreakdown({
  byCategory,
  categoryFilter,
  onCategoryFilterChange,
}: CategoryBreakdownProps) {
  if (Object.keys(byCategory).length === 0) return null;

  return (
    <Card className="bg-muted">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Tag className="size-4" />
          Categories
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {Object.entries(byCategory).map(([category, count]) => (
            <Badge
              key={category}
              variant="outline"
              className="cursor-pointer hover:bg-muted"
              onClick={() =>
                onCategoryFilterChange(
                  categoryFilter === category ? "all" : category
                )
              }
            >
              {category}: {count as number}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
