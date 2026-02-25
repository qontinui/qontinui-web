"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Treemap,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { ProjectData } from "../_lib/types";

const TreemapContent = ({
  x,
  y,
  width,
  height,
  index,
  name,
  count,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  name?: string;
  count?: number;
}) => {
  if (!x || !y || !width || !height) return null;
  const colors = [
    "var(--brand-primary)",
    "var(--brand-secondary)",
    "var(--brand-success)",
    "var(--warning)",
    "var(--error)",
    "var(--text-muted)",
  ];
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill: colors[(index || 0) % colors.length],
          fillOpacity: 0.9,
          stroke: "var(--surface-raised)",
          strokeWidth: 2,
        }}
      />
      {width > 60 && height > 30 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 6}
            textAnchor="middle"
            fill="#000"
            fontSize={12}
            fontWeight="600"
          >
            {name}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 10}
            textAnchor="middle"
            fill="#000"
            fontSize={10}
          >
            {count} images
          </text>
        </>
      )}
    </g>
  );
};

const TOOLTIP_STYLE = {
  backgroundColor: "var(--surface-raised)",
  border: "1px solid var(--border-default)",
  borderRadius: "8px",
};

interface ResourceOverviewTabsProps {
  data: ProjectData;
}

export function ResourceOverviewTabs({ data }: ResourceOverviewTabsProps) {
  return (
    <Tabs defaultValue="workflows" className="w-full">
      <TabsList className="grid w-full grid-cols-4 bg-surface-hover/30">
        <TabsTrigger value="workflows">Workflows</TabsTrigger>
        <TabsTrigger value="states">States</TabsTrigger>
        <TabsTrigger value="images">Images</TabsTrigger>
        <TabsTrigger value="transitions">Transitions</TabsTrigger>
      </TabsList>

      <TabsContent value="workflows" className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader>
              <CardTitle className="text-sm">By Complexity</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <RechartsPieChart>
                  <Pie
                    data={data.workflowsByComplexity}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="count"
                  >
                    {data.workflowsByComplexity.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </RechartsPieChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-1 text-xs">
                {data.workflowsByComplexity.map((item) => (
                  <div
                    key={item.range}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: item.fill }}
                      />
                      <span className="text-text-muted">{item.range}</span>
                    </div>
                    <span className="font-medium">{item.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader>
              <CardTitle className="text-sm">By Folder</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.workflowsByFolder}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="name"
                    stroke="#666"
                    style={{ fontSize: "10px" }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis stroke="#666" style={{ fontSize: "10px" }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {data.workflowsByFolder.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="states" className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader>
              <CardTitle className="text-sm">By Group</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <RechartsPieChart>
                  <Pie
                    data={data.statesByGroup}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="count"
                  >
                    {data.statesByGroup.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </RechartsPieChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-1 text-xs">
                {data.statesByGroup.map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: item.fill }}
                      />
                      <span className="text-text-muted">{item.name}</span>
                    </div>
                    <span className="font-medium">{item.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader>
              <CardTitle className="text-sm">Distribution Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-text-muted">Avg Images per State</span>
                  <span className="font-medium">3.2</span>
                </div>
                <Progress value={64} className="h-2" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-text-muted">
                    Avg Transitions per State
                  </span>
                  <span className="font-medium">1.4</span>
                </div>
                <Progress value={28} className="h-2" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-text-muted">States with Regions</span>
                  <span className="font-medium">67%</span>
                </div>
                <Progress value={67} className="h-2" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-text-muted">States with Locations</span>
                  <span className="font-medium">54%</span>
                </div>
                <Progress value={54} className="h-2" />
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="images" className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader>
              <CardTitle className="text-sm">By Folder (Treemap)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <Treemap
                  data={data.imagesByFolder}
                  dataKey="size"
                  stroke="var(--surface-raised)"
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  content={TreemapContent as any}
                />
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader>
              <CardTitle className="text-sm">Usage Statistics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-text-muted">Used in Workflows</span>
                  <span className="font-medium">67%</span>
                </div>
                <Progress value={67} className="h-2" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-text-muted">Used in States</span>
                  <span className="font-medium">81%</span>
                </div>
                <Progress value={81} className="h-2" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-text-muted">Unused Images</span>
                  <span className="font-medium text-yellow-500">13%</span>
                </div>
                <Progress value={13} className="h-2" />
              </div>
              <Separator />
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-text-muted">Total Storage</span>
                  <span className="font-medium">723.2 MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Avg Image Size</span>
                  <span className="font-medium">582 KB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Largest Image</span>
                  <span className="font-medium">4.7 MB</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="transitions" className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader>
              <CardTitle className="text-sm">By Type</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <RechartsPieChart>
                  <Pie
                    data={data.transitionsByType}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="count"
                  >
                    {data.transitionsByType.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </RechartsPieChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-1 text-xs">
                {data.transitionsByType.map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: item.fill }}
                      />
                      <span className="text-text-muted">{item.name}</span>
                    </div>
                    <span className="font-medium">{item.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader>
              <CardTitle className="text-sm">Transition Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-text-muted">Avg Timeout (s)</span>
                  <span className="font-medium">15.3</span>
                </div>
                <Progress value={51} className="h-2" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-text-muted">With Workflows</span>
                  <span className="font-medium">89%</span>
                </div>
                <Progress value={89} className="h-2" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-text-muted">Complex Transitions</span>
                  <span className="font-medium">23%</span>
                </div>
                <Progress value={23} className="h-2" />
              </div>
              <Separator />
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-text-muted">Max Retry Count</span>
                  <span className="font-medium">5</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Avg States Activated</span>
                  <span className="font-medium">2.3</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>
    </Tabs>
  );
}
