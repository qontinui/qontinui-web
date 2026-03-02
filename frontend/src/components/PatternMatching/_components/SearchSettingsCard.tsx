import React from "react";
import { Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { SearchConfig } from "../_hooks/usePatternSearch";

interface SearchSettingsCardProps {
  config: SearchConfig;
}

export const SearchSettingsCard: React.FC<SearchSettingsCardProps> = ({
  config,
}) => {
  const {
    similarity,
    setSimilarity,
    findAll,
    setFindAll,
    maxMatches,
    setMaxMatches,
  } = config;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Settings className="w-4 h-4" />
          Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Similarity Threshold</Label>
            <span className="text-sm font-mono text-muted-foreground">
              {(similarity * 100).toFixed(0)}%
            </span>
          </div>
          <Slider
            value={[similarity]}
            onValueChange={(values) => setSimilarity(values[0] ?? 0.8)}
            min={0.5}
            max={1.0}
            step={0.05}
          />
          <p className="text-xs text-muted-foreground">
            Higher values require closer matches
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm">Find All Matches</Label>
            <p className="text-xs text-muted-foreground">
              Find multiple occurrences
            </p>
          </div>
          <Switch checked={findAll} onCheckedChange={setFindAll} />
        </div>

        {findAll && (
          <div className="space-y-2">
            <Label className="text-sm">Max Matches</Label>
            <Input
              type="number"
              value={maxMatches}
              onChange={(e) => setMaxMatches(Number(e.target.value))}
              min={1}
              max={1000}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};
