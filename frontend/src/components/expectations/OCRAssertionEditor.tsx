"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Trash2 } from "lucide-react";
import {
  OCRAssertion,
  OCRAssertionType,
} from "@/types/checkpoint-expectations";

export interface OCRAssertionEditorProps {
  assertion: OCRAssertion;
  onChange: (assertion: OCRAssertion) => void;
  onDelete: () => void;
}

/**
 * Editor for a single OCR assertion
 *
 * Supports different assertion types:
 * - text_present: Text must appear on screen
 * - text_absent: Text must not appear on screen
 * - no_duplicate_matches: Text should appear only once
 * - text_count: Text should appear a specific number of times
 * - text_in_region: Text must appear within a specific region
 */
export function OCRAssertionEditor({
  assertion,
  onChange,
  onDelete,
}: OCRAssertionEditorProps) {
  const updateAssertion = (updates: Partial<OCRAssertion>) => {
    onChange({ ...assertion, ...updates });
  };

  const getAssertionTypeDescription = (type: OCRAssertionType): string => {
    switch (type) {
      case "text_present":
        return "Assert that text appears on screen";
      case "text_absent":
        return "Assert that text does not appear on screen";
      case "no_duplicate_matches":
        return "Assert that text appears exactly once";
      case "text_count":
        return "Assert that text appears a specific number of times";
      case "text_in_region":
        return "Assert that text appears within a specific region";
    }
  };

  const showCountFields =
    assertion.type === "text_count" || assertion.type === "text_in_region";
  const showRegionFields = assertion.type === "text_in_region";

  return (
    <Card className="p-4 bg-gray-800/50 border-gray-700 space-y-3">
      {/* Header with delete button */}
      <div className="flex items-center justify-between">
        <Label className="text-sm text-gray-300">OCR Assertion</Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="h-8 w-8 p-0 text-gray-500 hover:text-red-400 hover:bg-red-500/10"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Assertion Type */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-500">Assertion Type</Label>
        <Select
          value={assertion.type}
          onValueChange={(value) =>
            updateAssertion({ type: value as OCRAssertionType })
          }
        >
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text_present">Text Present</SelectItem>
            <SelectItem value="text_absent">Text Absent</SelectItem>
            <SelectItem value="no_duplicate_matches">
              No Duplicate Matches
            </SelectItem>
            <SelectItem value="text_count">Text Count</SelectItem>
            <SelectItem value="text_in_region">Text in Region</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-500">
          {getAssertionTypeDescription(assertion.type)}
        </p>
      </div>

      {/* Text Pattern */}
      <div className="space-y-2">
        <Label className="text-xs text-gray-500">Text Pattern</Label>
        <Input
          type="text"
          value={assertion.pattern}
          onChange={(e) => updateAssertion({ pattern: e.target.value })}
          placeholder="Enter text to search for"
          className="bg-transparent border-gray-700 font-mono text-sm"
        />
      </div>

      {/* Regex Toggle */}
      <div className="flex items-center justify-between py-2">
        <div className="space-y-0.5">
          <Label className="text-xs text-gray-500">
            Use Regular Expression
          </Label>
          <p className="text-xs text-gray-600">
            Treat pattern as a regex pattern
          </p>
        </div>
        <Switch
          checked={assertion.isRegex || false}
          onCheckedChange={(checked) => updateAssertion({ isRegex: checked })}
        />
      </div>

      {/* Count Fields (for text_count) */}
      {showCountFields && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs text-gray-500">Min Count</Label>
            <Input
              type="number"
              min={0}
              value={assertion.minCount ?? ""}
              onChange={(e) =>
                updateAssertion({
                  minCount: e.target.value
                    ? parseInt(e.target.value)
                    : undefined,
                })
              }
              placeholder="0"
              className="bg-transparent border-gray-700"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-gray-500">Max Count</Label>
            <Input
              type="number"
              min={0}
              value={assertion.maxCount ?? ""}
              onChange={(e) =>
                updateAssertion({
                  maxCount: e.target.value
                    ? parseInt(e.target.value)
                    : undefined,
                })
              }
              placeholder="∞"
              className="bg-transparent border-gray-700"
            />
          </div>
        </div>
      )}

      {/* Region Fields (for text_in_region) */}
      {showRegionFields && (
        <div className="space-y-3">
          <Label className="text-xs text-gray-500">Region Bounds</Label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs text-gray-600">X</Label>
              <Input
                type="number"
                min={0}
                value={assertion.region?.x ?? ""}
                onChange={(e) =>
                  updateAssertion({
                    region: {
                      x: parseInt(e.target.value) || 0,
                      y: assertion.region?.y || 0,
                      width: assertion.region?.width || 100,
                      height: assertion.region?.height || 100,
                    },
                  })
                }
                placeholder="0"
                className="bg-transparent border-gray-700"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-gray-600">Y</Label>
              <Input
                type="number"
                min={0}
                value={assertion.region?.y ?? ""}
                onChange={(e) =>
                  updateAssertion({
                    region: {
                      x: assertion.region?.x || 0,
                      y: parseInt(e.target.value) || 0,
                      width: assertion.region?.width || 100,
                      height: assertion.region?.height || 100,
                    },
                  })
                }
                placeholder="0"
                className="bg-transparent border-gray-700"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-gray-600">Width</Label>
              <Input
                type="number"
                min={1}
                value={assertion.region?.width ?? ""}
                onChange={(e) =>
                  updateAssertion({
                    region: {
                      x: assertion.region?.x || 0,
                      y: assertion.region?.y || 0,
                      width: parseInt(e.target.value) || 100,
                      height: assertion.region?.height || 100,
                    },
                  })
                }
                placeholder="100"
                className="bg-transparent border-gray-700"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-gray-600">Height</Label>
              <Input
                type="number"
                min={1}
                value={assertion.region?.height ?? ""}
                onChange={(e) =>
                  updateAssertion({
                    region: {
                      x: assertion.region?.x || 0,
                      y: assertion.region?.y || 0,
                      width: assertion.region?.width || 100,
                      height: parseInt(e.target.value) || 100,
                    },
                  })
                }
                placeholder="100"
                className="bg-transparent border-gray-700"
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
