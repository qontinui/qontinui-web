import { useState, useMemo } from "react";
import {
  CheckCircle2,
  XCircle,
  MousePointer,
  EyeOff,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

import type { PlaywrightClickable } from "@/lib/runner-client";
import { getRiskIcon, getRiskBadgeVariant } from "../playwright-results-utils";
import { PlaywrightElementImage } from "./PlaywrightElementImage";

export function PlaywrightElementsTable({
  elements,
}: {
  elements: PlaywrightClickable[];
}) {
  const [search, setSearch] = useState("");
  const [filterVerified, setFilterVerified] = useState<
    "all" | "verified" | "unverified"
  >("all");
  const [filterRisk, _setFilterRisk] = useState<string>("all");

  const filteredElements = useMemo(() => {
    return elements.filter((el) => {
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch =
          el.text?.toLowerCase().includes(searchLower) ||
          el.aria_label?.toLowerCase().includes(searchLower) ||
          el.selector.toLowerCase().includes(searchLower) ||
          el.tag_name.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      if (filterVerified === "verified" && !el.verified) return false;
      if (filterVerified === "unverified" && el.verified) return false;

      if (filterRisk !== "all" && el.risk_level?.toLowerCase() !== filterRisk)
        return false;

      return true;
    });
  }, [elements, search, filterVerified, filterRisk]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search elements..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          <Button
            variant={filterVerified === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterVerified("all")}
          >
            All
          </Button>
          <Button
            variant={filterVerified === "verified" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterVerified("verified")}
          >
            <CheckCircle2 className="h-4 w-4 mr-1 text-green-500" />
            Verified
          </Button>
          <Button
            variant={filterVerified === "unverified" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterVerified("unverified")}
          >
            <XCircle className="h-4 w-4 mr-1 text-red-500" />
            Unverified
          </Button>
        </div>
      </div>

      <ScrollArea className="h-[500px] rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Image</TableHead>
              <TableHead>Element</TableHead>
              <TableHead className="w-24">Tag</TableHead>
              <TableHead className="w-24">Risk</TableHead>
              <TableHead className="w-24">Clicked</TableHead>
              <TableHead className="w-32">Verification</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredElements.map((element) => (
              <TableRow key={element.element_id}>
                <TableCell>
                  <PlaywrightElementImage element={element} />
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <p className="font-medium truncate max-w-[300px]">
                      {element.text || element.aria_label || "(no text)"}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono truncate max-w-[300px]">
                      {element.selector}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-mono">
                    {element.tag_name}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {getRiskIcon(element.risk_level || "unknown")}
                    <Badge
                      variant={getRiskBadgeVariant(
                        element.risk_level || "unknown"
                      )}
                    >
                      {element.risk_level || "unknown"}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>
                  {element.was_clicked ? (
                    <Badge variant="default" className="bg-green-500">
                      <MousePointer className="h-3 w-3 mr-1" />
                      Yes
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <EyeOff className="h-3 w-3 mr-1" />
                      No
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {element.verified ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span className="text-sm">
                      {((element.verification_confidence || 0) * 100).toFixed(
                        0
                      )}
                      %
                    </span>
                  </div>
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
