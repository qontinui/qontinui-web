"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { billingService } from "@/services/service-factory";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Subscription } from "@/services/billing-service";

const tiers = [
  {
    name: "Free",
    tier: "free" as const,
    price: "$0",
    description: "Perfect for trying out Qontinui",
    features: [
      "5 configurations",
      "50 images",
      "25 MB storage",
      "Community support",
    ],
    buttonText: "Current Plan",
    disabled: true,
  },
  {
    name: "Hobby",
    tier: "hobby" as const,
    price: "$7",
    description: "For individual developers and hobbyists",
    features: [
      "100 configurations",
      "500 images",
      "200 MB storage",
      "Email support",
      "Export to JSON",
    ],
    buttonText: "Upgrade to Hobby",
    disabled: false,
    popular: true,
  },
  {
    name: "Pro",
    tier: "pro" as const,
    price: "$24",
    description: "For professional automation projects",
    features: [
      "Unlimited configurations",
      "5,000 images",
      "2 GB storage",
      "Priority support",
      "Export to JSON",
      "Advanced analytics",
    ],
    buttonText: "Upgrade to Pro",
    disabled: false,
  },
];

export default function PricingPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loadingSub, setLoadingSub] = useState(true);

  useEffect(() => {
    loadSubscription();
  }, []);

  const loadSubscription = async () => {
    try {
      const sub = await billingService.getSubscription();
      setSubscription(sub);
    } catch (error) {
      console.error("Failed to load subscription:", error);
    } finally {
      setLoadingSub(false);
    }
  };

  const handleUpgrade = async (tier: "hobby" | "pro") => {
    // Prevent purchasing current tier
    if (subscription?.tier === tier) {
      alert(`You already have the ${tier} plan!`);
      return;
    }

    try {
      setLoading(tier);
      await billingService.redirectToCheckout(tier);
    } catch (error) {
      console.error("Checkout error:", error);
      alert("Failed to start checkout. Please try again.");
      setLoading(null);
    }
  };

  const getButtonText = (tier: (typeof tiers)[number]) => {
    if (loadingSub) return "Loading...";
    if (loading === tier.tier) return "Loading...";

    const currentTier = subscription?.tier || "free";

    if (tier.tier === "free") {
      return currentTier === "free" ? "Current Plan" : "Downgrade to Free";
    }

    if (currentTier === tier.tier) {
      return "Current Plan";
    }

    if (currentTier === "free") {
      return tier.buttonText;
    }

    // Upgrading from hobby to pro
    if (currentTier === "hobby" && tier.tier === "pro") {
      return "Upgrade to Pro";
    }

    // Downgrading from pro to hobby
    if (currentTier === "pro" && tier.tier === "hobby") {
      return "Downgrade to Hobby";
    }

    return tier.buttonText;
  };

  const isButtonDisabled = (tier: (typeof tiers)[number]) => {
    if (loadingSub || loading !== null) return true;

    const currentTier = subscription?.tier || "free";

    // Can't purchase current tier
    if (currentTier === tier.tier) return true;

    // Can't downgrade on pricing page (use billing portal)
    if (tier.tier === "free" && currentTier !== "free") return true;
    if (tier.tier === "hobby" && currentTier === "pro") return true;

    return tier.disabled;
  };

  return (
    <div className="container mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">Choose Your Plan</h1>
        <p className="text-xl text-muted-foreground">
          Start for free, upgrade when you need more
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
        {tiers.map((tier) => (
          <Card
            key={tier.name}
            className={`relative ${
              tier.popular ? "border-primary shadow-lg scale-105" : ""
            }`}
          >
            {tier.popular && (
              <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-3 py-1 text-sm rounded-bl rounded-tr">
                Popular
              </div>
            )}
            <CardHeader>
              <CardTitle className="text-2xl">{tier.name}</CardTitle>
              <CardDescription>{tier.description}</CardDescription>
              <div className="mt-4">
                <span className="text-4xl font-bold">{tier.price}</span>
                {tier.tier !== "free" && (
                  <span className="text-muted-foreground">/month</span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 mb-6">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <Check className="h-5 w-5 text-primary flex-shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="w-full"
                disabled={isButtonDisabled(tier)}
                onClick={() => tier.tier !== "free" && handleUpgrade(tier.tier)}
                variant={tier.popular ? "default" : "outline"}
              >
                {getButtonText(tier)}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-16 text-center text-sm text-muted-foreground">
        <p>All plans include core automation features and JSON export.</p>
        <p className="mt-2">
          Need something custom?{" "}
          <a
            href="mailto:support@qontinui.com"
            className="text-primary hover:underline"
          >
            Contact us
          </a>
        </p>
      </div>
    </div>
  );
}
