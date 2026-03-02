import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

interface ErrorBannerProps {
  error: string;
  onDismiss: () => void;
}

export function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  return (
    <Card className="bg-red-500/10 border-red-500/30 mb-6">
      <CardContent className="py-4">
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
