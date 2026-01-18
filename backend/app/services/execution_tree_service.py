"""
Service for execution tree event business logic.

Handles tree event queries, tree reconstruction, and response mapping.
Separates business logic from HTTP handling.
"""

from typing import Any
from uuid import UUID

import structlog

# Import schemas from qontinui-schemas
from qontinui_schemas.events import DisplayNode as SchemaDisplayNode
from qontinui_schemas.events import ExecutionTreeResponse
from qontinui_schemas.events import NodeMetadata as SchemaNodeMetadata
from qontinui_schemas.events import NodeStatus as SchemaNodeStatus
from qontinui_schemas.events import NodeType as SchemaNodeType
from qontinui_schemas.events import (
    PathElement,
    StateContext,
    TreeEventListResponse,
    TreeEventResponse,
)
from qontinui_schemas.events import TreeEventType as SchemaTreeEventType
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.action_execution import ActionExecution
from app.models.execution_run import ExecutionRun
from app.models.execution_tree_event import ExecutionTreeEvent
from app.repositories.action_execution import ActionExecutionRepository
from app.repositories.execution_tree_event import ExecutionTreeEventRepository

logger = structlog.get_logger(__name__)


def _model_to_tree_event_response(event: ExecutionTreeEvent) -> TreeEventResponse:
    """Convert ExecutionTreeEvent model to TreeEventResponse schema."""
    # Parse path from JSONB
    path_elements = []
    if event.path:
        for p in event.path:
            if isinstance(p, dict):
                path_elements.append(
                    PathElement(
                        id=p.get("id", ""),
                        name=p.get("name", ""),
                        node_type=SchemaNodeType(p.get("node_type", "action")),
                    )
                )

    # Parse metadata from JSONB
    metadata = None
    if event.node_metadata:
        metadata = SchemaNodeMetadata(**event.node_metadata)

    return TreeEventResponse(
        id=event.id,
        run_id=event.run_id,
        event_type=SchemaTreeEventType(event.event_type),
        node_id=event.node_id,
        node_type=SchemaNodeType(event.node_type),
        node_name=event.node_name,
        parent_node_id=event.parent_node_id,
        path=path_elements,
        sequence=event.sequence,
        event_timestamp=event.event_timestamp,
        status=SchemaNodeStatus(event.status),
        error_message=event.error_message,
        metadata=metadata,
        created_at=event.created_at.isoformat() if event.created_at else "",
    )


def _build_display_node(
    node_data: dict[str, Any],
    children: list[SchemaDisplayNode],
) -> SchemaDisplayNode:
    """Build a DisplayNode from node data."""
    metadata = None
    if node_data.get("metadata"):
        metadata = SchemaNodeMetadata(**node_data["metadata"])

    duration_ms = node_data.get("duration_ms")
    return SchemaDisplayNode(
        id=node_data["id"],
        node_type=SchemaNodeType(node_data["node_type"]),
        name=node_data["name"],
        timestamp=node_data.get("timestamp") or 0.0,
        end_timestamp=node_data.get("end_timestamp"),
        duration=(duration_ms / 1000 if duration_ms is not None else None),
        status=SchemaNodeStatus(node_data["status"]),
        metadata=metadata or SchemaNodeMetadata(),
        error=node_data.get("error"),
        children=children,
        is_expanded=True,
        level=0,
    )


