import { CheckCircle2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { UIBridgeExplorationStep } from "@/hooks/useUIBridgeExploration";

export function StepsTable({ steps }: { steps: UIBridgeExplorationStep[] }) {
  return (
    <ScrollArea className="h-[400px] rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Element</TableHead>
            <TableHead className="w-24">Action</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead className="w-24">State Changed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {steps.map((step, idx) => (
            <TableRow key={step.step_id}>
              <TableCell className="font-mono text-muted-foreground">
                {idx + 1}
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <p className="font-mono text-sm truncate max-w-[250px]">
                    {step.element_id}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Depth: {step.depth}
                  </p>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{step.action}</Badge>
              </TableCell>
              <TableCell>
                {step.success ? (
                  <Badge variant="default" className="bg-green-500">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Success
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <XCircle className="h-3 w-3 mr-1" />
                    Failed
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                {step.state_changed ? (
                  <Badge variant="default" className="bg-blue-500">
                    Yes
                  </Badge>
                ) : (
                  <Badge variant="outline">No</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
