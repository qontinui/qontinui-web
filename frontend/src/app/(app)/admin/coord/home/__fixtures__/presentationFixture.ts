/**
 * The coordination overview's presentation proof fixture (plan
 * `2026-10-23-console-presentation-spaces` Phase 2; used by
 * `../page.presentation.test.tsx`).
 *
 * Coord's project-state bodies that feed EVERY free-text carrier
 * `/admin/coord/home` can render, each holding an identifier no evaluator
 * may see: the tenant's name and id; a question's text, recommendation,
 * consequence, options and the work unit it blocks; the decision kinds
 * parsed out of question text (`needs_me.by_domain` keys its table does not
 * name — one with a client's name, one without); an approval's text;
 * degradation headlines and subjects of every kind (a machine, a repository,
 * a cloud resource — one of them named like a first-party repository — an
 * alert key, a drained machine); watcher names; coord's
 * reasons and error chains; repository names; unit titles and slugs; the
 * initiative's items, keys, status, dates and reasons; and a failed read's
 * own text, and `does_not_know` sources the page's table does not label (whose
 * operator label is coord's identifier). Every such identifier carries a
 * client name (`Acme`, `Globex` —
 * both confidential terms in {@link SCOPE}), is a UUID, or is listed in
 * {@link MUST_NOT_APPEAR} by itself.
 *
 * One first-party repository (`qontinui/qontinui-web`) carries a merge-train
 * headline and a unit title the scope DOES clear, so the proof shows the lens
 * redacts what it must and still shows what it may.
 */

import type { PresentationScopeState } from "@/components/presentation";

export const TENANT_ID = "5e1d0c3b-7a4f-4b2e-9c11-0a7d3e2f4b61";
export const TENANT_NAME = "Acme Corp Holdings";

export const QUESTION_ID = "9f3b2a71-4c5d-4e6f-8a9b-0c1d2e3f4a5b";
export const OPEN_QUESTION_ID = "3a2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d";
export const GATE_ID = "7c6b5a49-3d2e-4f10-9e8d-7c6b5a493d2e";

export const DEVICE_BUILD = "0b9d6a54-1111-4000-8000-0000000000a1";
export const DEVICE_DRAINED = "0b9d6a54-2222-4000-8000-0000000000a2";
export const HOST_BUILD = "build-host-acme-07";
export const HOST_DRAINED = "gpu-box-globex-3";

export const FIRST_PARTY_REPO = "qontinui/qontinui-web";
export const FOREIGN_REPO = "acme-partner/secret-repo";
/** First-party by name but not by owner: coord's bare work-unit repository. */
export const BARE_REPO = "qontinui-runner";

/** A unit only the first-party repository names, with every list complete. */
export const FIRST_PARTY_UNIT_TITLE = "Overview copy pass";
export const FIRST_PARTY_UNIT_SLUG = "2026-09-05-overview-copy";
/** Named under the first-party AND the foreign repository: withheld. */
export const SHARED_UNIT_TITLE = "Shared rollout across two repositories";
/**
 * Named only under the first-party repository, but the foreign repository's
 * list of the same kind was cut short and may hide it: withheld.
 */
export const HIDDEN_UNIT_TITLE = "Web release gate wait";
/** A first-party headline the scope clears, so it shows while presenting. */
export const FIRST_PARTY_HEADLINE = "A repo's merge train is wedged";

/**
 * A cloud service whose NAME parses as a first-party repository. It is a
 * service, not a repository, so neither its name nor its headline is bound
 * to one: both are withheld while presenting, though the scope would clear
 * `qontinui/…` as a repository.
 */
export const FIRST_PARTY_SHAPED_SERVICE = "qontinui/ledger-db";

/**
 * Decision kinds parsed out of escalation questions' text, the shape coord's
 * `needs_me` work (qontinui-coord#3053 and its successor) serves
 * (`escalation_domain`, which it calls "caller-controlled"): one names a
 * client, one names no one — and neither is in the page's table, so both are
 * folded into fixed words while presenting. `operator_gate` is that work's own
 * bucket and shows.
 */
export const CLIENT_DOMAIN = "Acme Corp contract renewal";
export const UNNAMED_DOMAIN = "quarterly_board_pack";

/** What a refresh that fails says for itself — a host and coord's body. */
export const REFRESH_FAILURE =
  'GET https://coord.globex.internal/coord/project-state failed: 502 - {"error":"upstream build-host-acme-07"}';

/**
 * A deployment without the project-state door answers 404 — here with a body
 * that names a host. The page explains the arm in its own fixed words.
 */
