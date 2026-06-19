# Bug note: cross-tenant leak in the fleet "connected runners" view

**Component:** `qontinui-web/backend`
**File:** `app/api/v1/endpoints/operations.py`
**Severity:** Medium–High (cross-tenant information disclosure + one cross-tenant tampering/DoS vector)
**Status:** Fixed (contained mitigation applied); durable fix recommended as follow-up.

## Summary

The `GET /api/v1/operations/fleet` "connected runners" view (and several sibling
endpoints) merged data from the **process-global, unauthenticated** fleet beacon
registry into every authenticated caller's response **without any owner/tenant
filter**. As a result, a logged-in user saw — and had their own `user_id`
stamped onto — *every other tenant's* beaconing runners, running-task prompts,
and Claude sessions. Two per-runner endpoints additionally allowed acting on
*any* runner by id with no ownership check (IDOR), including a DELETE that
removes another tenant's runner from the registry.

This is how the symptom was discovered: tenant A's Fleet **health** board
(coord-backed, correctly tenant-scoped) showed `0 devices`, while the
**connected** list (beacon-backed) showed tenant B's `MSI` and `spaceship`
runners as if they were tenant A's.

## Root cause

- `POST /operations/heartbeat` is intentionally **unauthenticated** (LAN beacon)
  and `RunnerHeartbeat` carries **no owner/tenant identity** — only
  `hostname/ip/port/os/...`.
- `FleetRegistry` (`app/services/dev_dashboard_service.py`) is a single
  **process-global** dict keyed by `hostname:port`.
- The read endpoints merged that global registry into per-user responses with
  no scoping, and `get_fleet_status` even set `"userId": str(current_user.id)`
  on beacons that weren't the caller's.

## Affected endpoints (all in `operations.py`)

| Endpoint | Leak |
| --- | --- |
| `GET /operations/fleet` | Lists all tenants' beacon runners; `claude_sessions`, `total_running_tasks`, `total_claude_sessions` aggregated across all tenants. |
| `GET /operations/fleet/tasks` | Returns running tasks (incl. prompts/ids) from all tenants' runners. |
| `GET /operations/fleet/runners/{runner_id}/output` | IDOR: reads any runner's task output by id. |
| `GET /operations/fleet/runners/{runner_id}/workflow-state` | IDOR: reads any runner's workflow state by id. |
| `DELETE /operations/fleet/runners/{runner_id}` | IDOR: removes any tenant's runner from the registry (tampering/DoS). |

> Note: the coord-backed surfaces (`/operations/fleet/health`, `/devices`) were
> **not** affected — they proxy to coord and are correctly tenant-scoped. Only
> the beacon-fed surfaces leaked.

## Fix applied (contained mitigation)

Beacons have no identity, so we scope them by the **hostnames the caller already
owns a device on** (from `runner_crud.list_runners(db, current_user.id)`):

- `get_fleet_status`: only merge a beacon when its hostname is in the caller's
  `owned_hostnames`; compute `claude_sessions` / `total_running_tasks` /
  `total_claude_sessions` over owned hostnames only.
- `get_all_tasks` (`/fleet/tasks`): filter task runs to `runner_hostname` in
  `owned_hostnames`.
- `get_runner_task_output`, `get_runner_workflow_state`, `remove_runner`: new
  `_caller_owns_runner_host(db, user_id, runner_id)` guard — the host encoded in
  `runner_id` (`hostname:port`) must be one the caller owns; otherwise `404`.

### Residual limitation

Hostname-matching is a heuristic: two tenants with the **same hostname** (e.g.
both have a machine literally named `MSI`) could still cross-see beacons if both
own a device on that name. Also, a brand-new machine that beacons *before* its
first pairing won't appear in the owner's connected list (it has no owned
device yet) — surfacing un-paired devices should go through the explicit pairing
flow instead.

## Recommended durable fix (follow-up)

Give beacons real identity and scope the registry by it:

1. Add an authenticated owner/tenant to the heartbeat — e.g. require the runner
   to present its paired identity (the `paired_user.json` / coord device token)
   on `POST /heartbeat`, and store `owner_user_id` / `tenant_id` on
   `RegisteredRunner`.
2. Key/filter `FleetRegistry` by that owner, and drop the `current_user.id`
   stamping.
3. Then the hostname heuristic above can be removed.

## Tests

`tests/test_operations_fleet_totals.py`:
- `test_totals_present_and_correct` — updated: beacon on an **owned** host is
  admitted and counts toward totals.
- `test_beacon_on_unowned_host_is_filtered` — **new** regression guard: a beacon
  on a host the caller owns no device on does not appear and does not leak into
  totals or Claude sessions.
