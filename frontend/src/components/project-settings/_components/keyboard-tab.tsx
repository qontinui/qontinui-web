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
import type { KeyboardSettings } from "@/types/project-settings";

interface KeyboardTabProps {
  keyboard: KeyboardSettings;
  onUpdate: (key: keyof KeyboardSettings, value: number) => void;
}

export function KeyboardTab({ keyboard, onUpdate }: KeyboardTabProps) {
  return (
    <Card className="border-border-default bg-surface-raised">
      <CardHeader>
        <CardTitle className="text-brand-primary">
          Keyboard Action Timing
        </CardTitle>
        <CardDescription>
          Default timing parameters for keyboard actions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Key Hold Duration (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={keyboard.key_hold_duration}
              onChange={(e) =>
                onUpdate("key_hold_duration", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              How long to hold key during press
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Key Release Delay (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={keyboard.key_release_delay}
              onChange={(e) =>
                onUpdate("key_release_delay", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">Delay after releasing key</p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Typing Interval (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={keyboard.typing_interval}
              onChange={(e) =>
                onUpdate("typing_interval", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Delay between typed characters
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Hotkey Hold Duration (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={keyboard.hotkey_hold_duration}
              onChange={(e) =>
                onUpdate("hotkey_hold_duration", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">Duration for hotkey holds</p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-text-muted">
              Hotkey Press Interval (ms)
            </Label>
            <Input
              type="number"
              min="0"
              step="10"
              value={keyboard.hotkey_press_interval}
              onChange={(e) =>
                onUpdate("hotkey_press_interval", Number(e.target.value))
              }
              className="bg-transparent border-border-default"
            />
            <p className="text-xs text-text-muted">
              Interval between hotkey presses
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
