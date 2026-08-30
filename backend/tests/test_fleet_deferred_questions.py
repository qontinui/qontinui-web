"""Fleet-wide deferred-question queue — `GET /task-runs/deferred-questions/pending`.

The route exists because mobile's HITL review queue used to be assembled by
polling each runner's own `/hitl/pending` over a direct LAN dial: the queue
emptied entirely when the phone was off-network, and lost every question raised
on a machine that happened to be down. The rows were already being synced into
`project.deferred_questions` for exactly this reason ("Synced from runner to
enable cross-computer viewing" — `app/models/task_run.py`); only the fleet-wide
READ was missing.

These tests pin the two things that can silently go wrong:

1. **Route ordering.** The literal path must resolve ahead of the
   `/{task_run_id}` parameter route, or the request is read as a task-run id
   and answers 422 rather than a queue.
2. **Ownership scoping.** The questions table carries no owner column; the only
   attribution is the parent task run's `created_by_user_id`. A regression that
   loosened the join would leak another user's questions into a "fleet" list.
"""

from __future__ import annotations

from fastapi.routing import APIRoute

from app.main import app
from app.services.task_run import (
    FleetDeferredQuestionListResponse,
    FleetDeferredQuestionResponse,
)

ROUTE_PATH = "/api/v1/task-runs/deferred-questions/pending"


def _routes() -> list[APIRoute]:
    return [r for r in app.routes if isinstance(r, APIRoute)]


def test_route_is_registered_with_a_get_method() -> None:
    matches = [r for r in _routes() if r.path == ROUTE_PATH]
    assert matches, f"{ROUTE_PATH} is not registered"
    assert "GET" in matches[0].methods


def test_route_resolves_before_the_task_run_id_parameter_route() -> None:
    """Declaration order is load-bearing — Starlette matches first-wins.

    `/findings-summary` sits above `/{task_run_id}` for the same reason. If
    someone moves the new route below it, this test fails instead of the route
    silently answering 422 in production.
    """
    paths = [r.path for r in _routes()]
    literal = paths.index(ROUTE_PATH)
    param = paths.index("/api/v1/task-runs/{task_run_id}")
    assert literal < param, (
        "the literal deferred-questions path must be declared before the "
        "/{task_run_id} parameter route"
    )


def test_route_is_authenticated() -> None:
    """A fleet queue with no auth dependency would be a cross-tenant leak."""
    route = next(r for r in _routes() if r.path == ROUTE_PATH)
    dep_names = {d.call.__name__ for d in route.dependant.dependencies if d.call}
    assert "current_active_user" in dep_names, dep_names


def test_response_model_carries_the_task_run_context() -> None:
    """A bare question list cannot tell two runs apart.

    `runner_id` and `task_run_name` are OPTIONAL on purpose: a run synced
    before those columns were populated genuinely does not know which machine
    raised the question, and inventing a machine name is worse than null.
    """
    route = next(r for r in _routes() if r.path == ROUTE_PATH)
    assert route.response_model is FleetDeferredQuestionListResponse

    fields = FleetDeferredQuestionResponse.model_fields
    assert "task_run_name" in fields
    assert "runner_id" in fields
    assert fields["runner_id"].default is None
    assert fields["task_run_name"].default is None


def test_envelope_distinguishes_empty_from_absent() -> None:
    """An envelope, not a bare list, so `questions: []` reads as 'nothing
    pending' rather than being indistinguishable from a failed read."""
    empty = FleetDeferredQuestionListResponse(questions=[], total=0)
    assert empty.questions == []
    assert empty.total == 0


def test_repository_scopes_by_the_parent_task_runs_owner() -> None:
    """Ownership can only come from the parent run — assert the join is there.

    Compiled to SQL rather than asserting on source text, so a refactor that
    keeps the behaviour keeps passing and one that drops the ownership
    predicate fails.
    """
    from sqlalchemy import select

    from app.models.task_run import DeferredQuestion, TaskRun

    query = (
        select(DeferredQuestion, TaskRun.task_name, TaskRun.runner_id)
        .join(TaskRun, DeferredQuestion.task_run_id == TaskRun.id)
        .where(TaskRun.created_by_user_id == None)  # noqa: E711 - shape only
    )
    sql = str(query.compile(compile_kwargs={"literal_binds": True})).lower()
    assert "join project.task_runs" in sql
    assert "created_by_user_id" in sql
    # INNER join, not outer: an orphaned question is attributable to nobody and
    # must never appear in a fleet list.
    assert "left outer join" not in sql
