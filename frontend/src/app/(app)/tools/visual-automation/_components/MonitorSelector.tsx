import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Monitor } from "lucide-react";

interface MonitorSelectorProps {
  selectedMonitor: string;
  onMonitorChange: (value: string) => void;
}

export function MonitorSelector({
  selectedMonitor,
  onMonitorChange,
}: MonitorSelectorProps) {
  return (
    <Card className="bg-muted border-border">
      <CardContent className="py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Monitor className="size-4 text-muted-foreground" />
            <Label className="text-sm text-foreground">Target Monitor</Label>
          </div>
          <Select value={selectedMonitor} onValueChange={onMonitorChange}>
            <SelectTrigger className="w-[180px] bg-muted border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="primary">Primary Monitor</SelectItem>
              <SelectItem value="left">Left Monitor</SelectItem>
              <SelectItem value="right">Right Monitor</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
