"use client";

import { useState } from "react";
import {
  Plus,
  X,
  Play,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Loader2,
  Eye,
  Info,
  ChevronDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  usePlaywrightExtractionConfig,
  type PlaywrightExtractionConfigState,
} from "@/hooks/use-playwright-extraction";

// Re-export the type for backwards compatibility
export type PlaywrightCollectorConfigState = PlaywrightExtractionConfigState;

// Default dangerous keywords (from safety.py)
const DEFAULT_DANGEROUS_KEYWORDS = [
  "delete",
  "remove",
  "erase",
  "destroy",
  "purge",
  "deactivate",
  "close account",
  "cancel subscription",
  "unsubscribe",
  "terminate",
  "revoke",
  "permanent",
  "cannot be undone",
  "irreversible",
  "purchase",
  "buy now",
  "pay",
  "checkout",
  "place order",
  "confirm payment",
  "submit order",
  "add to cart",
  "logout",
  "log out",
  "sign out",
  "disconnect",
  "clear all",
  "reset",
  "factory reset",
  "wipe",
];

// Default safe keywords
const DEFAULT_SAFE_KEYWORDS = [
  "view",
  "see",
  "show",
  "open",
  "expand",
  "collapse",
  "details",
  "more",
  "less",
  "next",
  "previous",
  "back",
  "menu",
  "nav",
  "tab",
  "home",
  "about",
  "help",
  "info",
  "search",
  "filter",
  "sort",
];