class ExecutionTreeService:
    """Service for execution tree event operations."""

    def __init__(
        self,
        tree_repo: ExecutionTreeEventRepository,
        action_repo: ActionExecutionRepository,
    ) -> None:
        """Initialize with repositories."""
        self.tree_repo = tree_repo
        self.action_repo = action_repo

    async def list_tree_events(
        self,
        db: AsyncSession,
        run_id: UUID,
        event_type: str | None = None,
        node_type: str | None = None,
        offset: int = 0,
        limit: int = 500,
    ) -> TreeEventListResponse:
        """
        List tree events for a run.

        Args:
            db: Database session
            run_id: ID of the execution run
            event_type: Optional filter by event type
            node_type: Optional filter by node type
            offset: Pagination offset
            limit: Pagination limit

        Returns:
            TreeEventListResponse with events
        """
        events, total = await self.tree_repo.list_for_run(
            db,
            run_id,
            event_type=event_type,
            node_type=node_type,
            offset=offset,
            limit=limit,
        )

        return TreeEventListResponse(
            events=[_model_to_tree_event_response(e) for e in events],
            total=total,
            limit=limit,
            offset=offset,
            has_more=offset + limit < total,
        )

    async def get_execution_tree(
        self,
        db: AsyncSession,
        run_id: UUID,
        run: ExecutionRun,
    ) -> ExecutionTreeResponse:
        """
        Get the reconstructed execution tree for a run.

        Args:
            db: Database session
            run_id: ID of the execution run
            run: ExecutionRun model instance

        Returns:
            ExecutionTreeResponse with tree structure
        """
        logger.debug(
            "get_execution_tree_start",
            run_id=str(run_id),
        )

        # Get all tree events for this run
        events = await self.tree_repo.get_all_for_run(db, run_id)

        # If no tree events, fall back to building tree from action_executions
        if not events:
            logger.info("no_tree_events_falling_back_to_actions", run_id=str(run_id))
            return await self._build_tree_from_actions(db, run_id, run)

        # Build node map from events
        nodes: dict[str, dict[str, Any]] = {}
        for event in events:
            node_id = event.node_id
            if node_id not in nodes:
                nodes[node_id] = {
                    "id": node_id,
                    "node_type": event.node_type,
                    "name": event.node_name,
                    "parent_id": event.parent_node_id,
                    "status": event.status,
                    "error": event.error_message,
                    "timestamp": event.node_start_timestamp,
                    "end_timestamp": event.node_end_timestamp,
                    "duration_ms": event.duration_ms,
                    "metadata": event.node_metadata,
                    "children_ids": [],
                }
            else:
                # Update with latest event data (e.g., completed status)
                node = nodes[node_id]
                node["status"] = event.status
                if event.error_message:
                    node["error"] = event.error_message
                if event.node_end_timestamp:
                    node["end_timestamp"] = event.node_end_timestamp
                if event.duration_ms:
                    node["duration_ms"] = event.duration_ms

        # Build parent-child relationships
        for node_id, node in nodes.items():
            parent_id = node.get("parent_id")
            if parent_id and parent_id in nodes:
                nodes[parent_id]["children_ids"].append(node_id)

        # Recursive function to build DisplayNode tree
        def build_tree(node_id: str) -> SchemaDisplayNode:
            node_data = nodes[node_id]
            children = [build_tree(child_id) for child_id in node_data["children_ids"]]
            return _build_display_node(node_data, children)

        # Build root nodes
        root_node_ids = [
            node_id
            for node_id, node in nodes.items()
            if not node.get("parent_id") or node.get("parent_id") not in nodes
        ]
        root_nodes = [build_tree(node_id) for node_id in root_node_ids]

        # Calculate overall status
        all_statuses = [n["status"] for n in nodes.values()]
        if "failed" in all_statuses:
            overall_status = SchemaNodeStatus.FAILED
        elif all(s == "success" for s in all_statuses):
            overall_status = SchemaNodeStatus.SUCCESS
        elif "running" in all_statuses:
            overall_status = SchemaNodeStatus.RUNNING
        else:
            overall_status = SchemaNodeStatus.PENDING

        # Calculate total duration
        start_times = [n["timestamp"] for n in nodes.values() if n.get("timestamp")]
        end_times = [
            n["end_timestamp"] for n in nodes.values() if n.get("end_timestamp")
        ]
        duration_ms = None
        if start_times and end_times:
            duration_ms = (max(end_times) - min(start_times)) * 1000

        # Extract initial states and state name map from workflow metadata
        initial_state_ids: list[str] = []
        state_name_map: dict[str, str] = {}
        if run.workflow_metadata:
            initial_state_ids = run.workflow_metadata.get("initial_state_ids", [])
            state_name_map = run.workflow_metadata.get("state_name_map", {})

        # If we have no root_nodes but we have actions, fall back
        if not root_nodes and len(events) == 0:
            logger.info(
                "No tree events resulted in empty root_nodes, falling back to actions",
                run_id=str(run_id),
            )
            return await self._build_tree_from_actions(db, run_id, run)

        return ExecutionTreeResponse(
            run_id=run_id,
            root_nodes=root_nodes,
            total_events=len(events),
            workflow_name=run.run_name,
            status=overall_status,
            duration_ms=duration_ms,
            initial_state_ids=initial_state_ids,
            state_name_map=state_name_map,
        )

    async def _build_tree_from_actions(
        self,
        db: AsyncSession,
        run_id: UUID,
        run: ExecutionRun,
    ) -> ExecutionTreeResponse:
        """
        Build an execution tree from action_executions when no tree_events exist.

        Provides backward compatibility with runners that report actions
        but not tree events.

        Args:
            db: Database session
            run_id: ID of the execution run
            run: ExecutionRun model instance

        Returns:
            ExecutionTreeResponse built from actions
        """
        # Get all actions for this run
        actions, _ = await self.action_repo.list_for_run(
            db, run_id, offset=0, limit=1000
        )

        logger.info(
            "building_tree_from_actions",
            run_id=str(run_id),
            action_count=len(actions),
        )

        # Build flat list of display nodes from actions
        root_nodes = self._convert_actions_to_nodes(actions)

        # Calculate overall status
        if not root_nodes:
            overall_status = SchemaNodeStatus.PENDING
        elif any(n.status == SchemaNodeStatus.FAILED for n in root_nodes):
            overall_status = SchemaNodeStatus.FAILED
        elif all(n.status == SchemaNodeStatus.SUCCESS for n in root_nodes):
            overall_status = SchemaNodeStatus.SUCCESS
        else:
            overall_status = SchemaNodeStatus.PENDING

        # Calculate total duration from run data or from actions
        duration_ms = None
        if run.duration_seconds:
            duration_ms = run.duration_seconds * 1000
        elif root_nodes:
            total_ms = sum(
                (n.duration or 0) * 1000 for n in root_nodes if n.duration is not None
            )
            if total_ms > 0:
                duration_ms = int(total_ms)

        # Extract initial states and state name map from workflow metadata
        initial_state_ids: list[str] = []
        state_name_map: dict[str, str] = {}
        if run.workflow_metadata:
            initial_state_ids = run.workflow_metadata.get("initial_state_ids", [])
            state_name_map = run.workflow_metadata.get("state_name_map", {})

        return ExecutionTreeResponse(
            run_id=run_id,
            root_nodes=root_nodes,
            total_events=len(root_nodes),
            workflow_name=run.run_name,
            status=overall_status,
            duration_ms=duration_ms,
            initial_state_ids=initial_state_ids,
            state_name_map=state_name_map,
        )

    @staticmethod
    def _convert_actions_to_nodes(
        actions: list[ActionExecution],
    ) -> list[SchemaDisplayNode]:
        """Convert action executions to display nodes."""
        root_nodes: list[SchemaDisplayNode] = []

        for action in actions:
            # Convert action to display node
            node_type = SchemaNodeType.ACTION
            action_type_str = (
                action.action_type.value
                if hasattr(action.action_type, "value")
                else str(action.action_type)
            )
            if "transition" in action_type_str.lower():
                node_type = SchemaNodeType.TRANSITION

            # Map action status to node status
            status_str = (
                action.status.value
                if hasattr(action.status, "value")
                else str(action.status)
            )
            if status_str == "success":
                node_status = SchemaNodeStatus.SUCCESS
            elif status_str in ("failed", "error", "timeout"):
                node_status = SchemaNodeStatus.FAILED
            elif status_str == "skipped":
                node_status = SchemaNodeStatus.PENDING
            else:
                node_status = SchemaNodeStatus.PENDING

            # Build metadata
            metadata = SchemaNodeMetadata(
                config={"action_type": action_type_str},
                state_context=StateContext(
                    active_before=[action.from_state] if action.from_state else [],
                    active_after=[action.to_state] if action.to_state else [],
                ),
            )

            # Calculate timestamps
            start_ts = action.started_at.timestamp() if action.started_at else 0
            end_ts = action.completed_at.timestamp() if action.completed_at else None
            duration_sec = (action.duration_ms / 1000) if action.duration_ms else None

            node = SchemaDisplayNode(
                id=str(action.id),
                node_type=node_type,
                name=action.action_name or f"Action {action.sequence_number}",
                timestamp=start_ts,
                end_timestamp=end_ts,
                duration=duration_sec,
                status=node_status,
                metadata=metadata,
                error=action.error_message,
                children=[],
                is_expanded=True,
                level=0,
            )
            root_nodes.append(node)

        return root_nodes
