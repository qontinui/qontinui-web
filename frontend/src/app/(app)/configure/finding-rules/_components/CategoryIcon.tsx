"use client";

import { Settings2 } from "lucide-react";
import { ICON_MAP } from "../finding-rules-utils";

interface CategoryIconProps {
  name: string;
  className?: string;
}

export function CategoryIcon({ name, className }: CategoryIconProps) {
  const Icon = ICON_MAP[name] || Settings2;
  return <Icon className={className} />;
}
