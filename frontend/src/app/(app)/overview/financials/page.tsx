"use client";

/**
 * Project Overview — Costs. What the project has actually spent, entered by
 * hand: one-time purchases (servers and their parts, a trademark filing),
 * recurring costs that charge the same each time (a Claude Code plan) or
 * vary (AWS, GitHub usage), each under a category the project chooses.
 *
 * What it reads, and from where:
 * - `cost_categories`, `recurring_costs`, `cost_entries` — resources on the
 *   overview authoring contract, read and written through the kit
 *   (`If-Match`, a conflict shown side by side, the change log);
 * - `GET /costs/summary` — every total, the month-by-category table and
 *   every recurring period that has fallen due. This page adds nothing up
 *   beyond a table row's total; a bill whose amount is not entered is
 *   counted, never shown as zero.
 *
 * Edit controls come from the served permission for THIS project
 * (`useCanEdit`) and are absent — not disabled — for a reader who may not
 * edit. Loading and failure are kept apart from "nothing recorded yet".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { formatMicros } from "@/components/overview/money";
import {
  deleteCostCategory,
  deleteCostEntry,
  deleteRecurringCost,
} from "@/components/overview/editing/api";
import { useCanEdit } from "@/components/overview/editing/permissions";
import { useResourceList } from "@/components/overview/editing/useResource";
import { useOverviewProject } from "../_hooks/useOverviewProject";
import {
  AMOUNT_KIND_LABEL,
  CADENCE_LABEL,
  CATEGORY_TABLE,
  CATEGORY_WRITABLE,
  ENTRY_WRITABLE,
  RECURRING_WRITABLE,
  STARTER_CATEGORIES,
  categoryKey,
  categoryToRow,
  entryRowProblem,
  entryTable,
  entryToRow,
  recurringBody,
  recurringKey,
  recurringRowProblem,
  recurringTable,
  recurringToRow,
  type CategoryRow,
  type EntryRow,
  type RecurringRow,
} from "../_lib/costs";
import {
  COST_CATEGORIES,
  COST_CATEGORIES_PATH,
  COST_ENTRIES,
  COST_ENTRIES_PATH,
  RECURRING_COSTS,
  RECURRING_COSTS_PATH,
  fetchCostSummary,
  type CostCategory,
  type CostEntry,
  type CostSummary,
  type RecurringCost,
} from "../_lib/costs-api";
import { formatDay } from "../_lib/timeline";
import { BillsToEnter } from "./_components/BillsToEnter";
import { CostHeadline } from "./_components/CostHeadline";
import { MonthTable } from "./_components/MonthTable";
import { RecordSection } from "./_components/RecordSection";
import { StillToArrive } from "./_components/StillToArrive";

type SummaryState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; summary: CostSummary };

/** The summary, re-read whenever `token` moves (after any write). */
function useSummary(hold: boolean, reloadKey: unknown, token: number) {
  const [value, setValue] = useState<SummaryState>({ state: "loading" });
  useEffect(() => {
    if (hold) return;
    let live = true;
    fetchCostSummary().then(
      (summary) => live && setValue({ state: "ready", summary }),
      (err: unknown) =>
        live &&
        setValue({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        })
    );
    return () => {
      live = false;
    };
  }, [hold, reloadKey, token]);
  return value;
}

function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} data-ui-bridge-id={id}>
      <h2
        id={`${id}-heading`}
        className="font-[family-name:var(--font-overview-serif)] text-[1.625rem] leading-snug text-foreground"
      >
        {title}
      </h2>
      {lede && (
        <p className="mb-5 mt-1.5 max-w-[46rem] text-[15px] leading-relaxed text-muted-foreground">
          {lede}
        </p>
      )}
      <div className={lede ? "" : "mt-5"}>{children}</div>
    </section>
  );
}

function Loading({ uiBridgeId }: { uiBridgeId: string }) {
  return (
    <div className="space-y-3" aria-hidden data-ui-bridge-id={uiBridgeId}>
      <Skeleton className="h-7 w-52" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
    </div>
  );
}

function lines(parts: (string | null | false | undefined)[]): string {
  return parts.filter(Boolean).join("\n");
}

const ALL = "all";

