import { Image as ImageIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import type { PlaywrightClickable } from "@/lib/runner-client";

export function PlaywrightElementImage({
  element,
}: {
  element: PlaywrightClickable;
}) {
  if (!element.screenshot) {
    return (
      <div className="w-16 h-16 bg-muted rounded flex items-center justify-center">
        <ImageIcon className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="w-16 h-16 rounded overflow-hidden border border-border hover:border-primary transition-colors">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${element.screenshot}`}
            alt={element.text || element.selector}
            className="w-full h-full object-contain"
          />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {element.text || element.aria_label || element.selector}
          </DialogTitle>
        </DialogHeader>
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${element.screenshot}`}
            alt={element.text || element.selector}
            className="max-h-[60vh] object-contain"
          />
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Selector</p>
            <p className="font-mono text-xs break-all">{element.selector}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Bounding Box</p>
            <p className="font-mono text-xs">
              {element.bounding_box.x}, {element.bounding_box.y} (
              {element.bounding_box.width}x{element.bounding_box.height})
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
