import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Clock, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import type { TaskRunView } from "@/lib/task-run-mappers";
import type { Stats } from "../types";
import { formatDuration } from "../types";

interface RecentRunsTableProps {
  runs: TaskRunView[];
  stats: Stats;
}

export function RecentRunsTable({ runs, stats }: RecentRunsTableProps) {
  const router = useRouter();

  return (
    <Card className="bg-muted border-border">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="size-4" />
          Recent Runs
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>vs Avg</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.slice(0, 15).map((run: TaskRunView) => {
                const diff =
                  run.duration_seconds != null
                    ? run.duration_seconds - stats.avgDuration
                    : null;
                return (
                  <TableRow
                    key={run.id}
                    className="border-border hover:bg-muted/50 cursor-pointer"
                    onClick={() => router.push(`/runs/${run.id}`)}
                  >
                    <TableCell className="font-medium text-foreground">
                      {run.task_name}
                    </TableCell>
                    <TableCell>
                      {run.status === "completed" ? (
                        <Badge variant="success">Completed</Badge>
                      ) : run.status === "failed" ? (
                        <Badge variant="destructive">Failed</Badge>
                      ) : run.status === "running" ? (
                        <Badge variant="info">Running</Badge>
                      ) : (
                        <Badge variant="secondary">{run.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDuration(run.duration_seconds)}
                    </TableCell>
                    <TableCell>
                      {diff != null ? (
                        <span
                          className={`text-xs ${
                            diff > 0 ? "text-red-400" : "text-green-400"
                          }`}
                        >
                          {diff > 0 ? "+" : ""}
                          {formatDuration(diff)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
