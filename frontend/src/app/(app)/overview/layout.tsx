import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { OverviewHeader } from "./_components/OverviewPieces";

export default function OverviewLayout({ children }: { children: ReactNode }) {
  return <div className="h-[calc(100vh-44px)] flex flex-col" data-ui-bridge-id="overview.shell"><OverviewHeader /><ScrollArea className="flex-1"><main>{children}</main></ScrollArea></div>;
}
