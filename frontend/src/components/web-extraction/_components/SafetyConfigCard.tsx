"use client";

import { Plus, X, ShieldAlert, ShieldCheck, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { PlaywrightExtractionConfigState } from "@/hooks/use-playwright-extraction";
import { useKeywordListManager } from "../_hooks/useKeywordListManager";
import {
  DEFAULT_DANGEROUS_KEYWORDS,
  DEFAULT_SAFE_KEYWORDS,
} from "../playwright-collector-constants";

interface SafetyConfigCardProps {
  config: PlaywrightExtractionConfigState;
  updateConfig: (updates: Partial<PlaywrightExtractionConfigState>) => void;
}

export function SafetyConfigCard({
  config,
  updateConfig,
}: SafetyConfigCardProps) {
  const dangerous = useKeywordListManager({
    currentList: config.dangerousKeywords,
    onUpdate: (list) => updateConfig({ dangerousKeywords: list }),
  });

  const safe = useKeywordListManager({
    currentList: config.safeKeywords,
    onUpdate: (list) => updateConfig({ safeKeywords: list }),
  });

  const selectors = useKeywordListManager({
    currentList: config.blockedSelectors,
    onUpdate: (list) => updateConfig({ blockedSelectors: list }),
    normalize: (v) => v.trim(),
  });

  return (
    <Card className="border-red-500/30 bg-red-500/5">
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-medium text-red-400 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          Safety Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
              value={dangerous.inputValue}
              onChange={(e) => dangerous.setInputValue(e.target.value)}
              onKeyDown={dangerous.handleKeyDown}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={dangerous.handleAdd}
              disabled={dangerous.isAddDisabled}
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
                      onClick={() => dangerous.handleRemove(keyword)}
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
              value={safe.inputValue}
              onChange={(e) => safe.setInputValue(e.target.value)}
              onKeyDown={safe.handleKeyDown}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={safe.handleAdd}
              disabled={safe.isAddDisabled}
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
                      onClick={() => safe.handleRemove(keyword)}
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

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            Additional Blocked CSS Selectors
          </Label>
          <div className="flex gap-2">
            <Input
              placeholder='e.g., [data-testid="delete-btn"]'
              value={selectors.inputValue}
              onChange={(e) => selectors.setInputValue(e.target.value)}
              onKeyDown={selectors.handleKeyDown}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={selectors.handleAdd}
              disabled={selectors.isAddDisabled}
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
                    onClick={() => selectors.handleRemove(selector)}
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
  );
}
