"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TargetUrlCardProps {
  url: string;
  onUrlChange: (url: string) => void;
  isValidUrl: (url: string) => boolean;
}

export function TargetUrlCard({
  url,
  onUrlChange,
  isValidUrl,
}: TargetUrlCardProps) {
  return (
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
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            className={!url || isValidUrl(url) ? "" : "border-red-500"}
          />
        </div>
      </CardContent>
    </Card>
  );
}
