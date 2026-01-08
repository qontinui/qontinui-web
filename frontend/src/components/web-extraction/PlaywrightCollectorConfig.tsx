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

export interface PlaywrightCollectorConfigState {
  url: string;
  maxDepth: number;
  maxElementsPerPage: number;
  maxRiskLevel: "safe" | "caution";
  dryRun: boolean;
  verifyExtractions: boolean;
  verificationThreshold: number;
  dangerousKeywords: string[];
  safeKeywords: string[];
  blockedSelectors: string[];
}

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
  const [config, setConfig] = useState<PlaywrightCollectorConfigState>({
    url: "",
    maxDepth: 2,
    maxElementsPerPage: 50,
    maxRiskLevel: "safe",
    dryRun: true,
    verifyExtractions: true,
    verificationThreshold: 0.85,
    dangerousKeywords: [],
    safeKeywords: [],
    blockedSelectors: [],
  });

  const [newDangerousKeyword, setNewDangerousKeyword] = useState("");
  const [newSafeKeyword, setNewSafeKeyword] = useState("");
  const [newBlockedSelector, setNewBlockedSelector] = useState("");

  const handleAddDangerousKeyword = () => {
    if (
      newDangerousKeyword.trim() &&
      !config.dangerousKeywords.includes(newDangerousKeyword.trim())
    ) {
      setConfig((prev) => ({
        ...prev,
        dangerousKeywords: [
          ...prev.dangerousKeywords,
          newDangerousKeyword.trim().toLowerCase(),
        ],
      }));
      setNewDangerousKeyword("");
    }
  };

  const handleRemoveDangerousKeyword = (keyword: string) => {
    setConfig((prev) => ({
      ...prev,
      dangerousKeywords: prev.dangerousKeywords.filter((k) => k !== keyword),
    }));
  };

  const handleAddSafeKeyword = () => {
    if (
      newSafeKeyword.trim() &&
      !config.safeKeywords.includes(newSafeKeyword.trim())
    ) {
      setConfig((prev) => ({
        ...prev,
        safeKeywords: [
          ...prev.safeKeywords,
          newSafeKeyword.trim().toLowerCase(),
        ],
      }));
      setNewSafeKeyword("");
    }
  };

  const handleRemoveSafeKeyword = (keyword: string) => {
    setConfig((prev) => ({
      ...prev,
      safeKeywords: prev.safeKeywords.filter((k) => k !== keyword),
    }));
  };

  const handleAddBlockedSelector = () => {
    if (
      newBlockedSelector.trim() &&
      !config.blockedSelectors.includes(newBlockedSelector.trim())
    ) {
      setConfig((prev) => ({
        ...prev,
        blockedSelectors: [...prev.blockedSelectors, newBlockedSelector.trim()],
      }));
      setNewBlockedSelector("");
    }
  };

  const handleRemoveBlockedSelector = (selector: string) => {
    setConfig((prev) => ({
      ...prev,
      blockedSelectors: prev.blockedSelectors.filter((s) => s !== selector),
    }));
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

  return (
    <div className="space-y-4">
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
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, url: e.target.value }))
              }
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
                  setConfig((prev) => ({
                    ...prev,
                    maxDepth: parseInt(e.target.value) || 0,
                  }))
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
                  setConfig((prev) => ({
                    ...prev,
                    maxElementsPerPage: parseInt(e.target.value) || 50,
                  }))
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="riskLevel"
              className="text-xs text-muted-foreground"
            >
              Maximum Risk Level to Auto-Click
            </Label>
            <Select
              value={config.maxRiskLevel}
              onValueChange={(value: "safe" | "caution") =>
                setConfig((prev) => ({ ...prev, maxRiskLevel: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
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
              <Label htmlFor="dryRun" className="text-sm">
                Dry Run Mode
              </Label>
              <p className="text-xs text-muted-foreground">
                Identify elements without clicking them
              </p>
            </div>
            <Switch
              id="dryRun"
              checked={config.dryRun}
              onCheckedChange={(checked) =>
                setConfig((prev) => ({ ...prev, dryRun: checked }))
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="verify" className="text-sm">
                Verify Extractions
              </Label>
              <p className="text-xs text-muted-foreground">
                Use pattern matching to verify detectability
              </p>
            </div>
            <Switch
              id="verify"
              checked={config.verifyExtractions}
              onCheckedChange={(checked) =>
                setConfig((prev) => ({ ...prev, verifyExtractions: checked }))
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
                  setConfig((prev) => ({
                    ...prev,
                    verificationThreshold: parseFloat(e.target.value),
                  }))
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
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                Additional Dangerous Keywords (will be blocked)
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-xs">
                      {DEFAULT_DANGEROUS_KEYWORDS.length} defaults
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs">
                      Default blocked:{" "}
                      {DEFAULT_DANGEROUS_KEYWORDS.slice(0, 10).join(", ")}...
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Add keyword to block..."
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
            )}
          </div>

          {/* Safe Keywords */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                Additional Safe Keywords (will be allowed)
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-xs">
                      {DEFAULT_SAFE_KEYWORDS.length} defaults
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs">
                      Default safe:{" "}
                      {DEFAULT_SAFE_KEYWORDS.slice(0, 10).join(", ")}...
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Add safe keyword..."
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

      {!config.dryRun && (
        <p className="text-xs text-yellow-500 text-center">
          Warning: Dry run is disabled. The collector will click on elements.
        </p>
      )}
    </div>
  );
}
