"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getCategoryLabel,
  type PackageCategory,
  type PackageLicense,
  type PackageVisibility,
} from "@/types/code-packages";
import { CATEGORIES, LICENSES } from "../types";

interface DetailsTabProps {
  name: string;
  description: string;
  functionName: string;
  category: PackageCategory;
  tags: string[];
  tagInput: string;
  license: PackageLicense;
  visibility: PackageVisibility;
  repositoryUrl: string;
  homepageUrl: string;
  documentationUrl: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onFunctionNameChange: (value: string) => void;
  onCategoryChange: (value: PackageCategory) => void;
  onTagInputChange: (value: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  onLicenseChange: (value: PackageLicense) => void;
  onVisibilityChange: (value: PackageVisibility) => void;
  onRepositoryUrlChange: (value: string) => void;
  onHomepageUrlChange: (value: string) => void;
  onDocumentationUrlChange: (value: string) => void;
}

export function DetailsTab({
  name,
  description,
  functionName,
  category,
  tags,
  tagInput,
  license,
  visibility,
  repositoryUrl,
  homepageUrl,
  documentationUrl,
  onNameChange,
  onDescriptionChange,
  onFunctionNameChange,
  onCategoryChange,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
  onLicenseChange,
  onVisibilityChange,
  onRepositoryUrlChange,
  onHomepageUrlChange,
  onDocumentationUrlChange,
}: DetailsTabProps) {
  return (
    <div className="space-y-6">
      <Card className="bg-muted/50 border-border">
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>
            Provide essential details about your package
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Package Name *</Label>
            <Input
              id="name"
              placeholder="my-awesome-package"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className="bg-muted border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              placeholder="A brief description of what your package does..."
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              rows={3}
              className="bg-muted border-border resize-none"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="functionName">Function Name *</Label>
            <Input
              id="functionName"
              placeholder="main_function"
              value={functionName}
              onChange={(e) => onFunctionNameChange(e.target.value)}
              className="bg-muted border-border"
            />
            <p className="text-xs text-muted-foreground">
              The main function that will be executed when this package is used
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category *</Label>
            <Select
              value={category}
              onValueChange={(v) => onCategoryChange(v as PackageCategory)}
            >
              <SelectTrigger id="category" className="bg-muted border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {getCategoryLabel(cat)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <div className="flex gap-2">
              <Input
                id="tags"
                placeholder="Add a tag..."
                value={tagInput}
                onChange={(e) => onTagInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddTag();
                  }
                }}
                className="bg-muted border-border"
              />
              <Button type="button" onClick={onAddTag} variant="outline">
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="cursor-pointer hover:bg-muted"
                    onClick={() => onRemoveTag(tag)}
                  >
                    {tag} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="license">License *</Label>
            <Select
              value={license}
              onValueChange={(v) => onLicenseChange(v as PackageLicense)}
            >
              <SelectTrigger id="license" className="bg-muted border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LICENSES.map((lic) => (
                  <SelectItem key={lic} value={lic}>
                    {lic}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="visibility">Visibility *</Label>
            <Select
              value={visibility}
              onValueChange={(v) => onVisibilityChange(v as PackageVisibility)}
            >
              <SelectTrigger id="visibility" className="bg-muted border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">
                  Public - Anyone can find and install
                </SelectItem>
                <SelectItem value="unlisted">
                  Unlisted - Only via direct link
                </SelectItem>
                <SelectItem value="private">
                  Private - Only you can access
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted/50 border-border">
        <CardHeader>
          <CardTitle>Links (Optional)</CardTitle>
          <CardDescription>
            Provide additional resources for users
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="repositoryUrl">Repository URL</Label>
            <Input
              id="repositoryUrl"
              placeholder="https://github.com/username/repo"
              value={repositoryUrl}
              onChange={(e) => onRepositoryUrlChange(e.target.value)}
              className="bg-muted border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="homepageUrl">Homepage URL</Label>
            <Input
              id="homepageUrl"
              placeholder="https://mypackage.com"
              value={homepageUrl}
              onChange={(e) => onHomepageUrlChange(e.target.value)}
              className="bg-muted border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="documentationUrl">Documentation URL</Label>
            <Input
              id="documentationUrl"
              placeholder="https://docs.mypackage.com"
              value={documentationUrl}
              onChange={(e) => onDocumentationUrlChange(e.target.value)}
              className="bg-muted border-border"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
