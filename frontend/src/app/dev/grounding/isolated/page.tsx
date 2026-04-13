"use client";

/**
 * Grounding Data Isolated Renderer — dev-only page that renders a single UI
 * component at an arbitrary position against a configurable backdrop.
 *
 * Designed for the synthetic grounding-data capture pipeline: Playwright
 * navigates here with varying URL params, screenshots the viewport, and
 * records the component bbox for training data.
 *
 * URL params:
 *   component  - Button | Badge | Input | Textarea | Select | Checkbox |
 *                Switch | Toggle | Slider | Progress | Tabs | Card |
 *                Separator | Label
 *   variant    - component-specific variant string
 *   state      - enabled | disabled | checked | pressed
 *   size       - sm | default | lg
 *   theme      - light | dark
 *   bg         - solid-{color} | gradient-{name} | noise
 *   left       - 0-100 (percentage)
 *   top        - 0-100 (percentage)
 *
 * Gated: only renders in development or when NEXT_PUBLIC_GROUNDING_GALLERY=true.
 */

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";

const ENABLED =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_GROUNDING_GALLERY === "true";

// ---------------------------------------------------------------------------
// Background resolution
// ---------------------------------------------------------------------------

const BG_MAP: Record<string, string> = {
  // Solid colors
  "solid-blue": "#3b82f6",
  "solid-red": "#ef4444",
  "solid-green": "#22c55e",
  "solid-purple": "#a855f7",
  "solid-orange": "#f97316",
  "solid-yellow": "#eab308",
  "solid-pink": "#ec4899",
  "solid-teal": "#14b8a6",
  "solid-gray": "#6b7280",
  "solid-white": "#ffffff",
  "solid-black": "#000000",
  "solid-slate": "#64748b",
  "solid-zinc": "#71717a",
  "solid-stone": "#78716c",
  "solid-neutral": "#737373",
  "solid-indigo": "#6366f1",
  "solid-violet": "#8b5cf6",
  "solid-fuchsia": "#d946ef",
  "solid-rose": "#f43f5e",
  "solid-cyan": "#06b6d4",
  "solid-emerald": "#10b981",
  "solid-lime": "#84cc16",
  "solid-amber": "#f59e0b",
  "solid-sky": "#0ea5e9",
  // Gradients
  "gradient-purple-blue": "linear-gradient(135deg, #a855f7 0%, #3b82f6 100%)",
  "gradient-red-orange": "linear-gradient(135deg, #ef4444 0%, #f97316 100%)",
  "gradient-green-teal": "linear-gradient(135deg, #22c55e 0%, #14b8a6 100%)",
  "gradient-pink-purple": "linear-gradient(135deg, #ec4899 0%, #a855f7 100%)",
  "gradient-blue-cyan": "linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)",
  "gradient-dark": "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
};

