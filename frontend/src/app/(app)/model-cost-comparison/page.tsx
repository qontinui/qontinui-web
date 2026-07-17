"use client";

export const dynamic = "force-dynamic";

import { useMemo, useState } from "react";
import { CalendarDays, Coins, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  COMPARISON_DATE,
  CURRENCIES,
  DEFAULT_OUTPUT_SHARE,
  DEFAULT_TOKENS_M,
  MODELS,
  apiCost,
  cheapestPlanCombination,
  combinationLabel,
  combinationPrice,
  convertUsd,
  formatCurrency,
  getCurrency,
  getPlanFamilies,
  planPrice,
  type CurrencyCode,
} from "@/data/model-costs";

const OUTPUT_SHARE_OPTIONS = [
  { value: "0.1", label: "10% output / 90% input" },
  { value: "0.25", label: "25% output / 75% input" },
  { value: "0.5", label: "50% output / 50% input" },
  { value: "0.75", label: "75% output / 25% input" },
];

export default function ModelCostComparisonPage() {
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>("USD");
  const [tokensM, setTokensM] = useState<number>(DEFAULT_TOKENS_M);
  const [outputShare, setOutputShare] = useState<number>(DEFAULT_OUTPUT_SHARE);

  const currency = getCurrency(currencyCode);

  const modelRows = useMemo(
    () =>
      MODELS.map((model) => ({
        model,
        cost: apiCost(model, tokensM, outputShare, currency),
      })).sort((a, b) => a.cost - b.cost),
    [tokensM, outputShare, currency]
  );

  const familyRows = useMemo(() => {
    return Array.from(getPlanFamilies().entries()).map(([family, plans]) => ({
      family,
      plans,
      combo: cheapestPlanCombination(plans, tokensM, currency),
    }));
  }, [tokensM, currency]);

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Model Cost Comparison</h1>
          <p className="text-muted-foreground">
            What a given amount of tokens costs across models and subscription
            plans.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5 text-sm">
          <CalendarDays className="size-4" />
          Data as of {COMPARISON_DATE}
        </Badge>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-6 pt-6">
          <div className="space-y-2">
            <Label htmlFor="mcc-currency">Currency</Label>
            <Select
              value={currencyCode}
              onValueChange={(v) => setCurrencyCode(v as CurrencyCode)}
            >
              <SelectTrigger id="mcc-currency" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.symbol} {c.code} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mcc-quantity">Tokens (millions)</Label>
            <Input
              id="mcc-quantity"
              type="number"
              min={1}
              className="w-44"
              value={tokensM}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) setTokensM(v);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Default {DEFAULT_TOKENS_M}M ≈ Claude Code Max 20x monthly
              allotment
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mcc-output-share">Token mix</Label>
            <Select
              value={String(outputShare)}
              onValueChange={(v) => setOutputShare(Number(v))}
            >
              <SelectTrigger id="mcc-output-share" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTPUT_SHARE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Pay-as-you-go API comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="size-5" />
            Pay-as-you-go API cost for {tokensM}M tokens
          </CardTitle>
          <CardDescription>
            Official list prices per 1M tokens (base context tier), with
            leaderboard scores for capability context. Sorted cheapest first.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">LMArena Elo</TableHead>
                <TableHead className="text-right">AA Index</TableHead>
                <TableHead className="text-right">SWE-bench %</TableHead>
                <TableHead className="text-right">Input / 1M</TableHead>
                <TableHead className="text-right">Output / 1M</TableHead>
                <TableHead className="text-right">
                  Cost for {tokensM}M
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {modelRows.map(({ model, cost }) => (
                <TableRow key={model.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {model.name}
                      {!model.verified && (
                        <Badge variant="secondary" className="text-xs">
                          unverified
                        </Badge>
                      )}
                    </div>
                    {model.notes && (
                      <p className="mt-0.5 max-w-64 text-xs text-muted-foreground">
                        {model.notes}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>{model.provider}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {model.leaderboards.lmarenaElo ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {model.leaderboards.aaIntelligenceIndex ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {model.leaderboards.sweBenchVerified ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(
                      convertUsd(model.inputPerMTokUsd, currency),
                      currency
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(
                      convertUsd(model.outputPerMTokUsd, currency),
                      currency
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(cost, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Subscription comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Subscriptions covering {tokensM}M tokens / month</CardTitle>
          <CardDescription>
            Cheapest combination of plans within each provider family — plans
            can be stacked across multiple accounts, so 210M tokens of a
            10/50/200 family is served by one Max 20x plus one Pro.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {familyRows.map(({ family, plans, combo }) => (
            <Card key={family} className="border-muted">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{family}</CardTitle>
                {combo ? (
                  <div className="space-y-1">
                    <p className="text-2xl font-bold tabular-nums">
                      {formatCurrency(combinationPrice(combo, currency), currency)}
                      <span className="text-sm font-normal text-muted-foreground">
                        {" "}
                        / month
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {combinationLabel(combo)} · covers ~{combo.totalTokensM}M
                      tokens
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Usage not quantifiable — provider publishes no token or
                    message quotas.
                  </p>
                )}
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plan</TableHead>
                      <TableHead className="text-right">Price / mo</TableHead>
                      <TableHead className="text-right">~Tokens / mo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plans.map((plan) => (
                      <TableRow key={plan.id}>
                        <TableCell>
                          <span className="font-medium">{plan.name}</span>
                          {plan.notes && (
                            <p className="mt-0.5 max-w-56 text-xs text-muted-foreground">
                              {plan.notes}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(planPrice(plan, currency), currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {plan.tokensPerMonthM > 0
                            ? `${plan.tokensPerMonthM}M${plan.tokensEstimated ? " (est.)" : ""}`
                            : "n/a"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>

      {/* Methodology */}
      <Card>
        <CardContent className="flex gap-3 pt-6 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-2">
            <p>
              API prices are official pay-as-you-go list prices in USD (base
              context tier), converted at mid-market FX rates from{" "}
              {COMPARISON_DATE}. Where vendors publish region-specific
              subscription prices (usually VAT-inclusive), those are used
              instead of FX conversion.
            </p>
            <p>
              No vendor publishes exact token quotas for consumer
              subscriptions — all per-plan token allotments are estimates
              derived from official usage multipliers, published window/credit
              limits, and community measurements. Official plan-to-plan
              multipliers (e.g. Claude Max 20x = 20× Pro) are preserved
              exactly. Leaderboard scores: LMArena text Elo (arena.ai),
              Artificial Analysis Intelligence Index, SWE-bench Verified.
            </p>
            <p>
              Data is maintained by the qontinui team and refreshed via the
              /update-model-costs command; users don&apos;t need to enter
              anything.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
