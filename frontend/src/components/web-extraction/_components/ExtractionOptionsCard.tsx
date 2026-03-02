"use client";

import { Eye, Shield, ShieldCheck, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PlaywrightExtractionConfigState } from "@/hooks/use-playwright-extraction";

interface ExtractionOptionsCardProps {
  config: PlaywrightExtractionConfigState;
  updateConfig: (updates: Partial<PlaywrightExtractionConfigState>) => void;
}

export function ExtractionOptionsCard({
  config,
  updateConfig,
}: ExtractionOptionsCardProps) {
  return (
    <Card className="border-purple-500/30 bg-purple-500/5">
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-medium text-purple-400">
          Extraction Options
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="maxDepth" className="text-xs text-muted-foreground">
              Max Click Depth
            </Label>
            <Input
              id="maxDepth"
              type="number"
              min={0}
              max={5}
              value={config.maxDepth}
              onChange={(e) =>
                updateConfig({ maxDepth: parseInt(e.target.value) || 0 })
              }
            />
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="maxElements"
              className="text-xs text-muted-foreground"
            >
              Max Elements Per Page
            </Label>
            <Input
              id="maxElements"
              type="number"
              min={1}
              max={200}
              value={config.maxElementsPerPage}
              onChange={(e) =>
                updateConfig({
                  maxElementsPerPage: parseInt(e.target.value) || 50,
                })
              }
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="riskLevel" className="text-xs text-muted-foreground">
            Extraction Mode
          </Label>
          <Select
            value={config.maxRiskLevel}
            onValueChange={(value: "dry_run" | "safe" | "caution") =>
              updateConfig({ maxRiskLevel: value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dry_run">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-blue-500" />
                  Dry Run (Identify Only, No Clicking)
                </div>
              </SelectItem>
              <SelectItem value="safe">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-green-500" />
                  Safe Only (Navigation, View, Menu)
                </div>
              </SelectItem>
              <SelectItem value="caution">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-yellow-500" />
                  Caution (Includes Edit, Change)
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="verify" className="text-sm">
                Verify Extractions
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="text-xs">
                      <strong>How it works:</strong> Each extracted element is
                      captured as an image, then pattern matching searches for
                      it in the full page screenshot. Elements that can be
                      reliably found are marked as &quot;verified&quot;.
                    </p>
                    <p className="text-xs mt-2">
                      <strong>No existing patterns required</strong> - patterns
                      are created automatically from the extracted elements.
                    </p>
                    <p className="text-xs mt-2 text-muted-foreground">
                      This helps filter out elements that may be too generic or
                      visually ambiguous for reliable automation.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-xs text-muted-foreground">
              Use pattern matching to verify detectability
            </p>
          </div>
          <Switch
            id="verify"
            checked={config.verifyExtractions}
            onCheckedChange={(checked) =>
              updateConfig({ verifyExtractions: checked })
            }
          />
        </div>

        {config.verifyExtractions && (
          <div className="space-y-2">
            <Label
              htmlFor="threshold"
              className="text-xs text-muted-foreground"
            >
              Verification Threshold:{" "}
              {(config.verificationThreshold * 100).toFixed(0)}%
            </Label>
            <Input
              id="threshold"
              type="range"
              min={0.5}
              max={1}
              step={0.05}
              value={config.verificationThreshold}
              onChange={(e) =>
                updateConfig({
                  verificationThreshold: parseFloat(e.target.value),
                })
              }
              className="h-2"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
