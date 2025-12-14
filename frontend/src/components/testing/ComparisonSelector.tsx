"use client";

import { useState } from "react";
import { useTestRuns } from "@/hooks/useTesting";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GitCompare } from "lucide-react";
import { format } from "date-fns";

interface ComparisonSelectorProps {
  projectId: string;
  onCompare: (run1Id: string, run2Id: string) => void;
}

export function ComparisonSelector({
  projectId,
  onCompare,
}: ComparisonSelectorProps) {
  const [run1Id, setRun1Id] = useState<string>("");
  const [run2Id, setRun2Id] = useState<string>("");

  const { data: runsData } = useTestRuns({
    project_id: projectId,
    page_size: 50,
    sort_by: "created_at",
    sort_order: "desc",
  });

  const runs = runsData?.items || [];

  const handleCompare = () => {
    if (run1Id && run2Id) {
      onCompare(run1Id, run2Id);
    }
  };

  const handleQuickComparison = (type: "previous" | "baseline") => {
    if (runs.length < 2) return;

    if (type === "previous") {
      // Compare most recent with second most recent
      const run1 = runs[1];
      const run2 = runs[0];
      if (run1 && run2) {
        setRun1Id(run1.id);
        setRun2Id(run2.id);
        onCompare(run1.id, run2.id);
      }
    } else if (type === "baseline") {
      // Compare most recent with oldest
      const run1 = runs[runs.length - 1];
      const run2 = runs[0];
      if (run1 && run2) {
        setRun1Id(run1.id);
        setRun2Id(run2.id);
        onCompare(run1.id, run2.id);
      }
    }
  };

  return (
    <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <GitCompare className="w-5 h-5" />
          Compare Test Runs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Baseline Run</label>
            <Select value={run1Id} onValueChange={setRun1Id}>
              <SelectTrigger className="bg-[#0A0A0B]/50 border-gray-700">
                <SelectValue placeholder="Select baseline run" />
              </SelectTrigger>
              <SelectContent>
                {runs.map((run) => (
                  <SelectItem key={run.id} value={run.id}>
                    {run.workflow_name} -{" "}
                    {format(new Date(run.start_time), "MMM dd, yyyy HH:mm")} (
                    {run.coverage_percentage.toFixed(1)}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400">Comparison Run</label>
            <Select value={run2Id} onValueChange={setRun2Id}>
              <SelectTrigger className="bg-[#0A0A0B]/50 border-gray-700">
                <SelectValue placeholder="Select comparison run" />
              </SelectTrigger>
              <SelectContent>
                {runs.map((run) => (
                  <SelectItem key={run.id} value={run.id}>
                    {run.workflow_name} -{" "}
                    {format(new Date(run.start_time), "MMM dd, yyyy HH:mm")} (
                    {run.coverage_percentage.toFixed(1)}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleCompare}
            disabled={!run1Id || !run2Id || run1Id === run2Id}
            className="bg-[#00D9FF] text-black hover:bg-[#00B8D4]"
          >
            <GitCompare className="w-4 h-4 mr-2" />
            Compare Runs
          </Button>

          {runs.length >= 2 && (
            <>
              <Button
                onClick={() => handleQuickComparison("previous")}
                variant="outline"
                className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
              >
                Compare with Previous
              </Button>

              {runs.length > 2 && (
                <Button
                  onClick={() => handleQuickComparison("baseline")}
                  variant="outline"
                  className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
                >
                  Compare with Baseline
                </Button>
              )}
            </>
          )}
        </div>

        {run1Id === run2Id && run1Id && (
          <div className="text-sm text-yellow-400 bg-yellow-500/10 p-2 rounded">
            Please select two different test runs to compare
          </div>
        )}
      </CardContent>
    </Card>
  );
}
