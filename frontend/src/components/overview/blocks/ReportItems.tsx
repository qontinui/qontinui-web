"use client";

/**
 * `report-items group=<id or all>` — a status list (recommendations, plans …)
 * at the stop the page shows, in plain words, with what changed since the
 * compared stop (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3).
 *
 * Statuses read as the Summary reads them — Planned / In progress / Done /
 * Blocked / Status unknown — plus Dropped (`vocabulary.ts`), each a shape and
 * a word.
 *
 * ## Technical references sit below the fold
 *
 * An item's links (pull requests, commits, in-app pages) are technical
 * references, and the founding plan's D4 keeps them out of a business
 * reader's way: they appear only inside that item's "Technical details"
 * disclosure. The disclosure's body is NOT RENDERED while it is closed — not
 * hidden, absent — so nothing in it is in the page until a reader asks for
 * it. A snapshot published without links (a device with no first-party owners
 * configured publishes link-free) simply has no disclosure.
 *
 * A link is rendered only in one of the two forms the server's link rule
 * accepts (a GitHub pull request or commit, or an in-app `/overview/` path);
 * anything else is shown as its label, never followed.
 */

import Link from "next/link";
import { useId, useState } from "react";
import type { components } from "@/lib/api-client/generated-types";
import { formatDay } from "@/app/(app)/overview/_lib/timeline";
import type { ReportBlockProps, ReportItemsArgs } from "./blockArgs";
import {
  BlockFrame,
  BlockNotice,
  ReportContextLine,
  ReportNotReady,
  StopProvenance,
} from "./blockChrome";
import {
  snapshotDoc,
  useReport,
  type ReadyReport,
  type SnapshotChanges,
} from "./ReportContext";
import { Served, servedText } from "./served";
import { statusWords } from "./vocabulary";

type Schemas = components["schemas"];
type Item = Schemas["SnapshotItem"];
type Group = Schemas["SnapshotGroup"];
type ItemLink = Schemas["SnapshotLink"];

const GITHUB_LINK =
  /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+\/(?:pull\/[0-9]+|commit\/[0-9a-f]{7,40})$/;

function isInAppPath(url: string): boolean {
  return url.startsWith("/overview/") && !url.includes("//");
}

function TechnicalLink({ link }: { link: ItemLink }) {
  const label = <Served text={link.label} />;
  if (GITHUB_LINK.test(link.url)) {
    return (
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline-offset-4 hover:underline"
      >
        {label}
      </a>
    );
  }
  if (isInAppPath(link.url)) {
    return (
      <Link
        href={link.url}
        className="text-primary underline-offset-4 hover:underline"
      >
        {label}
      </Link>
    );
  }
  return <span>{label}</span>;
}

