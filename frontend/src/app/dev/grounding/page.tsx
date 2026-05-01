"use client";

/**
 * Grounding Data Gallery — dev-only page that renders UI primitives in
 * multiple states for the static grounding-data capture pipeline.
 *
 * The Playwright script (scripts/capture-grounding-data.ts) navigates here,
 * screenshots each viewport, and extracts element bboxes via
 * getBoundingClientRect() for grounding-model training data.
 *
 * Gated: only renders in development or when NEXT_PUBLIC_GROUNDING_GALLERY=true.
 */

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

function Section({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <section data-component={name} className="space-y-3">
      <h2 className="text-lg font-semibold">{name}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

export default function GroundingGalleryPage() {
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
    <div className="min-h-screen bg-background p-8 text-foreground">
      <h1 className="mb-8 text-2xl font-bold">Grounding Data Gallery</h1>

      <div className="space-y-10">
        {/* Buttons */}
        <Section name="Button">
          <Button variant="default">Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </Section>

        {/* Badges */}
        <Section name="Badge">
          <Badge variant="default">Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="info">Info</Badge>
        </Section>

        {/* Input */}
        <Section name="Input">
          <Input placeholder="Default input" className="w-64" />
          <Input placeholder="Disabled" disabled className="w-64" />
          <Input type="password" placeholder="Password" className="w-64" />
          <Input placeholder="Invalid" aria-invalid="true" className="w-64" />
        </Section>

        {/* Textarea */}
        <Section name="Textarea">
          <Textarea placeholder="Enter text..." className="w-64" />
          <Textarea placeholder="Disabled" disabled className="w-64" />
        </Section>

        {/* Select */}
        <Section name="Select">
          <Select>
            <SelectTrigger className="w-48" data-component="SelectTrigger">
              <SelectValue placeholder="Choose..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">Option A</SelectItem>
              <SelectItem value="b">Option B</SelectItem>
              <SelectItem value="c">Option C</SelectItem>
            </SelectContent>
          </Select>
        </Section>

        {/* Checkbox */}
        <Section name="Checkbox">
          <div className="flex items-center gap-2">
            <Checkbox id="cb-default" />
            <Label htmlFor="cb-default">Default</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="cb-checked" defaultChecked />
            <Label htmlFor="cb-checked">Checked</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="cb-disabled" disabled />
            <Label htmlFor="cb-disabled">Disabled</Label>
          </div>
        </Section>

        {/* Switch */}
        <Section name="Switch">
          <div className="flex items-center gap-2">
            <Switch id="sw-off" />
            <Label htmlFor="sw-off">Off</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="sw-on" defaultChecked />
            <Label htmlFor="sw-on">On</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="sw-disabled" disabled />
            <Label htmlFor="sw-disabled">Disabled</Label>
          </div>
        </Section>

        {/* Toggle */}
        <Section name="Toggle">
          <Toggle aria-label="Bold">Bold</Toggle>
          <Toggle aria-label="Italic" defaultPressed>
            Italic
          </Toggle>
          <Toggle aria-label="Disabled" disabled>
            Disabled
          </Toggle>
        </Section>

        {/* Slider */}
        <Section name="Slider">
          <Slider defaultValue={[50]} max={100} className="w-64" />
          <Slider defaultValue={[25, 75]} max={100} className="w-64" />
        </Section>

        {/* Progress */}
        <Section name="Progress">
          <Progress value={0} className="w-64" />
          <Progress value={45} className="w-64" />
          <Progress value={100} className="w-64" />
        </Section>

        {/* Tabs */}
        <Section name="Tabs">
          <Tabs defaultValue="tab1" className="w-80">
            <TabsList>
              <TabsTrigger value="tab1">Account</TabsTrigger>
              <TabsTrigger value="tab2">Settings</TabsTrigger>
              <TabsTrigger value="tab3">Billing</TabsTrigger>
            </TabsList>
            <TabsContent value="tab1">
              <p className="text-sm text-muted-foreground">
                Account settings content.
              </p>
            </TabsContent>
            <TabsContent value="tab2">
              <p className="text-sm text-muted-foreground">
                General settings content.
              </p>
            </TabsContent>
            <TabsContent value="tab3">
              <p className="text-sm text-muted-foreground">
                Billing settings content.
              </p>
            </TabsContent>
          </Tabs>
        </Section>

        {/* Card */}
        <Section name="Card">
          <Card className="w-80">
            <CardHeader>
              <CardTitle>Card Title</CardTitle>
              <CardDescription>Card description text.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm">Card body content goes here.</p>
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button variant="outline" size="sm">
                Cancel
              </Button>
              <Button size="sm">Save</Button>
            </CardFooter>
          </Card>
        </Section>

        {/* Separator */}
        <Section name="Separator">
          <div className="w-64 space-y-2">
            <p className="text-sm">Above separator</p>
            <Separator />
            <p className="text-sm">Below separator</p>
          </div>
        </Section>

        {/* Label */}
        <Section name="Label">
          <div className="space-y-2">
            <Label htmlFor="label-demo">Form Label</Label>
            <Input id="label-demo" placeholder="Associated input" />
          </div>
        </Section>
      </div>
    </div>
  );
}