export const ROUTE_UNAVAILABLE_BODY =
  '{"detail":"Not Found: no route on coord.globex.internal"}';

/**
 * The web proxy's own refusal when its wait for coord runs out
 * (`_coord_timeout(write=False)`), as its refusal handler serves it — its
 * request path naming a host. The page explains it in fixed words, never the
 * refusal's rendered sentence, which carries coord's discriminator token.
 */
export const PROXY_TIMEOUT_REFUSAL_BODY =
  '{"error":"GATEWAY_TIMEOUT","message":"timeout waiting for coord","refusal":{"code":"upstream_timeout","detail":"timeout waiting for coord","discriminator":"coord_timeout","glossary_terms":["coord"],"next_action":{"kind":"retry_later"},"observed_at":"2026-10-27T16:27:56.834400+00:00","source":"web_backend"},"timestamp":1793118476.83,"path":"https://api.globex.internal/project-state"}';

/** `does_not_know` sources coord serves, each labelled in the page's table. */
export const ALERT_VISIBILITY_SOURCE =
  "coord.alerts visibility (operator-plane kinds this caller can be served)";
export const HEADROOM_SOURCE = "fleet_health resource headroom (live machines)";

/** Sources the page's table does not label: what coord may add without it. */
export const UNLABELLED_FEED_SOURCE =
  "coord.example_feed visibility (kinds this caller can be served)";
export const UNLABELLED_LANE_SOURCE =
  "fleet_health example_lane (live machines)";

/** The redaction scope: our owner is first-party; two clients are confidential. */
export const SCOPE: PresentationScopeState = {
  status: "ready",
  scope: {
    firstPartyOwners: ["qontinui"],
    confidentialTerms: ["Acme", "Globex"],
  },
};

/**
 * Everything the fixture holds that presentation mode must never render — in
 * text, in a `title` or `aria-label`, or in any other attribute (an `href`, a
 * row key). Matched ignoring case. Tokens of coord's own (row ids, source ids,
 * reason tokens) are here too: R8's raw last line is the operator's.
 */
export const MUST_NOT_APPEAR: readonly string[] = [
  // Client names, which every client-bearing identifier below contains.
  "acme",
  "globex",
  // Identifiers with no client name in them.
  TENANT_ID,
  QUESTION_ID,
  OPEN_QUESTION_ID,
  GATE_ID,
  DEVICE_BUILD,
  DEVICE_DRAINED,
  BARE_REPO,
  SHARED_UNIT_TITLE,
  "2026-09-03-shared-unit",
  HIDDEN_UNIT_TITLE,
  "2026-09-06-web-gate",
  FIRST_PARTY_UNIT_SLUG,
  "Orphan note",
  "2026-09-07-orphan",
  "Restart the service on Tuesday",
  "Rotate the signing key",
  "Remote runner access",
  "remote-runner",
  // A decision kind parsed out of a question's text, with no client
  // name in it: withheld because the page's table does not name it.
  UNNAMED_DOMAIN,
  "quarterly board pack",
  // A service named like a first-party repository: still not a repository.
  FIRST_PARTY_SHAPED_SERVICE,
  // Coord's identifiers for the sources the table labels, in their raw titles.
  "coord.alerts",
  "resource headroom",
  // Sources the page's table does not label: coord's identifiers, humanised
  // for the operator, never shown while presenting.
  "example_feed",
  "example feed",
  "example_lane",
  "example lane",
  // Coord's own tokens: row ids, source ids, reason and response tokens.
  "alert:",
  "train_health",
  "infra_health",
  "fleet_drain",
  "fleet_health",
  "work_units",
  "watcher:",
  "runner_restart",
  "verification_metrics_door_absent",
  "no_successful_tick",
  "agent_question",
  "operator_gate",
  "coord_timeout",
];

const CLASSES = {
  shipped: 4,
  in_flight: 2,
  stalled: 2,
  blocked_on_dependency: 0,
  waiting_on_gate: 2,
  not_started: 1,
  closed_other: 0,
  off_vocabulary: 0,
  unset: 0,
};

function unit(
  slug: string,
  title: string | null,
  basis: "last_recorded_change" | "first_in_progress" = "last_recorded_change"
) {
  return {
    slug,
    title,
    first_in_progress_at: "2026-09-01T00:00:00Z",
    last_recorded_change_at: "2026-09-02T00:00:00Z",
    age_secs: 30 * 86_400,
    age_basis: basis,
  };
}

