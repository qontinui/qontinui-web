"use client";

import { useState, useMemo } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  MousePointer,
  Eye,
  EyeOff,
  Search,
  ExternalLink,
  Image as ImageIcon,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import type {
  PlaywrightExtractionJob,
  PlaywrightExtractionResults,
} from "@/hooks/use-playwright-extraction";
import type { PlaywrightClickable } from "@/lib/runner-client";

interface PlaywrightResultsViewProps {
  job: PlaywrightExtractionJob;
  results?: PlaywrightExtractionResults | null;
}

function getRiskIcon(risk: string) {
  switch (risk.toLowerCase()) {
    case "safe":
      return <ShieldCheck className="h-4 w-4 text-green-500" />;
    case "caution":
      return <Shield className="h-4 w-4 text-yellow-500" />;
    case "dangerous":
      return <ShieldAlert className="h-4 w-4 text-orange-500" />;
    case "blocked":
      return <ShieldX className="h-4 w-4 text-red-500" />;
    default:
      return <Shield className="h-4 w-4 text-muted-foreground" />;
  }
}

function getRiskBadgeVariant(
  risk: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (risk.toLowerCase()) {
    case "safe":
      return "default";
    case "caution":
      return "secondary";
    case "dangerous":
    case "blocked":
      return "destructive";
    default:
      return "outline";
  }
}

type ExtractionMetrics = NonNullable<PlaywrightExtractionResults["metrics"]>;

