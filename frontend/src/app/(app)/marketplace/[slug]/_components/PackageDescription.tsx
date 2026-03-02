import { Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getCategoryLabel } from "@/types/code-packages";
import type { CodePackage } from "@/types/code-packages";

interface PackageDescriptionProps {
  pkg: CodePackage;
}

export function PackageDescription({ pkg }: PackageDescriptionProps) {
  return (
    <div className="mb-6">
      <p className="text-sm text-muted-foreground mb-3">{pkg.description}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{getCategoryLabel(pkg.category)}</Badge>
        {pkg.tags.map((tag) => (
          <Badge key={tag} variant="secondary">
            {tag}
          </Badge>
        ))}
        <span className="text-sm text-muted-foreground ml-2">
          by{" "}
          <span className="font-medium text-foreground">
            {pkg.author.username}
          </span>
          {pkg.author.verified && (
            <Shield className="w-3 h-3 text-primary inline ml-1" />
          )}
        </span>
      </div>
    </div>
  );
}
