import { Card, CardContent } from "@/components/ui/card";
import type { FindingsSummaryView } from "@/lib/task-run-mappers";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-red-500",
  high: "text-orange-500",
  medium: "text-yellow-500",
  low: "text-blue-400",
};

interface FindingsSummaryCardsProps {
  data: FindingsSummaryView;
}

export function FindingsSummaryCards({ data }: FindingsSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <Card className="bg-muted">
        <CardContent className="pt-6 text-center">
          <div
            className="text-3xl font-bold text-foreground"
            data-content-role="metric"
            data-content-label="total-findings"
          >
            {data.total}
          </div>
          <div
            className="text-xs text-muted-foreground mt-1"
            data-content-role="label"
          >
            Total
          </div>
        </CardContent>
      </Card>
      {(["critical", "high", "medium", "low"] as const).map((severity) => {
        const count = data.by_severity[severity] || 0;
        return (
          <Card key={severity} className="bg-muted">
            <CardContent className="pt-6 text-center">
              <div
                className={`text-3xl font-bold ${SEVERITY_COLORS[severity]}`}
                data-content-role="metric"
                data-content-label={`${severity}-findings-count`}
              >
                {count}
              </div>
              <div
                className="text-xs text-muted-foreground mt-1 capitalize"
                data-content-role="label"
              >
                {severity}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
