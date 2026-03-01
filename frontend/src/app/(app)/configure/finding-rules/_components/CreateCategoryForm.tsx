"use client";

import { Plus, X, Loader2, Save, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FindingCategoryActionType } from "@/lib/api-client";
import {
  ICON_OPTIONS,
  COLOR_OPTIONS,
  ACTION_TYPE_OPTIONS,
  getColorClasses,
  slugify,
} from "../finding-rules-utils";
import { CategoryIcon } from "./CategoryIcon";

interface CreateCategoryFormProps {
  formName: string;
  formDescription: string;
  formIcon: string;
  formColor: string;
  formActionType: FindingCategoryActionType;
  formEnabled: boolean;
  isSaving: boolean;
  saveError: string | null;
  onFormNameChange: (value: string) => void;
  onFormDescriptionChange: (value: string) => void;
  onFormIconChange: (value: string) => void;
  onFormColorChange: (value: string) => void;
  onFormActionTypeChange: (value: FindingCategoryActionType) => void;
  onFormEnabledChange: (value: boolean) => void;
  onCancel: () => void;
  onCreate: () => void;
}

export function CreateCategoryForm({
  formName,
  formDescription,
  formIcon,
  formColor,
  formActionType,
  formEnabled,
  isSaving,
  saveError,
  onFormNameChange,
  onFormDescriptionChange,
  onFormIconChange,
  onFormColorChange,
  onFormActionTypeChange,
  onFormEnabledChange,
  onCancel,
  onCreate,
}: CreateCategoryFormProps) {
  return (
    <Card className="bg-muted border-primary/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <Plus className="w-5 h-5" />
            New Finding Category
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-white"
            onClick={onCancel}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="fr-name"
              className="text-sm font-medium text-muted-foreground mb-1.5 block"
            >
              Name
            </label>
            <Input
              id="fr-name"
              placeholder="e.g., Accessibility Issue"
              value={formName}
              onChange={(e) => onFormNameChange(e.target.value)}
              className="bg-muted border-border text-white placeholder:text-muted-foreground"
            />
            {formName.trim() && (
              <p className="text-xs text-muted-foreground mt-1">
                Slug: {slugify(formName)}
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="fr-description"
              className="text-sm font-medium text-muted-foreground mb-1.5 block"
            >
              Description
            </label>
            <Input
              id="fr-description"
              placeholder="Short description"
              value={formDescription}
              onChange={(e) => onFormDescriptionChange(e.target.value)}
              className="bg-muted border-border text-white placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Icon
            </p>
            <Select value={formIcon} onValueChange={onFormIconChange}>
              <SelectTrigger className="bg-muted border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-muted border-border">
                {ICON_OPTIONS.map((icon) => (
                  <SelectItem key={icon} value={icon}>
                    <div className="flex items-center gap-2">
                      <CategoryIcon name={icon} className="w-4 h-4" />
                      {icon}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Color
            </p>
            <Select value={formColor} onValueChange={onFormColorChange}>
              <SelectTrigger className="bg-muted border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-muted border-border">
                {COLOR_OPTIONS.map((color) => {
                  const cc = getColorClasses(color);
                  return (
                    <SelectItem key={color} value={color}>
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-3 h-3 rounded-full ${cc.bg} ${cc.border} border`}
                        />
                        {color.charAt(0).toUpperCase() + color.slice(1)}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Default Action
            </p>
            <Select
              value={formActionType}
              onValueChange={(v) =>
                onFormActionTypeChange(v as FindingCategoryActionType)
              }
            >
              <SelectTrigger className="bg-muted border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-muted border-border">
                {ACTION_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div>
                      <span>{opt.label}</span>
                      <span className="text-muted-foreground text-[11px] ml-2">
                        {opt.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            id="fr-enabled"
            checked={formEnabled}
            onCheckedChange={onFormEnabledChange}
          />
          <label htmlFor="fr-enabled" className="text-sm text-muted-foreground">
            Enable category
          </label>
        </div>

        {saveError && (
          <div className="flex items-center gap-2 text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <p className="text-sm">{saveError}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="text-muted-foreground hover:text-white"
          >
            Cancel
          </Button>
          <Button
            onClick={onCreate}
            disabled={isSaving}
            className="bg-primary hover:bg-primary/90 text-black font-semibold"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Creating...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Create Category
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
