import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, SkipForward, SkipBack, RotateCcw } from "lucide-react";

interface PlaybackControlsProps {
  currentActionIndex: number;
  isPlaying: boolean;
  playbackSpeed: number;
  assumeSuccess: boolean;
  totalActions: number;
  onReset: () => void;
  onStepBack: () => void;
  onPlayPause: () => void;
  onStepForward: () => void;
  onSpeedChange: (speed: number) => void;
  onAssumeSuccessToggle: () => void;
  onSliderChange: (value: number) => void;
}

export function PlaybackControls({
  currentActionIndex,
  isPlaying,
  playbackSpeed,
  assumeSuccess,
  totalActions,
  onReset,
  onStepBack,
  onPlayPause,
  onStepForward,
  onSpeedChange,
  onAssumeSuccessToggle,
  onSliderChange,
}: PlaybackControlsProps) {
  return (
    <Card className="mt-6">
      <CardContent className="py-4">
        <div className="flex items-center gap-4">
          {/* Control Buttons */}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onReset}
              title="Reset to Start"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onStepBack}
              disabled={currentActionIndex === 0}
              title="Step Back"
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant={isPlaying ? "default" : "outline"}
              onClick={onPlayPause}
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onStepForward}
              disabled={currentActionIndex >= totalActions - 1}
              title="Step Forward"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          {/* Progress Bar */}
          <div className="flex-1">
            <Slider
              value={[currentActionIndex]}
              max={totalActions - 1}
              step={1}
              onValueChange={([value]) => {
                onSliderChange(value ?? 0);
              }}
              className="w-full"
            />
          </div>

          {/* Speed Control */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Speed:</span>
            <Select
              value={playbackSpeed.toString()}
              onValueChange={(value) => onSpeedChange(parseInt(value))}
            >
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2000">0.5x</SelectItem>
                <SelectItem value="1000">1x</SelectItem>
                <SelectItem value="500">2x</SelectItem>
                <SelectItem value="250">4x</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Assume Success Toggle */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Mode:</span>
            <Badge
              variant={assumeSuccess ? "default" : "destructive"}
              className="cursor-pointer"
              onClick={onAssumeSuccessToggle}
            >
              {assumeSuccess ? "Success" : "Failure"}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
