"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { RecognitionSettings } from "@/types/project-settings";

interface RecognitionTabProps {
  recognition: RecognitionSettings;
  onUpdate: (
    key: keyof RecognitionSettings,
    value: number | string | boolean
  ) => void;
}

export function RecognitionTab({ recognition, onUpdate }: RecognitionTabProps) {
  return (
    <Card className="border-border-default bg-surface-raised">
      <CardHeader>
        <CardTitle className="text-brand-primary">
          Recognition Settings
        </CardTitle>
        <CardDescription>
          Image recognition and matching configuration
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Minimum Similarity (0.0-1.0)
            </Label>
            <Input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={recognition.default_threshold}
              onChange={(e) =>
                onUpdate("default_threshold", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Minimum similarity threshold for image matching
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">Color Space</Label>
            <Select
              value={recognition.color_space}
              onValueChange={(value) => onUpdate("color_space", value)}
            >
              <SelectTrigger className="bg-transparent border-border-default">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-surface-raised border-border-default">
                <SelectItem value="rgb">RGB</SelectItem>
                <SelectItem value="grayscale">Grayscale</SelectItem>
                <SelectItem value="hsv">HSV</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-text-muted">
              Color space for image processing
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-text-muted">
                Multi-Scale Search
              </Label>
              <Switch
                checked={recognition.multi_scale_search}
                onCheckedChange={(checked) =>
                  onUpdate("multi_scale_search", checked)
                }
              />
            </div>
            <p className="text-xs text-text-muted">
              Search at multiple scales (experimental)
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-text-muted">Edge Detection</Label>
              <Switch
                checked={recognition.edge_detection}
                onCheckedChange={(checked) =>
                  onUpdate("edge_detection", checked)
                }
              />
            </div>
            <p className="text-xs text-text-muted">
              Use edge detection for matching
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-text-muted">OCR Enabled</Label>
              <Switch
                checked={recognition.ocr_enabled}
                onCheckedChange={(checked) => onUpdate("ocr_enabled", checked)}
              />
            </div>
            <p className="text-xs text-text-muted">
              Enable optical character recognition
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
