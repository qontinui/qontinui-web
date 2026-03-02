"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PackageCodePreview } from "@/components/marketplace/PackageCodePreview";
import { getCategoryLabel, type PackageCategory } from "@/types/code-packages";

interface PreviewTabProps {
  name: string;
  description: string;
  category: PackageCategory;
  tags: string[];
  code: string;
}

export function PreviewTab({
  name,
  description,
  category,
  tags,
  code,
}: PreviewTabProps) {
  return (
    <Card className="bg-muted/50 border-border">
      <CardHeader>
        <CardTitle>Package Preview</CardTitle>
        <CardDescription>
          How your package will appear in the marketplace
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="text-2xl font-bold text-foreground mb-2">
            {name || "Package Name"}
          </h3>
          <p className="text-muted-foreground">
            {description || "Package description"}
          </p>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{getCategoryLabel(category)}</Badge>
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {code && (
          <div>
            <h4 className="font-semibold text-foreground mb-2">Code Preview</h4>
            <PackageCodePreview
              code={code}
              language="python"
              fileName={`${name || "package"}.py`}
              maxHeight="400px"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