function TechnicalDetails({
  item,
  uiBridgeId,
}: {
  item: Item;
  uiBridgeId: string;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (item.links.length === 0) return null;
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        className="inline-flex min-h-9 items-center rounded-sm text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-ui-bridge-id={`${uiBridgeId}.technical-toggle`}
      >
        {open ? "Hide technical details" : "Technical details"}
      </button>
      {open && (
        <ul
          id={bodyId}
          className="mt-1 space-y-0.5 text-xs"
          data-ui-bridge-id={`${uiBridgeId}.technical`}
        >
          {item.links.map((link, i) => (
            <li key={`${link.url}:${i}`}>
              <TechnicalLink link={link} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemRow({
  item,
  changes,
  comparedLabel,
  uiBridgeId,
}: {
  item: Item;
  changes: SnapshotChanges | null;
  comparedLabel: string;
  uiBridgeId: string;
}) {
  const status = statusWords(item.status);
  const change = changes?.items.find((c) => c.item_id === item.id);
  const id = `${uiBridgeId}.item.${item.id}`;
  return (
    <li className="border-t border-border/60 py-2" data-ui-bridge-id={id}>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span
          className="inline-flex items-baseline gap-1 text-xs font-medium text-muted-foreground"
          data-status={item.status}
          data-ui-bridge-id={`${id}.status`}
        >
          <span aria-hidden>{status.shape}</span>
          {status.label}
        </span>
        <span className="text-foreground">
          <Served text={item.label} />
        </span>
      </p>
      {item.status_note && (
        <p className="mt-0.5 text-foreground">
          <Served text={item.status_note} />
        </p>
      )}
      {item.help && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          <Served text={item.help} />
        </p>
      )}
      {change && (
        <p
          className="mt-0.5 text-xs text-muted-foreground"
          data-ui-bridge-id={`${id}.change`}
        >
          {change.new || change.from_status === null
            ? `New since ${comparedLabel}.`
            : `Was ${statusWords(change.from_status).label} at ${comparedLabel}.`}
        </p>
      )}
      {item.events.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {item.events.map((event, i) => (
            <li key={`${event.at}:${i}`}>
              {formatDay(event.at) ?? event.at}: <Served text={event.label} />
            </li>
          ))}
        </ul>
      )}
      <TechnicalDetails item={item} uiBridgeId={id} />
    </li>
  );
}

function GroupHeading({ group }: { group: Group | null }) {
  if (group === null) {
    return <h3 className="mt-3 font-medium text-foreground">Other items</h3>;
  }
  return (
    <div className="mt-3">
      <h3 className="font-medium text-foreground">
        <Served text={group.label} />
        {group.due && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            due {formatDay(group.due) ?? group.due}
          </span>
        )}
      </h3>
      {group.help && (
        <p className="text-xs text-muted-foreground">
          <Served text={group.help} />
        </p>
      )}
    </div>
  );
}

function Items({
  report,
  groupId,
  uiBridgeId,
}: {
  report: ReadyReport;
  groupId: string;
  uiBridgeId: string;
}) {
  const { selected, compared, view } = report;
  if (!selected) {
    return (
      <BlockNotice
        title="No stops have been published for this report yet."
        uiBridgeId={`${uiBridgeId}.empty`}
      />
    );
  }
  const doc = snapshotDoc(selected);
  const changes = selected.changes_since_previous;
  const comparedLabel = compared
    ? servedText(compared.label)
    : "the stop before";
  const header = (
    <ReportContextLine title={view.report.title} stop={selected} />
  );
  if (doc === null) {
    return (
      <>
        {header}
        <BlockNotice
          tone="problem"
          title="This stop's details can't be read."
          uiBridgeId={`${uiBridgeId}.unreadable`}
        />
      </>
    );
  }
  const groups: (Group | null)[] =
    groupId === "all"
      ? [...doc.groups, null]
      : doc.groups.filter((g) => g.id === groupId);
  if (groups.length === 0) {
    return (
      <>
        {header}
        <BlockNotice
          tone="problem"
          title={
            <>
              This stop has no group <code>{groupId}</code>.
            </>
          }
          detail="Check the group's id in this block's settings, or choose another stop."
          uiBridgeId={`${uiBridgeId}.no-group`}
        />
      </>
    );
  }
  const sections = groups
    .map((group) => ({
      group,
      items: doc.items.filter((item) => item.group === (group?.id ?? null)),
    }))
    .filter((s) => s.group !== null || s.items.length > 0);
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  return (
    <>
      {header}
      {total === 0 && (
        <BlockNotice
          title="This stop lists no items here."
          uiBridgeId={`${uiBridgeId}.none`}
        />
      )}
      {sections.map(({ group, items }) => (
        <section
          key={group?.id ?? "__ungrouped"}
          data-ui-bridge-id={`${uiBridgeId}.group.${group?.id ?? "other"}`}
        >
          <GroupHeading group={group} />
          {items.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing in this group at this stop.
            </p>
          ) : (
            <ul className="mt-1">
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  changes={changes}
                  comparedLabel={comparedLabel}
                  uiBridgeId={uiBridgeId}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
      <StopProvenance stop={selected} />
    </>
  );
}

export function ReportItems({
  args,
  report: slug,
}: ReportBlockProps<ReportItemsArgs>) {
  const state = useReport(slug);
  const groupId = args.group ?? "all";
  const uiBridgeId = `overview.report.${slug}.items.${groupId}`;
  return (
    <BlockFrame
      name="report-items"
      uiBridgeId={uiBridgeId}
      label="Report items"
    >
      {state.status === "ready" ? (
        <Items report={state} groupId={groupId} uiBridgeId={uiBridgeId} />
      ) : (
        <ReportNotReady state={state} uiBridgeId={uiBridgeId} />
      )}
    </BlockFrame>
  );
}
