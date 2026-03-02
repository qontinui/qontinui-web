import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Eye, Monitor, Globe } from "lucide-react";
import { Arrow } from "./components";

interface FlowDef {
  title: string;
  icon: React.ReactNode;
  steps: Array<{
    label: string;
    variant?: "outline" | "secondary" | "default";
    className?: string;
  }>;
  arrows: string[];
}

const FLOWS: FlowDef[] = [
  {
    title: "Pattern Matching Flow",
    icon: <Eye className="w-4 h-4" />,
    steps: [
      { label: "Frontend", variant: "outline" },
      { label: "Runner HTTP", variant: "secondary" },
      { label: "Python Bridge", variant: "default" },
      { label: "OpenCV", variant: "outline", className: "bg-green-500/10" },
    ],
    arrows: ["POST /pattern/find", "IPC: pattern_find", "cv2.matchTemplate"],
  },
  {
    title: "Screenshot Capture Flow",
    icon: <Monitor className="w-4 h-4" />,
    steps: [
      { label: "Frontend", variant: "outline" },
      { label: "Runner HTTP", variant: "secondary" },
      { label: "Python Bridge", variant: "default" },
      {
        label: "qontinui HAL",
        variant: "outline",
        className: "bg-blue-500/10",
      },
    ],
    arrows: [
      "POST /capture-screenshot",
      "IPC: capture_screenshot",
      "HAL.capture()",
    ],
  },
  {
    title: "Web Extraction (Playwright) Flow",
    icon: <Globe className="w-4 h-4" />,
    steps: [
      { label: "Frontend", variant: "outline" },
      { label: "Runner HTTP", variant: "secondary" },
      { label: "Python Bridge", variant: "default" },
      { label: "Browser", variant: "outline", className: "bg-purple-500/10" },
    ],
    arrows: [
      "POST /playwright-collection/start",
      "IPC: start_playwright_collection",
      "Playwright API",
    ],
  },
];

const FlowRow: React.FC<{ flow: FlowDef }> = ({ flow }) => {
  return (
    <div>
      <h4 className="font-semibold mb-4 flex items-center gap-2">
        {flow.icon}
        {flow.title}
      </h4>
      <div className="flex items-center justify-center gap-4 flex-wrap">
        {flow.steps.map((step, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Arrow label={flow.arrows[i - 1]} />}
            <Badge
              variant={step.variant === "default" ? undefined : step.variant}
              className={`px-4 py-2 ${step.className ?? ""}`}
            >
              {step.label}
            </Badge>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export const DataFlowTab: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowRight className="w-5 h-5" />
          Data Flow Examples
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          How data flows through the system for common operations.
        </p>
      </CardHeader>
      <CardContent className="space-y-8">
        {FLOWS.map((flow, i) => (
          <FlowRow key={i} flow={flow} />
        ))}
      </CardContent>
    </Card>
  );
};
