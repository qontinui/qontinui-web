import { Card, CardContent } from "@/components/ui/card";
import { Info } from "lucide-react";

export function InfoBanner() {
  return (
    <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
      <CardContent className="flex items-start gap-3 pt-6">
        <Info className="w-5 h-5 text-blue-500 mt-0.5" />
        <div className="flex-1">
          <p className="font-medium text-blue-900 dark:text-blue-100">
            Settings are saved locally
          </p>
          <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
            Your preferences are stored in your browser&apos;s local storage.
            Export your settings to back them up or share across devices.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
