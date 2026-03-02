import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_OPTIONS = [
  "all",
  "identified",
  "actionable",
  "needs_input",
  "resolved",
] as const;

function formatStatusLabel(status: string): string {
  if (status === "all") return "All";
  return status.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

interface FindingsFiltersProps {
  severityFilter: string;
  onSeverityChange: (value: string) => void;
  categoryFilter: string;
  onCategoryChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  categories: string[];
}

export function FindingsFilters({
  severityFilter,
  onSeverityChange,
  categoryFilter,
  onCategoryChange,
  statusFilter,
  onStatusChange,
  categories,
}: FindingsFiltersProps) {
  return (
    <div className="flex gap-4 flex-wrap">
      <Select value={severityFilter} onValueChange={onSeverityChange}>
        <SelectTrigger className="w-[160px] bg-muted">
          <SelectValue placeholder="Severity" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Severities</SelectItem>
          <SelectItem value="critical">Critical</SelectItem>
          <SelectItem value="high">High</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="low">Low</SelectItem>
        </SelectContent>
      </Select>
      <Select value={categoryFilter} onValueChange={onCategoryChange}>
        <SelectTrigger className="w-[200px] bg-muted">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          {categories.map((cat) => (
            <SelectItem key={cat} value={cat}>
              {cat}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-1">
        {STATUS_OPTIONS.map((status) => (
          <Button
            key={status}
            variant={statusFilter === status ? "default" : "outline"}
            size="sm"
            onClick={() => onStatusChange(status)}
            className={`text-xs ${statusFilter === status ? "bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}
          >
            {formatStatusLabel(status)}
          </Button>
        ))}
      </div>
    </div>
  );
}