export default function CostsPage() {
  const { projectId, hold, tenantsError } = useOverviewProject();
  const canEditCategories = useCanEdit(COST_CATEGORIES);
  const canEditRecurring = useCanEdit(RECURRING_COSTS);
  const canEditEntries = useCanEdit(COST_ENTRIES);

  const categories = useResourceList<CostCategory>(COST_CATEGORIES_PATH, {
    hold,
    reloadKey: projectId,
  });
  const recurring = useResourceList<RecurringCost>(RECURRING_COSTS_PATH, {
    hold,
    reloadKey: projectId,
  });
  const entries = useResourceList<CostEntry>(COST_ENTRIES_PATH, {
    hold,
    reloadKey: projectId,
  });
  const [token, setToken] = useState(0);
  const summary = useSummary(hold, projectId, token);
  const refresh = useCallback(() => setToken((n) => n + 1), []);
  const [filter, setFilter] = useState<string>(ALL);
  const [seeding, setSeeding] = useState(false);
  const [seedErrors, setSeedErrors] = useState<string[]>([]);

  const categoryItems = useMemo(
    () => (categories.list.state === "ready" ? categories.list.items : []),
    [categories.list]
  );
  const recurringItems = useMemo(
    () => (recurring.list.state === "ready" ? recurring.list.items : []),
    [recurring.list]
  );
  const entryItems = useMemo(
    () => (entries.list.state === "ready" ? entries.list.items : []),
    [entries.list]
  );
  const choices = useMemo(
    () => categoryItems.map((c) => ({ id: c.id, name: c.name })),
    [categoryItems]
  );
  const categoryName = useCallback(
    (id: string | null) =>
      id === null
        ? null
        : (categoryItems.find((c) => c.id === id)?.name ?? null),
    [categoryItems]
  );
  const baseCurrency =
    summary.state === "ready" ? summary.summary.base_currency : "USD";
  const recurringName = useCallback(
    (id: string | null) =>
      id === null
        ? null
        : (recurringItems.find((r) => r.id === id)?.name ?? null),
    [recurringItems]
  );

  const entriesTable = useMemo(() => entryTable(choices), [choices]);
  const recurringDecl = useMemo(() => recurringTable(choices), [choices]);
  const shownEntries = useMemo(
    () =>
      filter === ALL
        ? entryItems
        : entryItems.filter((e) => (e.category_id ?? "none") === filter),
    [entryItems, filter]
  );

  const createCategory = categories.create;
  const seedCategories = async () => {
    setSeeding(true);
    const failures: string[] = [];
    for (const starter of STARTER_CATEGORIES) {
      const result = await createCategory(starter);
      if (!result.ok && "error" in result)
        failures.push(`${starter.name}: ${result.error}`);
    }
    setSeeding(false);
    setSeedErrors(failures);
  };

  if (tenantsError) {
    return (
      <LoadFailure
        what="the list of projects"
        message={tenantsError}
        uiBridgeId="overview.costs.error"
      />
    );
  }

  const failed = [
    ["the cost categories", categories.list],
    ["the recurring costs", recurring.list],
    ["the recorded costs", entries.list],
  ] as const;
  for (const [what, list] of failed) {
    if (list.state === "error")
      return (
        <LoadFailure
          what={what}
          message={list.message}
          uiBridgeId="overview.costs.error"
        />
      );
  }
  if (
    categories.list.state === "loading" ||
    recurring.list.state === "loading" ||
    entries.list.state === "loading"
  )
    return <Loading uiBridgeId="overview.costs.loading" />;

  const describeEntry = (row: EntryRow) =>
    lines([
      `${row.description} — ${formatDay(row.incurred_on) ?? row.incurred_on}`,
      row.vendor && `Paid to ${row.vendor}`,
      `Category: ${categoryName(row.category_id) ?? "none"}`,
      `Amount: ${formatMicros(row.amount_micros, row.currency, { maximumFractionDigits: 2 }) ?? "—"}`,
      row.expects_delivery &&
        (row.received_on
          ? `Received ${formatDay(row.received_on)}`
          : "Not yet received"),
      row.order_ref && `Order ${row.order_ref}`,
      row.notes && `Notes: ${row.notes}`,
    ]);
  const describeRecurring = (row: RecurringRow) =>
    lines([
      row.name,
      row.vendor && `Paid to ${row.vendor}`,
      `Category: ${categoryName(row.category_id) ?? "none"}`,
      `${CADENCE_LABEL[row.cadence]}, ${AMOUNT_KIND_LABEL[row.amount_kind].toLowerCase()}`,
      row.amount_micros !== null &&
        `Amount: ${formatMicros(row.amount_micros, row.currency, { maximumFractionDigits: 2 })}`,
      `From ${formatDay(row.start_date)}${row.end_date ? ` to ${formatDay(row.end_date)}` : ""}`,
      row.notes && `Notes: ${row.notes}`,
    ]);
  const describeCategory = (row: CategoryRow) =>
    lines([row.name, row.description]);

  const periods = summary.state === "ready" ? summary.summary.periods : [];

  return (
    <div className="space-y-14" data-ui-bridge-id="overview.costs">
      <div>
        {summary.state === "loading" && (
          <Loading uiBridgeId="overview.costs.header.loading" />
        )}
        {summary.state === "error" && (
          <LoadFailure
            what="the cost totals"
            message={summary.message}
            uiBridgeId="overview.costs.header.error"
            announce={false}
          />
        )}
        {summary.state === "ready" && (
          <CostHeadline summary={summary.summary} />
        )}
      </div>

      <Section
        id="overview.costs.section.arrive"
        title="Still to arrive"
        lede="Items paid for that have not been received yet, oldest order first."
      >
        <StillToArrive
          entries={entryItems}
          categoryName={categoryName}
          canEdit={canEditEntries}
          today={summary.state === "ready" ? summary.summary.today : ""}
          update={(current, patch) => entries.update(current, patch)}
          onWritten={refresh}
        />
      </Section>

      <Section
        id="overview.costs.section.recurring"
        title="Recurring costs"
        lede="Subscriptions and bills that fall due on a schedule. One that is the same each time counts automatically every period; one that varies (a usage bill) needs each period's amount, entered below as it arrives. To change a price or billing day from now on, give the cost a last due date and add a new one — earlier periods keep what they cost."
      >
        <div className="space-y-6">
          <RecordSection<RecurringCost, RecurringRow>
            resource={RECURRING_COSTS}
            table={recurringDecl}
            records={recurringItems}
            toRow={recurringToRow}
            writable={RECURRING_WRITABLE}
            matchKey={recurringKey}
            rowProblem={recurringRowProblem}
            toBody={(fields) => recurringBody(fields, baseCurrency)}
            label={(row) => row.name || "A recurring cost"}
            describe={describeRecurring}
            canEdit={canEditRecurring}
            create={recurring.create}
            update={recurring.update}
            remove={deleteRecurringCost}
            drop={recurring.drop}
            replace={recurring.replace}
            onWritten={refresh}
            uiBridgeId="overview.costs.recurring"
          />
          <BillsToEnter
            periods={periods}
            recurring={recurringItems}
            canEdit={canEditEntries}
            create={(body) => entries.create(body)}
            onWritten={refresh}
          />
        </div>
      </Section>

      <Section
        id="overview.costs.section.entries"
        title="Costs"
        lede="Everything paid for: purchases, fees, and each recorded bill of a recurring cost. Mark an item that has to be delivered, and add the day it arrived. Paste a list from a spreadsheet to add many at once; a negative amount is a refund."
      >
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Show
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
              data-ui-bridge-id="overview.costs.entries.filter"
            >
              <option value={ALL}>every category</option>
              {categoryItems.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="none">no category</option>
            </select>
          </label>
          <RecordSection<CostEntry, EntryRow>
            resource={COST_ENTRIES}
            table={entriesTable}
            records={shownEntries}
            toRow={entryToRow}
            writable={ENTRY_WRITABLE}
            rowProblem={entryRowProblem}
            toBody={(fields) => ({ ...fields })}
            label={(row) =>
              [
                row.description || "A cost",
                recurringName(row.recurring_cost_id),
              ]
                .filter(Boolean)
                .join(" — ")
            }
            describe={describeEntry}
            canEdit={canEditEntries}
            create={entries.create}
            update={entries.update}
            remove={deleteCostEntry}
            drop={entries.drop}
            replace={entries.replace}
            onWritten={refresh}
            uiBridgeId="overview.costs.entries"
          />
        </div>
      </Section>

      <Section
        id="overview.costs.section.months"
        title="By month"
        lede="What was spent each month, by category."
      >
        {summary.state === "ready" ? (
          <MonthTable
            months={summary.summary.months}
            categoryName={categoryName}
          />
        ) : (
          <Loading uiBridgeId="overview.costs.months.loading" />
        )}
      </Section>

      <Section
        id="overview.costs.section.categories"
        title="Categories"
        lede="The headings costs are grouped under. A category still in use cannot be removed — move its costs first."
      >
        <div className="space-y-3">
          {categoryItems.length === 0 && canEditCategories && (
            <div
              className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground"
              data-ui-bridge-id="overview.costs.categories.starter"
            >
              <span>
                Start with the usual headings:{" "}
                {STARTER_CATEGORIES.map((c) => c.name).join(", ")}.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={seeding}
                onClick={() => void seedCategories()}
                data-ui-bridge-id="overview.costs.categories.starter.add"
              >
                Add them
              </Button>
              {seedErrors.length > 0 && (
                <span role="alert" className="text-destructive">
                  {seedErrors.join(" ")}
                </span>
              )}
            </div>
          )}
          <RecordSection<CostCategory, CategoryRow>
            resource={COST_CATEGORIES}
            table={CATEGORY_TABLE}
            records={categoryItems}
            toRow={categoryToRow}
            writable={CATEGORY_WRITABLE}
            matchKey={categoryKey}
            toBody={(fields) => ({ ...fields })}
            label={(row) => row.name || "A category"}
            describe={describeCategory}
            canEdit={canEditCategories}
            create={categories.create}
            update={categories.update}
            remove={deleteCostCategory}
            drop={categories.drop}
            replace={categories.replace}
            onWritten={refresh}
            uiBridgeId="overview.costs.categories"
          />
        </div>
      </Section>
    </div>
  );
}
