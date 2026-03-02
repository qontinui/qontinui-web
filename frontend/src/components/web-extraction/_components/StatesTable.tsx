import { useState, useMemo } from "react";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { UIBridgeDiscoveredState } from "@/hooks/useUIBridgeExploration";

export function StatesTable({ states }: { states: UIBridgeDiscoveredState[] }) {
  const [search, setSearch] = useState("");

  const filteredStates = useMemo(() => {
    if (!search) return states;
    const searchLower = search.toLowerCase();
    return states.filter(
      (s) =>
        s.name.toLowerCase().includes(searchLower) ||
        s.id.toLowerCase().includes(searchLower)
    );
  }, [states, search]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search states..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <ScrollArea className="h-[400px] rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-24">Images</TableHead>
              <TableHead className="w-32">Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredStates.map((state) => (
              <TableRow key={state.id}>
                <TableCell>
                  <div className="space-y-1">
                    <p className="font-medium">{state.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {state.id}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {state.state_image_ids.length}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress
                      value={state.confidence * 100}
                      className="h-2 w-16"
                    />
                    <span className="text-sm">
                      {(state.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      <p className="text-xs text-muted-foreground text-center">
        Showing {filteredStates.length} of {states.length} states
      </p>
    </div>
  );
}