function resolveBackground(bg: string): React.CSSProperties {
  if (bg === "noise") {
    // SVG-based noise pattern encoded as a data URI
    const noiseSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='200' height='200' filter='url(%23n)' opacity='0.4'/></svg>`;
    return {
      backgroundColor: "#1e293b",
      backgroundImage: `url("data:image/svg+xml,${noiseSvg}")`,
      backgroundRepeat: "repeat",
    };
  }

  const resolved = BG_MAP[bg];
  if (!resolved) {
    return { backgroundColor: "#f1f5f9" };
  }

  if (resolved.startsWith("linear-gradient")) {
    return { backgroundImage: resolved };
  }

  return { backgroundColor: resolved };
}

// ---------------------------------------------------------------------------
// Component renderers
// ---------------------------------------------------------------------------

type ComponentName =
  | "Button"
  | "Badge"
  | "Input"
  | "Textarea"
  | "Select"
  | "Checkbox"
  | "Switch"
  | "Toggle"
  | "Slider"
  | "Progress"
  | "Tabs"
  | "Card"
  | "Separator"
  | "Label";

interface RenderParams {
  variant: string;
  state: string;
  size: string;
}

function renderComponent(name: ComponentName, params: RenderParams): React.ReactNode {
  const disabled = params.state === "disabled";
  const checked = params.state === "checked";
  const pressed = params.state === "pressed";
  const variant = params.variant || "default";
  const size = params.size || "default";

  switch (name) {
    case "Button": {
      type ButtonVariant =
        | "default"
        | "secondary"
        | "destructive"
        | "outline"
        | "ghost"
        | "link"
        | "brand-primary"
        | "brand-secondary"
        | "brand-success"
        | "success"
        | "warning"
        | "info";
      type ButtonSize = "default" | "sm" | "lg" | "icon";
      const btnVariant: ButtonVariant =
        (["default","secondary","destructive","outline","ghost","link","brand-primary","brand-secondary","brand-success","success","warning","info"] as const).includes(variant as ButtonVariant)
          ? (variant as ButtonVariant)
          : "default";
      const btnSize: ButtonSize =
        (["default","sm","lg","icon"] as const).includes(size as ButtonSize)
          ? (size as ButtonSize)
          : "default";
      return (
        <Button variant={btnVariant} size={btnSize} disabled={disabled}>
          {variant.charAt(0).toUpperCase() + variant.slice(1)} Button
        </Button>
      );
    }

    case "Badge": {
      type BadgeVariant =
        | "default"
        | "secondary"
        | "destructive"
        | "outline"
        | "success"
        | "warning"
        | "info"
        | "brand-primary"
        | "brand-secondary"
        | "brand-success";
      const badgeVariant: BadgeVariant =
        (["default","secondary","destructive","outline","success","warning","info","brand-primary","brand-secondary","brand-success"] as const).includes(variant as BadgeVariant)
          ? (variant as BadgeVariant)
          : "default";
      return <Badge variant={badgeVariant}>{variant.charAt(0).toUpperCase() + variant.slice(1)}</Badge>;
    }

    case "Input":
      return (
        <Input
          placeholder={disabled ? "Disabled input" : "Sample input"}
          disabled={disabled}
          type={variant === "password" ? "password" : "text"}
          aria-invalid={variant === "invalid" ? "true" : undefined}
          className="w-64"
        />
      );

    case "Textarea":
      return (
        <Textarea
          placeholder={disabled ? "Disabled textarea" : "Enter text here..."}
          disabled={disabled}
          className="w-64"
        />
      );

    case "Select":
      return (
        <Select disabled={disabled}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Choose option..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">Option A</SelectItem>
            <SelectItem value="b">Option B</SelectItem>
            <SelectItem value="c">Option C</SelectItem>
          </SelectContent>
        </Select>
      );

    case "Checkbox":
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id="grounding-checkbox"
            defaultChecked={checked}
            disabled={disabled}
          />
          <Label htmlFor="grounding-checkbox">
            {checked ? "Checked" : "Unchecked"}
          </Label>
        </div>
      );

    case "Switch":
      return (
        <div className="flex items-center gap-2">
          <Switch
            id="grounding-switch"
            defaultChecked={checked}
            disabled={disabled}
          />
          <Label htmlFor="grounding-switch">
            {checked ? "On" : "Off"}
          </Label>
        </div>
      );

    case "Toggle": {
      type ToggleVariant = "default" | "outline";
      const toggleVariant: ToggleVariant =
        variant === "outline" ? "outline" : "default";
      return (
        <Toggle
          variant={toggleVariant}
          defaultPressed={pressed}
          disabled={disabled}
          aria-label="Toggle"
        >
          Toggle
        </Toggle>
      );
    }

    case "Slider":
      return (
        <Slider
          defaultValue={[50]}
          max={100}
          disabled={disabled}
          className="w-64"
        />
      );

    case "Progress": {
      const progressValue =
        variant === "empty" ? 0 : variant === "full" ? 100 : 45;
      return <Progress value={progressValue} className="w-64" />;
    }

    case "Tabs":
      return (
        <Tabs defaultValue="tab1" className="w-72">
          <TabsList>
            <TabsTrigger value="tab1">Account</TabsTrigger>
            <TabsTrigger value="tab2">Settings</TabsTrigger>
            <TabsTrigger value="tab3">Billing</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">
            <p className="text-sm text-muted-foreground">Account content.</p>
          </TabsContent>
          <TabsContent value="tab2">
            <p className="text-sm text-muted-foreground">Settings content.</p>
          </TabsContent>
          <TabsContent value="tab3">
            <p className="text-sm text-muted-foreground">Billing content.</p>
          </TabsContent>
        </Tabs>
      );

    case "Card":
      return (
        <Card className="w-72">
          <CardHeader>
            <CardTitle>Card Title</CardTitle>
            <CardDescription>Card description text.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm">Card body content.</p>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" size="sm">Cancel</Button>
            <Button size="sm">Save</Button>
          </CardFooter>
        </Card>
      );

    case "Separator":
      return (
        <div className="w-64 space-y-2">
          <p className="text-sm">Above</p>
          <Separator />
          <p className="text-sm">Below</p>
        </div>
      );

    case "Label":
      return (
        <div className="space-y-1">
          <Label htmlFor="grounding-label-input">Form Label</Label>
          <Input id="grounding-label-input" placeholder="Associated input" />
        </div>
      );

    default:
      return (
        <div className="rounded border p-3 text-sm text-muted-foreground">
          Unknown component: {name}
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Inner page (uses useSearchParams — must be inside Suspense)
// ---------------------------------------------------------------------------

const VALID_COMPONENTS: ComponentName[] = [
  "Button","Badge","Input","Textarea","Select","Checkbox",
  "Switch","Toggle","Slider","Progress","Tabs","Card","Separator","Label",
];

function IsolatedPageInner() {
  const params = useSearchParams();

  const componentParam = params.get("component") ?? "Button";
  const variant = params.get("variant") ?? "default";
  const state = params.get("state") ?? "enabled";
  const size = params.get("size") ?? "default";
  const theme = params.get("theme") ?? "light";
  const bg = params.get("bg") ?? "solid-white";
  const left = parseFloat(params.get("left") ?? "50");
  const top = parseFloat(params.get("top") ?? "50");

  const componentName: ComponentName = VALID_COMPONENTS.includes(componentParam as ComponentName)
    ? (componentParam as ComponentName)
    : "Button";

  const bgStyles = resolveBackground(bg);

  const rendered = renderComponent(componentName, { variant, state, size });

  return (
    <div
      className={theme === "dark" ? "dark" : ""}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        ...bgStyles,
      }}
    >
      <div
        data-grounding-target="true"
        data-component-type={componentName}
        data-component-variant={variant}
        style={{
          position: "absolute",
          left: `${Math.max(0, Math.min(100, left))}%`,
          top: `${Math.max(0, Math.min(100, top))}%`,
          transform: "translate(-50%, -50%)",
        }}
      >
        {rendered}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default export — gated + Suspense boundary for useSearchParams
// ---------------------------------------------------------------------------

export default function GroundingIsolatedPage() {
  if (!ENABLED) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">
          Grounding gallery disabled. Set NEXT_PUBLIC_GROUNDING_GALLERY=true.
        </p>
      </div>
    );
  }

  return (
    <Suspense fallback={null}>
      <IsolatedPageInner />
    </Suspense>
  );
}
