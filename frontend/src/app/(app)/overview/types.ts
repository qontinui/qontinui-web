export type Status = "Planned" | "In progress" | "Done" | "At risk";

export type Goal = { title: string; description: string; status: Status };
export type Milestone = { title: string; date: string; status: Status; description: string };
export type ProgressItem = { title: string; date: string; detail: string };
export type OverviewData = {
  intent?: string;
  milestonesDone: number;
  milestonesTotal: number;
  nextMilestone?: Milestone;
  spendThisMonthMicros?: number;
  monthlyBudgetMicros?: number;
  totalSpendMicros?: number;
  goals?: Goal[];
  recentProgress: ProgressItem[];
};

export const overviewData: OverviewData = {
  intent: `Customer Portal Modernization gives enterprise customers a clearer, faster way to manage their accounts, subscriptions, and support requests.\n\nThe work brings the most important customer journeys into one dependable portal, while giving account teams better visibility into adoption and service health.\n\nSuccess means less time spent searching for answers, fewer avoidable support contacts, and a smoother renewal experience.`,
  milestonesDone: 18,
  milestonesTotal: 31,
  nextMilestone: { title: "Pilot launch with customer advisory group", date: "2026-10-14", status: "In progress", description: "Invite 12 customer champions to the guided pilot." },
  spendThisMonthMicros: 6840000000,
  monthlyBudgetMicros: 7200000000,
  totalSpendMicros: 48350000000,
  goals: [
    { title: "Reduce support searching", description: "Customers find account answers without contacting support.", status: "In progress" },
    { title: "Improve renewal readiness", description: "Account teams see usage and open actions in one place.", status: "Planned" },
    { title: "Make the portal feel dependable", description: "Core journeys remain fast and available during peak periods.", status: "Done" },
  ],
  recentProgress: [
    { title: "Account overview is now available to internal reviewers", date: "2026-09-16", detail: "Reviewers can see entitlements, usage, and open actions together." },
    { title: "Self-service billing history completed", date: "2026-09-12", detail: "Customers can download invoices and view payment status." },
    { title: "Support request handoff refined", date: "2026-09-08", detail: "Requests arrive with the account context already attached." },
    { title: "Accessibility review completed", date: "2026-09-02", detail: "Keyboard navigation and contrast checks passed." },
    { title: "Pilot feedback themes summarized", date: "2026-08-28", detail: "Three improvements were prioritized for the pilot release." },
  ],
};

export const money = (micros?: number) => micros == null ? "Not available" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: micros >= 1_000_000_000 ? 0 : 2 }).format(micros / 1_000_000);
export const percent = (value: number) => `${Math.round(value * 100)}%`;
export const dateLabel = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`));
export const daysAway = (value: string) => Math.ceil((new Date(`${value}T12:00:00`).getTime() - Date.now()) / 86400000);
