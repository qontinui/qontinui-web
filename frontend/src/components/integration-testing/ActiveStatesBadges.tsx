// components/integration-testing/ActiveStatesBadges.tsx

import { Badge } from '@/components/ui/badge';

interface ActiveStatesBadgesProps {
  states: string[];
}

export function ActiveStatesBadges({ states }: ActiveStatesBadgesProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {states.map(state => (
        <Badge
          key={state}
          variant="secondary"
          className="bg-blue-500 text-white text-xs"
        >
          {state}
        </Badge>
      ))}
    </div>
  );
}
