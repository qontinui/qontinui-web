"use client";

import { Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Early Access Subscription Badge
 *
 * Shows "Early Access - Free" instead of pricing tiers during early access period.
 * No upgrade buttons or pricing links until February 2026 launch.
 */
export function SubscriptionBadge() {
  return (
    <Badge
      variant="outline"
      className={cn(
        "flex items-center gap-1.5 px-3 py-1",
        "bg-blue-500/20 text-blue-400 border-blue-500/30"
      )}
      title="Free during early access until February 2026"
    >
      <Rocket className="h-3.5 w-3.5" />
      <span className="font-medium">Early Access - Free</span>
    </Badge>
  );
}

/*
// ORIGINAL SUBSCRIPTION BADGE (COMMENTED OUT FOR EARLY ACCESS)
// Will be restored for February 2026 launch

'use client';

import { useEffect, useState } from 'react';
import { Crown, Sparkles, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { billingService, type Subscription } from '@/services/service-factory';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

export function SubscriptionBadge() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    loadSubscription();
  }, []);

  const loadSubscription = async () => {
    try {
      const sub = await billingService.getSubscription();
      setSubscription(sub);
    } catch (error) {
      console.error('Failed to load subscription:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return null;
  }

  const tier = subscription?.tier || 'free';

  const tierConfig = {
    free: {
      label: 'Free',
      icon: null,
      className: 'bg-gray-500/20 text-gray-400 border-gray-500/30 hover:bg-gray-500/30',
      showUpgrade: true,
    },
    hobby: {
      label: 'Hobby',
      icon: Sparkles,
      className: 'bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30',
      showUpgrade: true,
    },
    pro: {
      label: 'Pro',
      icon: Crown,
      className: 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-400 border-purple-500/30 hover:from-purple-500/30 hover:to-pink-500/30',
      showUpgrade: false,
    },
  };

  const config = tierConfig[tier];
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-2">
      <Badge
        variant="outline"
        className={cn(
          'flex items-center gap-1.5 px-3 py-1 cursor-pointer transition-colors',
          config.className
        )}
        onClick={() => router.push('/pricing')}
      >
        {Icon && <Icon className="h-3.5 w-3.5" />}
        <span className="font-medium">{config.label}</span>
      </Badge>

      {config.showUpgrade && (
        <Button
          size="sm"
          variant="default"
          className="bg-gradient-to-r from-[#00D9FF] to-[#BD00FF] hover:opacity-90 transition-opacity"
          onClick={() => router.push('/pricing')}
        >
          <Zap className="h-4 w-4 mr-1" />
          Upgrade
        </Button>
      )}
    </div>
  );
}
*/
