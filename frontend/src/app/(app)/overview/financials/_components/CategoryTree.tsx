"use client";

/**
 * Spend per category as a tree, one table per currency. A category with
 * subcategories shows its own costs and, beside them, what it comes to with
 * everything below it ("Computers" with a subcategory per machine). Every
 * figure is the server's (`categories` in the summary); a scheduled
 * subscription charge is included and marked, and a variable bill whose
 * amount is not entered is counted, never added as zero.
 *
 * The Total row is the server's own grand total: a cost sits in one category,
 * so the "with subcategories" column is NOT added up down the page.
 */

import { formatMicros } from "@/components/overview/money";
import type { CategoryTotal, CurrencyTotals } from "../../_lib/costs-api";
import { categoryTree, type CategoryChoice } from "../../_lib/costs";

export function CategoryTree({
  categories,
  totals,
  currencies,
}: {
  categories: CategoryChoice[];
  totals: CategoryTotal[];
  currencies: CurrencyTotals[];
}) {
  if (totals.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-ui-bridge-id="overview.costs.tree.empty"
      >
        Nothing has been spent yet.
      </p>
    );
  }
  const nodes = categoryTree(categories);
  const codes = [...new Set(totals.map((t) => t.currency))];
  return (
    <div className="space-y-8" data-ui-bridge-id="overview.costs.tree">
      {codes.map((currency) => {
        const money = (micros: number) =>
          formatMicros(micros, currency, { maximumFractionDigits: 2 });
        const byCategory = new Map(
          totals
            .filter((t) => t.currency === currency)
            .map((t) => [t.category_id, t])
        );
        const rows = nodes.flatMap((n) => {
          const found = byCategory.get(n.category.id);
          return found ? [{ node: n, found }] : [];
        });
        const none = byCategory.get(null);
        const grand = currencies.find((c) => c.currency === currency);
        const hasChildren = new Set(
          categories.flatMap((c) => (c.parent_id ? [c.parent_id] : []))
        );
        return (
          <div
            key={currency}
            className="overflow-x-auto"
            data-ui-bridge-id={`overview.costs.tree.${currency}`}
          >
            {codes.length > 1 && (
              <h3 className="mb-2 text-sm font-medium text-foreground">
                In {currency}
              </h3>
            )}
            <table className="w-full min-w-[30rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-normal">
                    Category
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">
                    Its own costs
                  </th>
                  <th scope="col" className="py-2 text-right font-normal">
                    With subcategories
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ node, found }) => {
                  const own =
                    found.own_recorded_micros + found.own_scheduled_micros;
                  const rolled =
                    found.rolled_recorded_micros +
                    found.rolled_scheduled_micros;
                  const parent = hasChildren.has(node.category.id);
                  return (
                    <tr
                      key={node.category.id}
                      className="border-b border-border/60"
                      data-ui-bridge-id={`overview.costs.tree.${currency}.${node.category.id}`}
                    >
                      <th
                        scope="row"
                        className={`py-2 pr-4 text-left ${
                          parent ? "font-medium" : "font-normal"
                        }`}
                      >
                        <span
                          style={{ marginLeft: `${node.depth * 1.25}rem` }}
                          data-depth={node.depth}
                        >
                          {node.category.name}
                        </span>
                        {found.rolled_awaiting_amount_count > 0 && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {found.rolled_awaiting_amount_count} amount
                            {found.rolled_awaiting_amount_count === 1
                              ? ""
                              : "s"}{" "}
                            to enter
                          </span>
                        )}
                      </th>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {own === 0 && found.own_awaiting_amount_count === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          money(own)
                        )}
                        {found.own_scheduled_micros !== 0 && (
                          <span
                            className="ml-1 text-xs text-muted-foreground"
                            title={`Includes ${money(found.own_scheduled_micros)} of scheduled subscription charges`}
                          >
                            *
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {parent ? (
                          <span className="font-medium">{money(rolled)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {parent && found.rolled_scheduled_micros !== 0 && (
                          <span
                            className="ml-1 text-xs text-muted-foreground"
                            title={`Includes ${money(found.rolled_scheduled_micros)} of scheduled subscription charges`}
                          >
                            *
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {none && (
                  <tr className="border-b border-border/60">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">
                      No category
                    </th>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {money(
                        none.own_recorded_micros + none.own_scheduled_micros
                      )}
                    </td>
                    <td className="py-2 text-right text-muted-foreground">—</td>
                  </tr>
                )}
              </tbody>
              {grand && (
                <tfoot>
                  <tr>
                    <th scope="row" className="py-2 pr-4 text-left font-medium">
                      Total
                    </th>
                    <td
                      colSpan={2}
                      className="py-2 text-right font-medium tabular-nums"
                      data-ui-bridge-id={`overview.costs.tree.${currency}.total`}
                    >
                      {money(grand.spent_to_date_micros)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        * includes subscription charges that fell due and were not entered as a
        cost of their own. A cost counts once, in its own category; the second
        column adds in the subcategories below.
      </p>
    </div>
  );
}
