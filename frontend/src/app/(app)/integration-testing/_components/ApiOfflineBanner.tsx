import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export function ApiOfflineBanner() {
  return (
    <Card className="bg-yellow-500/10 border-yellow-500/30 mb-6">
      <CardContent className="py-4">
        <div className="flex items-center gap-2 text-yellow-400">
          <AlertCircle className="w-5 h-5" />
          <span>
            The selected runner is not reachable. Start the runner to run
            integration tests.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