/** Minutes before now, as ISO-8601. */
function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * Coord's body with every block READ (degradations read stale, so its rows
 * AND its gap sentence render), every list populated, and every carrier fed.
 */
export function fullBody(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    generated_at: ago(2),
    tenant_id: TENANT_ID,
    scope: "operator",
    needs_me: {
      state: "read",
      total: 3,
      omitted: 0,
      // Every row in exactly one bucket, so the buckets sum to `total`.
      by_domain: {
        [CLIENT_DOMAIN]: 1,
        operator_gate: 1,
        [UNNAMED_DOMAIN]: 1,
      },
      retirement: "unknown",
      items: [
        {
          source: "agent_question",
          id: QUESTION_ID,
          asked_at: ago(90),
          age_secs: 5400,
          fork: "Ship the Acme Corp pilot before the audit?",
          options: ["Ship to Acme now", { label: "Wait for Globex" }],
          recommendation: "Hold until Globex signs the data agreement",
          if_overturned: `The pilot would run on ${HOST_BUILD} without a contract`,
          shape: "fork_with_recommendation",
          answer_at: `/admin/coord/questions/${QUESTION_ID}`,
          blocking: {
            work_unit_slug: "2026-10-01-acme-pilot-rollout",
            plan_phase: "the Acme phase",
          },
        },
        {
          source: "operator_gate",
          id: GATE_ID,
          asked_at: ago(60),
          age_secs: 3600,
          fork: "Approve the deploy to acme-prod-db-2",
          options: [],
          recommendation: null,
          if_overturned: null,
          shape: "open_question",
          answer_at: `/admin/coord/gates/${GATE_ID}`,
          blocking: { work_unit_slug: null, plan_phase: "3" },
        },
        {
          source: "agent_question",
          id: OPEN_QUESTION_ID,
          asked_at: ago(30),
          age_secs: 1800,
          fork: "Rotate the signing key before Friday?",
          options: null,
          recommendation: "Restart the service on Tuesday",
          if_overturned: "Rotate the signing key later",
          shape: "fork_with_recommendation",
          answer_at: "//elsewhere.example/answer",
          blocking: null,
        },
      ],
    },
    degradations: {
      state: "stale",
      headline: "unknown",
      headline_reason: `watcher acme_runner_watcher is stale; fleet_health roster (${HOST_BUILD}) not fully read`,
      recently_cleared_window_secs: 86_400,
      open: [
        {
          id: "alert:41",
          plane: "runner",
          subject: { kind: "device", name: HOST_BUILD, id: DEVICE_BUILD },
          headline: `A runner stopped answering on ${HOST_BUILD}`,
          onset_observed_at: ago(180),
          last_seen_at: ago(1),
          age_secs: 10_800,
          auto_remediation: { bound: true, response: "agent:runner_restart" },
          drill: "/admin/coord/devops",
          declared: false,
        },
        {
          id: `train_health:${FOREIGN_REPO}`,
          plane: "merge_train",
          subject: { kind: "repo", name: FOREIGN_REPO, id: FOREIGN_REPO },
          headline: FIRST_PARTY_HEADLINE,
          onset_observed_at: null,
          last_seen_at: ago(1),
          age_secs: null,
          auto_remediation: null,
          drill: "/admin/coord/pipeline",
          declared: false,
        },
        {
          id: `train_health:${FIRST_PARTY_REPO}`,
          plane: "merge_train",
          subject: {
            kind: "repo",
            name: FIRST_PARTY_REPO,
            id: FIRST_PARTY_REPO,
          },
          headline: FIRST_PARTY_HEADLINE,
          onset_observed_at: null,
          last_seen_at: ago(1),
          age_secs: null,
          auto_remediation: null,
          drill: "/admin/coord/pipeline",
          declared: false,
        },
        {
          id: "infra_health:rds:acme-ledger-db",
          plane: "cloud_service",
          subject: {
            kind: "service",
            name: "rds:acme-ledger-db",
            id: "rds:acme-ledger-db",
          },
          headline: "A cloud service is hard-down: rds:acme-ledger-db",
          onset_observed_at: null,
          last_seen_at: ago(3),
          age_secs: null,
          auto_remediation: null,
          drill: "//elsewhere.example/console",
          declared: false,
        },
        {
          id: `infra_health:${FIRST_PARTY_SHAPED_SERVICE}`,
          plane: "cloud_service",
          subject: {
            kind: "service",
            name: FIRST_PARTY_SHAPED_SERVICE,
            id: FIRST_PARTY_SHAPED_SERVICE,
          },
          headline: `A cloud service is hard-down: ${FIRST_PARTY_SHAPED_SERVICE}`,
          onset_observed_at: ago(45),
          last_seen_at: ago(1),
          age_secs: 2700,
          auto_remediation: null,
          drill: "/admin/coord/devops",
          declared: false,
        },
        {
          id: "alert:77",
          plane: "credential",
          subject: {
            kind: "key",
            name: "vault:globex-signing-key",
            id: "vault:globex-signing-key",
          },
          headline: "Credential vault:globex-signing-key expires soon",
          onset_observed_at: ago(600),
          last_seen_at: ago(1),
          age_secs: 36_000,
          auto_remediation: {
            bound: false,
            response: "operator:rotate_globex_key",
          },
          drill: "/admin/coord/gates",
          declared: false,
        },
      ],
      declared: [
        {
          id: `fleet_drain:${DEVICE_DRAINED}`,
          plane: "runner",
          subject: { kind: "device", name: HOST_DRAINED, id: DEVICE_DRAINED },
          headline: "A machine is drained by operator decision",
          onset_observed_at: ago(240),
          last_seen_at: ago(1),
          age_secs: 14_400,
          auto_remediation: { bound: false, response: "declared" },
          drill: "/admin/coord/devops",
          declared: true,
        },
      ],
      recently_cleared: [
        {
          id: "alert:12",
          plane: "disk",
          subject: { kind: "device", name: HOST_BUILD, id: DEVICE_BUILD },
          headline: `Disk nearly full on ${HOST_BUILD}`,
          onset_observed_at: ago(900),
          resolved_at: ago(800),
          duration_secs: 6000,
          declared: false,
        },
      ],
      planes: {
        runner: {
          fresh: false,
          watchers: [
            {
              name: "acme_runner_watcher",
              state: "stale",
              as_of: ago(30),
              reason: "no_successful_tick",
            },
          ],
          detection_bound_secs: 90,
        },
        merge_train: {
          fresh: true,
          watchers: [
            { name: "train_watcher_globex", state: "fresh", as_of: ago(1) },
          ],
        },
        disk: { fresh: false, watchers: [] },
      },
    },
    on_track: {
      state: "read",
      totals: { row_count: 9, classes: CLASSES },
      stall_window_secs: 1_209_600,
      history_not_recorded: 1,
      groups: [
        {
          key: FOREIGN_REPO,
          kind: "repo",
          row_count: 3,
          classes: CLASSES,
          named: {
            stalled: {
              units: [
                unit("2026-09-01-acme-migration", "Acme Corp data migration"),
                unit("2026-09-03-shared-unit", SHARED_UNIT_TITLE),
              ],
              omitted: 0,
            },
            waiting_on_gate: {
              units: [
                unit(
                  "2026-09-04-acme-gate-wait",
                  "Waiting on the Acme sign-off",
                  "first_in_progress"
                ),
              ],
              // Cut short: it may hide any unit waiting on a condition.
              omitted: 2,
            },
          },
        },
        {
          key: FIRST_PARTY_REPO,
          kind: "repo",
          row_count: 4,
          classes: CLASSES,
          named: {
            stalled: {
              units: [
                unit(FIRST_PARTY_UNIT_SLUG, FIRST_PARTY_UNIT_TITLE),
                unit("2026-09-03-shared-unit", SHARED_UNIT_TITLE),
              ],
              omitted: 0,
            },
            waiting_on_gate: {
              units: [
                unit(
                  "2026-09-06-web-gate",
                  HIDDEN_UNIT_TITLE,
                  "first_in_progress"
                ),
              ],
              omitted: 0,
            },
          },
        },
        {
          key: BARE_REPO,
          kind: "repo",
          row_count: 1,
          classes: CLASSES,
          named: {
            stalled: {
              units: [unit("2026-09-08-runner-acme", null)],
              omitted: 0,
            },
            waiting_on_gate: { units: [], omitted: 0 },
          },
        },
        {
          key: null,
          kind: "unattributed_repo",
          row_count: 1,
          classes: CLASSES,
          named: {
            stalled: {
              units: [unit("2026-09-07-orphan", "Orphan note")],
              omitted: 0,
            },
            waiting_on_gate: { units: [], omitted: 0 },
          },
        },
      ],
      initiative: {
        state: "read",
        status: "live",
        starts: "2026-10-01",
        ends: "when Acme Corp signs",
        alignment: "read",
        reason: null,
        in_scope: [
          {
            text: "Acme Corp pilot readiness",
            key: "acme-pilot",
            units: { total: 2, in_flight: 1, shipped: 1 },
          },
          {
            text: "Remote runner access",
            key: "remote-runner",
            units: { total: 1, in_flight: 0, shipped: 1 },
          },
        ],
        unattributed: { total: 3, in_flight: 1, shipped: 2 },
        unknown_key: {
          total: 1,
          in_flight: 1,
          shipped: 0,
          keys: ["globex-secret-item"],
        },
      },
    },
    correctness: {
      state: "unknown",
      reason: "verification_metrics_door_absent",
    },
    does_not_know: [
      {
        source: "work_units",
        state: "read",
        as_of: ago(2),
        freshness_bound_secs: 20,
        rows_considered: 10,
        rows_excluded: 1,
        exclusion_reason: `unit 2026-09-01-acme-migration excluded: ${FOREIGN_REPO} is not mirrored`,
      },
      {
        source: "fleet_health roster",
        state: "could_not_read",
        as_of: null,
        error: `GET fleet health for ${HOST_BUILD} (${DEVICE_BUILD}): timeout`,
      },
      {
        source: "watcher:acme_runner_watcher",
        state: "stale",
        as_of: ago(30),
        freshness_bound_secs: 90,
        error: "no_successful_tick",
      },
      {
        source: "verification_metrics",
        state: "not_implemented",
        exclusion_reason: "the door is not built for globex yet",
      },
      // Two sources the page's table labels (qontinui-coord project_state.rs
      // ALERT_VISIBILITY_SOURCE and HEADROOM_SOURCE). Their reasons name a kind
      // and a machine, so a reason is withheld even under a label that shows.
      {
        source: ALERT_VISIBILITY_SOURCE,
        state: "read",
        as_of: ago(2),
        rows_considered: 9,
        rows_excluded: 1,
        exclusion_reason:
          "an operator-plane kind is served only when its rows can reach this caller; hidden: globex_vault_expiry (repo)",
      },
      {
        source: HEADROOM_SOURCE,
        state: "read",
        as_of: ago(2),
        rows_considered: 3,
        rows_excluded: 1,
        exclusion_reason: `a live machine with no resource sample inside the lookback is not measured; not measured: ${HOST_DRAINED}`,
      },
      // Two sources the table does not label: for the operator they read as
      // coord's identifiers; presenting, in fixed words.
      {
        source: UNLABELLED_FEED_SOURCE,
        state: "read",
        as_of: ago(2),
        rows_considered: 4,
        rows_excluded: 0,
      },
      {
        source: UNLABELLED_LANE_SOURCE,
        state: "read",
        as_of: ago(2),
        rows_considered: 2,
        rows_excluded: 0,
      },
    ],
    ...overrides,
  };
}