interface PlaywrightCollectorConfigProps {
  onStartExtraction: (config: PlaywrightCollectorConfigState) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export function PlaywrightCollectorConfig({
  onStartExtraction,
  isLoading = false,
  disabled = false,
}: PlaywrightCollectorConfigProps) {
  // Use the persistence hook for config state
  const { config, updateConfig, isLoaded } = usePlaywrightExtractionConfig();

  const [newDangerousKeyword, setNewDangerousKeyword] = useState("");
  const [newSafeKeyword, setNewSafeKeyword] = useState("");
  const [newBlockedSelector, setNewBlockedSelector] = useState("");

  const handleAddDangerousKeyword = () => {
    if (
      newDangerousKeyword.trim() &&
      !config.dangerousKeywords.includes(newDangerousKeyword.trim())
    ) {
      updateConfig({
        dangerousKeywords: [
          ...config.dangerousKeywords,
          newDangerousKeyword.trim().toLowerCase(),
        ],
      });
      setNewDangerousKeyword("");
    }
  };

  const handleRemoveDangerousKeyword = (keyword: string) => {
    updateConfig({
      dangerousKeywords: config.dangerousKeywords.filter((k) => k !== keyword),
    });
  };

  const handleAddSafeKeyword = () => {
    if (
      newSafeKeyword.trim() &&
      !config.safeKeywords.includes(newSafeKeyword.trim())
    ) {
      updateConfig({
        safeKeywords: [
          ...config.safeKeywords,
          newSafeKeyword.trim().toLowerCase(),
        ],
      });
      setNewSafeKeyword("");
    }
  };

  const handleRemoveSafeKeyword = (keyword: string) => {
    updateConfig({
      safeKeywords: config.safeKeywords.filter((k) => k !== keyword),
    });
  };

  const handleAddBlockedSelector = () => {
    if (
      newBlockedSelector.trim() &&
      !config.blockedSelectors.includes(newBlockedSelector.trim())
    ) {
      updateConfig({
        blockedSelectors: [
          ...config.blockedSelectors,
          newBlockedSelector.trim(),
        ],
      });
      setNewBlockedSelector("");
    }
  };

  const handleRemoveBlockedSelector = (selector: string) => {
    updateConfig({
      blockedSelectors: config.blockedSelectors.filter((s) => s !== selector),
    });
  };

  const handleStartExtraction = () => {
    if (!config.url.trim()) return;
    onStartExtraction(config);
  };

  const isValidUrl = (url: string) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  // Show loading state while config is being loaded from localStorage
  if (!isLoaded) {
    return (
      <div className="space-y-4 pb-6">
        <Card className="border-cyan-500/30 bg-cyan-500/5 animate-pulse">
          <CardHeader className="py-3">
            <div className="h-4 w-24 bg-cyan-500/20 rounded" />
          </CardHeader>
          <CardContent>
            <div className="h-10 w-full bg-cyan-500/10 rounded" />
          </CardContent>
        </Card>
        <Card className="border-purple-500/30 bg-purple-500/5 animate-pulse">
          <CardHeader className="py-3">
            <div className="h-4 w-32 bg-purple-500/20 rounded" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-10 w-full bg-purple-500/10 rounded" />
            <div className="h-10 w-full bg-purple-500/10 rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-6">
      {/* Target URL */}
      <Card className="border-cyan-500/30 bg-cyan-500/5">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium text-cyan-400">
            Target URL
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="url" className="text-xs text-muted-foreground">
              Enter the URL to extract clickable elements from
            </Label>
            <Input
              id="url"
              type="url"
              placeholder="https://example.com"
              value={config.url}
              onChange={(e) => updateConfig({ url: e.target.value })}
              className={
                !config.url || isValidUrl(config.url) ? "" : "border-red-500"
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Extraction Options */}
      <Card className="border-purple-500/30 bg-purple-500/5">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium text-purple-400">
            Extraction Options
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label
                htmlFor="maxDepth"
                className="text-xs text-muted-foreground"
              >
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
            <Label
              htmlFor="riskLevel"
              className="text-xs text-muted-foreground"
            >
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
                        <strong>No existing patterns required</strong> -
                        patterns are created automatically from the extracted
                        elements.
                      </p>
                      <p className="text-xs mt-2 text-muted-foreground">
                        This helps filter out elements that may be too generic
                        or visually ambiguous for reliable automation.
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

      {/* Safety Configuration */}
      <Card className="border-red-500/30 bg-red-500/5">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium text-red-400 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            Safety Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Dangerous Keywords */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Dangerous Keywords (will be blocked)
            </Label>
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between text-xs h-8"
                >
                  <span className="flex items-center gap-2">
                    <ShieldAlert className="h-3 w-3 text-red-500" />
                    View {DEFAULT_DANGEROUS_KEYWORDS.length} default blocked
                    keywords
                  </span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ScrollArea className="h-24 mt-2 rounded-md border border-red-500/20 bg-red-500/5 p-2">
                  <div className="flex flex-wrap gap-1">
                    {DEFAULT_DANGEROUS_KEYWORDS.map((keyword) => (
                      <Badge
                        key={keyword}
                        variant="outline"
                        className="text-xs bg-red-500/10 text-red-400 border-red-500/30"
                      >
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                </ScrollArea>
              </CollapsibleContent>
            </Collapsible>
            <div className="flex gap-2">
              <Input
                placeholder="Add custom keyword to block..."
                value={newDangerousKeyword}
                onChange={(e) => setNewDangerousKeyword(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && handleAddDangerousKeyword()
                }
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleAddDangerousKeyword}
                disabled={!newDangerousKeyword.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {config.dangerousKeywords.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Custom blocked keywords:
                </p>
                <ScrollArea className="h-20">
                  <div className="flex flex-wrap gap-1">
                    {config.dangerousKeywords.map((keyword) => (
                      <Badge
                        key={keyword}
                        variant="destructive"
                        className="text-xs cursor-pointer hover:bg-destructive/80"
                        onClick={() => handleRemoveDangerousKeyword(keyword)}
                      >
                        {keyword}
                        <X className="h-3 w-3 ml-1" />
                      </Badge>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>

          {/* Safe Keywords */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Safe Keywords (will be allowed)
            </Label>
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between text-xs h-8"
                >
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-3 w-3 text-green-500" />
                    View {DEFAULT_SAFE_KEYWORDS.length} default safe keywords
                  </span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ScrollArea className="h-24 mt-2 rounded-md border border-green-500/20 bg-green-500/5 p-2">
                  <div className="flex flex-wrap gap-1">
                    {DEFAULT_SAFE_KEYWORDS.map((keyword) => (
                      <Badge
                        key={keyword}
                        variant="outline"
                        className="text-xs bg-green-500/10 text-green-400 border-green-500/30"
                      >
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                </ScrollArea>
              </CollapsibleContent>
            </Collapsible>
            <div className="flex gap-2">
              <Input
                placeholder="Add custom safe keyword..."
                value={newSafeKeyword}
                onChange={(e) => setNewSafeKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddSafeKeyword()}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleAddSafeKeyword}
                disabled={!newSafeKeyword.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {config.safeKeywords.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Custom safe keywords:
                </p>
                <ScrollArea className="h-20">
                  <div className="flex flex-wrap gap-1">
                    {config.safeKeywords.map((keyword) => (
                      <Badge
                        key={keyword}
                        variant="secondary"
                        className="text-xs cursor-pointer hover:bg-secondary/80 bg-green-500/20 text-green-400"
                        onClick={() => handleRemoveSafeKeyword(keyword)}
                      >
                        {keyword}
                        <X className="h-3 w-3 ml-1" />
                      </Badge>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>

          {/* Blocked Selectors */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Additional Blocked CSS Selectors
            </Label>
            <div className="flex gap-2">
              <Input
                placeholder='e.g., [data-testid="delete-btn"]'
                value={newBlockedSelector}
                onChange={(e) => setNewBlockedSelector(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && handleAddBlockedSelector()
                }
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleAddBlockedSelector}
                disabled={!newBlockedSelector.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {config.blockedSelectors.length > 0 && (
              <ScrollArea className="h-20">
                <div className="flex flex-wrap gap-1">
                  {config.blockedSelectors.map((selector) => (
                    <Badge
                      key={selector}
                      variant="outline"
                      className="text-xs cursor-pointer hover:bg-muted font-mono"
                      onClick={() => handleRemoveBlockedSelector(selector)}
                    >
                      {selector}
                      <X className="h-3 w-3 ml-1" />
                    </Badge>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Start Button */}
      <Button
        className="w-full"
        size="lg"
        onClick={handleStartExtraction}
        disabled={
          disabled || isLoading || !config.url.trim() || !isValidUrl(config.url)
        }
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Extracting...
          </>
        ) : (
          <>
            <Play className="h-4 w-4 mr-2" />
            Start State Collection
          </>
        )}
      </Button>

      {config.maxRiskLevel !== "dry_run" && (
        <p className="text-xs text-yellow-500 text-center">
          Warning: The collector will click on elements. Use &quot;Dry Run&quot;
          mode for safe exploration.
        </p>
      )}
    </div>
  );
}
