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
import type { FindSettings } from "@/types/project-settings";

interface FindTabProps {
  find: FindSettings;
  onUpdate: (key: keyof FindSettings, value: number) => void;
}

export function FindTab({ find, onUpdate }: FindTabProps) {
  return (
    <Card className="border-border-default bg-surface-raised">
      <CardHeader>
        <CardTitle className="text-brand-primary">
          Find Action Settings
        </CardTitle>
        <CardDescription>
          Default parameters for find operations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Default Timeout (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="100"
              value={find.default_timeout}
              onChange={(e) =>
                onUpdate("default_timeout", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Maximum time for find operations
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Default Retry Count
            </Label>
            <Input
              type="number"
              min="0"
              max="10"
              value={find.default_retry_count}
              onChange={(e) =>
                onUpdate("default_retry_count", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Number of find retries (0 = no retries)
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Search Interval (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={find.search_interval}
              onChange={(e) =>
                onUpdate("search_interval", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Delay between search attempts
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
