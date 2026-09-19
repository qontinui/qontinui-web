export type Status = "Planned" | "In progress" | "Done" | "At risk";

export type LabourBillingType = "unbilled" | "day_rates" | "fixed_fee";
export type EstimatePurpose = "budget" | "comparison" | "forecast";

export type OverviewSettings = {
  projectName: string;
  baseCurrency: string;
  labourBilling: LabourBillingType;
  estimate?: {
    name: string;
    purpose: EstimatePurpose;
    tiers?: { name: string; multiplier: number; primary: boolean }[];
    contingencyPct?: number;
  };
  canEdit: boolean;
};

export type Goal = { title: string; description: string; status: Status };
export type Milestone = { id: string; title: string; date: string; status: Status; description?: string };
export type ProgressItem = { title: string; date: string; detail: string };

export type Phase = {
  id: string;
  name: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  status: Status;
};

export type Task = {
  id: string;
  phaseId: string;
  title: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  critical: boolean;
  status: Status;
};

export type Gate = {
  id: string;
  phaseId: string;
  name: string;
  plannedDate: string;
  criteria: string;
  status: "Pending" | "Passed" | "Failed" | "Waived";
  actualDate?: string;
  note?: string;
};

export type Decision = {
  id: string;
  code: string;
  question: string;
  status: "Open" | "Blocking" | "Decided" | "Removed";
  neededBy: string; // phase or date
  decision?: string;
  decidedOn?: string;
};

export type Risk = {
  id: string;
  code: string;
  risk: string;
  consequence: string;
  mitigation: string;
  owner: string;
  status: "Open" | "Mitigating" | "Closed" | "Occurred";
  likelihood?: number; // 1-5
  impact?: number; // 1-5
};

export type Vendor = {
  id: string;
  name: string;
  category: string;
  status: "Manual" | "Recurring" | "Connected" | "Failed";
  lastSyncDate?: string;
  description?: string;
};

export type CostEntry = {
  id: string;
  vendorId: string;
  date: string;
  amountMicros: number;
  originalCurrency?: string;
  originalAmountMicros?: number;
  category: string;
  description: string;
  phaseId?: string;
  repeatsMonthly?: boolean;
  seatsOrUnits?: number;
  unitPriceMicros?: number;
};

export type TimeEntry = {
  id: string;
  date: string;
  person: string;
  hours: number;
  role?: string; // only when labourBilling is "day_rates"
  phaseId: string;
  note?: string;
};

export type Document = {
  id: string;
  title: string;
  type: "Written" | "Uploaded";
  documentNumber?: string;
  status?: string;
  owner?: string;
  content?: string; // markdown
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  updatedBy?: string;
  updatedDate: string;
  versions?: { date: string; by: string }[];
};

export type WikiTopic = {
  id: string;
  title: string;
  slug: string;
  content: string; // markdown with [[links]]
  linkedFrom?: string[];
  updatedBy?: string;
  updatedDate: string;
};

export type Slide = {
  id: string;
  content: string; // markdown with --- separators
  notes?: string;
};

export type SlideDeck = {
  id: string;
  title: string;
  slides: Slide[];
  updatedDate: string;
};

export type Diagram = {
  id: string;
  title: string;
  description?: string;
  source: string; // mermaid source
  updatedDate: string;
};

export type ProjectOverviewData = {
  settings: OverviewSettings;
  about?: string;
  goals?: Goal[];
  recentProgress: ProgressItem[];
  phases: Phase[];
  tasks: Task[];
  gates: Gate[];
  milestones: Milestone[];
  decisions: Decision[];
  risks: Risk[];
  vendors: Vendor[];
  costs: CostEntry[];
  timeEntries: TimeEntry[];
  documents: Document[];
  wikiTopics: WikiTopic[];
  slides: SlideDeck[];
  diagrams: Diagram[];
};

// Utility functions
export const formatMoney = (micros: number | undefined, currency: string): string => {
  if (micros == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: micros >= 1_000_000_000 ? 0 : 2,
  }).format(micros / 1_000_000);
};

export const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

export const formatDate = (dateStr: string): string =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${dateStr}T12:00:00`)
  );

export const daysUntil = (dateStr: string): number =>
  Math.ceil((new Date(`${dateStr}T12:00:00`).getTime() - Date.now()) / 86400000);

export const overviewData = { milestonesDone: 2, milestonesTotal: 3, nextMilestone: undefined, monthlyBudgetMicros: 0, spendThisMonthMicros: 0, totalSpendMicros: 0, intent: "", goals: [], recentProgress: [] } as any;
export const money = (micros?: number) => formatMoney(micros, "USD");
export const percent = (value: number) => formatPercent(value);
export const dateLabel = (date: string) => formatDate(date);
export const daysAway = (date: string) => daysUntil(date);

export const relativeDate = (dateStr: string): string => {
  const days = daysUntil(dateStr);
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
};
