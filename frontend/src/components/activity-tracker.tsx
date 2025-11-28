"use client";

import { useActivityTracker } from "@/hooks/use-activity-tracker";

export function ActivityTracker() {
  useActivityTracker();
  return null;
}
