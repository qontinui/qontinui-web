import { useMemo } from "react";
import { useAutomationStore } from "@/stores/automation";

export function useNameMap() {
  const states = useAutomationStore((s) => s.states);
  const transitions = useAutomationStore((s) => s.transitions);
  const images = useAutomationStore((s) => s.images);

  return useMemo(() => {
    const map = new Map<string, string>();
    states.forEach((s) => {
      if (s.name) map.set(s.id, s.name);
    });
    transitions.forEach((t) => {
      const name = (t as { name?: string }).name;
      if (name) map.set(t.id, name);
    });
    images.forEach((img) => {
      if (img.name) map.set(img.id, img.name);
    });
    return map;
  }, [states, transitions, images]);
}
