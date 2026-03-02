import { ArrowLeft, Package } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PackageNotFoundProps {
  onBack: () => void;
}

export function PackageNotFound({ onBack }: PackageNotFoundProps) {
  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden items-center justify-center">
      <div className="text-center">
        <Package className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-foreground mb-2">
          Package not found
        </h2>
        <p className="text-muted-foreground mb-6">
          The package you&apos;re looking for doesn&apos;t exist.
        </p>
        <Button onClick={onBack} variant="outline">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Marketplace
        </Button>
      </div>
    </div>
  );
}