/** Coord could not read its blocks: each says so, with coord's error chain. */
export function unreadBlocksBody() {
  return fullBody({
    needs_me: {
      state: "could_not_read",
      error: `SELECT coord.agent_questions (${TENANT_ID}): acme replica down`,
    },
    degradations: {
      state: "could_not_read",
      error: `fleet_health roster: ${HOST_BUILD} refused`,
      planes: null,
    },
    on_track: {
      state: "could_not_read",
      error: `SELECT coord.work_units (${FOREIGN_REPO}): connection refused`,
      initiative: {
        state: "unparseable",
        error: "frontmatter: unknown key `acme_contract` in initiative",
      },
    },
    correctness: { state: "could_not_read", reason: "globex probe failed" },
  });
}

/** The initiative is not live, and coord says why in its own words. */
export function noLiveInitiativeBody() {
  const body = fullBody();
  return {
    ...body,
    on_track: {
      ...body.on_track,
      initiative: {
        state: "read",
        status: "draft for Globex",
        alignment: "no_live_initiative",
        reason:
          "the document names Acme Corp as its owner; status is not `live`",
      },
    },
  };
}

/**
 * The next poll after the oldest decision was answered: the same body without
 * the first needs-you row, so every row below it moves up one place.
 */
export function firstDecisionAnsweredBody() {
  const body = fullBody();
  return {
    ...body,
    needs_me: {
      ...body.needs_me,
      total: body.needs_me.total - 1,
      by_domain: { operator_gate: 1, [UNNAMED_DOMAIN]: 1 },
      items: body.needs_me.items.slice(1),
    },
  };
}

/** Coord counted decisions for the operator but served none of them. */
export function unservedDecisionsBody() {
  return fullBody({
    needs_me: { state: "read", total: 2, omitted: 2, items: [] },
  });
}