function MetricsCard({ metrics }: { metrics: ExtractionMetrics | undefined }) {
  if (!metrics) {
    return null;
  }
  return (
    <Card className="border-cyan-500/30 bg-cyan-500/5">
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-medium text-cyan-400">
          Extraction Metrics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <p className="text-2xl font-bold">{metrics.total_found}</p>
            <p className="text-xs text-muted-foreground">Total Elements</p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold text-green-500">
              {metrics.clicked}
            </p>
            <p className="text-xs text-muted-foreground">Clicked</p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold text-yellow-500">
              {metrics.skipped_dangerous}
            </p>
            <p className="text-xs text-muted-foreground">Skipped (Safety)</p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-bold text-blue-500">
              {metrics.pages_visited}
            </p>
            <p className="text-xs text-muted-foreground">Pages Visited</p>
          </div>
        </div>

        {metrics.verified !== undefined && (
          <>
            <div className="my-4 border-t border-border" />
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Verification Rate</span>
                <span className="font-medium">
                  {metrics.total_found > 0
                    ? ((metrics.verified / metrics.total_found) * 100).toFixed(1)
                    : 0}%
                </span>
              </div>
              <Progress
                value={metrics.total_found > 0
                  ? (metrics.verified / metrics.total_found) * 100
                  : 0}
                className="h-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="text-green-500">
                  {metrics.verified} verified
                </span>
                <span className="text-red-500">{metrics.unverified || 0} unverified</span>
              </div>
            </div>
          </>
        )}

        {metrics.errors > 0 && (
          <div className="mt-4 flex items-center gap-2 text-red-500">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">{metrics.errors} errors encountered</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ElementImage({ element }: { element: PlaywrightClickable }) {
  if (!element.screenshot) {
    return (
      <div className="w-16 h-16 bg-muted rounded flex items-center justify-center">
        <ImageIcon className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="w-16 h-16 rounded overflow-hidden border border-border hover:border-primary transition-colors">
          <img
            src={`data:image/png;base64,${element.screenshot}`}
            alt={element.text || element.selector}
            className="w-full h-full object-contain"
          />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {element.text || element.aria_label || element.selector}
          </DialogTitle>
        </DialogHeader>
        <div className="flex justify-center">
          <img
            src={`data:image/png;base64,${element.screenshot}`}
            alt={element.text || element.selector}
            className="max-h-[60vh] object-contain"
          />
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Selector</p>
            <p className="font-mono text-xs break-all">{element.selector}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Bounding Box</p>
            <p className="font-mono text-xs">
              {element.bounding_box.x}, {element.bounding_box.y} (
              {element.bounding_box.width}x{element.bounding_box.height})
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ElementsTable({
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
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch =
          el.text?.toLowerCase().includes(searchLower) ||
          el.aria_label?.toLowerCase().includes(searchLower) ||
          el.selector.toLowerCase().includes(searchLower) ||
          el.tag_name.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      // Verification filter
      if (filterVerified === "verified" && !el.verified) return false;
      if (filterVerified === "unverified" && el.verified) return false;

      // Risk filter
      if (filterRisk !== "all" && el.risk_level?.toLowerCase() !== filterRisk)
        return false;

      return true;
    });
  }, [elements, search, filterVerified, filterRisk]);

  return (
    <div className="space-y-4">
      {/* Filters */}
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

      {/* Table */}
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
                  <ElementImage element={element} />
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
                    <Badge variant={getRiskBadgeVariant(element.risk_level || "unknown")}>
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
                      {((element.verification_confidence || 0) * 100).toFixed(0)}%
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

type SkippedElement = NonNullable<PlaywrightExtractionResults["skipped_dangerous"]>[number];

function SkippedElementsList({
  elements,
}: {
  elements: SkippedElement[];
}) {
  const [expandedUrls, setExpandedUrls] = useState<Set<string>>(new Set());

  // Group by URL
  const groupedByUrl = useMemo(() => {
    const groups: Record<string, SkippedElement[]> = {};
    for (const el of elements) {
      if (!groups[el.url]) {
        groups[el.url] = [];
      }
      groups[el.url]!.push(el);
    }
    return groups;
  }, [elements]);

  const toggleUrl = (url: string) => {
    setExpandedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  return (
    <ScrollArea className="h-[500px]">
      <div className="space-y-2">
        {Object.entries(groupedByUrl).map(([url, urlElements]) => (
          <Collapsible
            key={url}
            open={expandedUrls.has(url)}
            onOpenChange={() => toggleUrl(url)}
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-between font-normal h-auto py-2"
              >
                <div className="flex items-center gap-2 text-left">
                  {expandedUrls.has(url) ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span className="truncate max-w-[400px]">{url}</span>
                </div>
                <Badge variant="secondary">{urlElements.length}</Badge>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pl-6 space-y-1">
              {urlElements.map((el, i) => (
                <div
                  key={`${el.selector}-${i}`}
                  className="p-2 rounded-md bg-muted/50 text-sm space-y-1"
                >
                  <div className="flex items-center gap-2">
                    {getRiskIcon(el.risk)}
                    <Badge variant={getRiskBadgeVariant(el.risk)}>
                      {el.risk}
                    </Badge>
                    <span className="text-muted-foreground truncate">
                      {el.text || "(no text)"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{el.reason}</p>
                  <p className="text-xs font-mono text-muted-foreground truncate">
                    {el.selector}
                  </p>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    </ScrollArea>
  );
}

function PagesVisitedList({ pages }: { pages: string[] }) {
  return (
    <ScrollArea className="h-[300px]">
      <div className="space-y-1">
        {pages.map((url, i) => (
          <div
            key={`${url}-${i}`}
            className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50"
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-500 hover:underline truncate"
            >
              {url}
            </a>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function ErrorsList({ errors }: { errors: string[] }) {
  return (
    <ScrollArea className="h-[300px]">
      <div className="space-y-2">
        {errors.map((error, i) => (
          <div
            key={i}
            className="p-2 rounded-md bg-red-500/10 border border-red-500/30"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

export function PlaywrightResultsView({ job, results }: PlaywrightResultsViewProps) {
  // Show progress when job is running
  if (job.status === "running" || job.status === "pending") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        <p className="text-muted-foreground">
          {job.progress_message || `Extraction ${job.status}...`}
        </p>
        {job.progress_percent !== undefined && (
          <Progress value={job.progress_percent} className="w-64" />
        )}
      </div>
    );
  }

  if (!results) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No results available</p>
      </div>
    );
  }

  const clickables = results.clickables || [];
  const skipped_dangerous = results.skipped_dangerous || [];
  const metrics = results.metrics;
  const pages_visited = results.pages_visited || [];
  const errors = results.errors || [];

  return (
    <div className="space-y-4">
      {/* Metrics Summary */}
      <MetricsCard metrics={metrics} />

      {/* Results Tabs */}
      <Tabs defaultValue="elements" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="elements" className="flex items-center gap-1">
            <Eye className="h-4 w-4" />
            Elements
            <Badge variant="secondary" className="ml-1">
              {clickables.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="skipped" className="flex items-center gap-1">
            <ShieldAlert className="h-4 w-4" />
            Skipped
            <Badge variant="secondary" className="ml-1">
              {skipped_dangerous.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="pages" className="flex items-center gap-1">
            <ExternalLink className="h-4 w-4" />
            Pages
            <Badge variant="secondary" className="ml-1">
              {pages_visited.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="errors" className="flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />
            Errors
            {errors.length > 0 && (
              <Badge variant="destructive" className="ml-1">
                {errors.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="elements" className="mt-4">
          <ElementsTable elements={clickables} />
        </TabsContent>

        <TabsContent value="skipped" className="mt-4">
          {skipped_dangerous.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <ShieldCheck className="h-12 w-12 mb-4" />
              <p>No elements were skipped due to safety rules</p>
            </div>
          ) : (
            <SkippedElementsList elements={skipped_dangerous} />
          )}
        </TabsContent>

        <TabsContent value="pages" className="mt-4">
          <PagesVisitedList pages={pages_visited} />
        </TabsContent>

        <TabsContent value="errors" className="mt-4">
          {errors.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mb-4 text-green-500" />
              <p>No errors encountered during extraction</p>
            </div>
          ) : (
            <ErrorsList errors={errors} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
