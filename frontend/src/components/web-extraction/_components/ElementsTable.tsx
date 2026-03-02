import { useState, useMemo } from "react";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { UIBridgeDiscoveredElement } from "@/hooks/useUIBridgeExploration";

export function ElementsTable({
  elements,
}: {
  elements: UIBridgeDiscoveredElement[];
}) {
  const [search, setSearch] = useState("");

  const filteredElements = useMemo(() => {
    if (!search) return elements;
    const searchLower = search.toLowerCase();
    return elements.filter(
      (e) =>
        e.name.toLowerCase().includes(searchLower) ||
        e.id.toLowerCase().includes(searchLower) ||
        e.type.toLowerCase().includes(searchLower) ||
        e.tag_name?.toLowerCase().includes(searchLower) ||
        e.text_content?.toLowerCase().includes(searchLower)
    );
  }, [elements, search]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search elements..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <ScrollArea className="h-[400px] rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Element</TableHead>
              <TableHead className="w-24">Type</TableHead>
              <TableHead className="w-24">Tag</TableHead>
              <TableHead className="w-24">Renders</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredElements.map((element) => (
              <TableRow key={element.id}>
                <TableCell>
                  <div className="space-y-1">
                    <p className="font-medium truncate max-w-[300px]">
                      {element.name || element.text_content || element.id}
                    </p>
                    {element.component_name && (
                      <p className="text-xs text-muted-foreground font-mono">
                        {element.component_name}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{element.type}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="font-mono">
                    {element.tag_name || "unknown"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{element.render_ids.length}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      <p className="text-xs text-muted-foreground text-center">
        Showing {filteredElements.length} of {elements.length} elements
      </p>
    </div>
  );
}
