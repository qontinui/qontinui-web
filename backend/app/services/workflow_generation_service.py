"""
Workflow generation service for capture sessions.

Analyzes completed capture sessions to automatically generate workflow structures
from the sequence of states, actions, and detected elements.
"""

from datetime import UTC, datetime
from typing import cast
from uuid import UUID

import structlog
from app.models.capture import CaptureScreenshot, CaptureSession, LearnedWorkflow
from fastapi import HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = structlog.get_logger(__name__)


class WorkflowGenerationService:
    """Service for generating workflows from capture sessions."""

    @staticmethod
    async def generate_workflow_from_session(
        db: AsyncSession,
        session_id: UUID,
        user_id: UUID,
        name: str | None = None,
        description: str | None = None,
    ) -> LearnedWorkflow:
        """
        Generate a workflow from a capture session.

        Analyzes the sequence of screenshots, state matches, and actions to
        automatically create a workflow structure.

        Args:
            db: Database session
            session_id: ID of the capture session
            user_id: ID of the user (for authorization)
            name: Optional name for the learned workflow (defaults to session name)
            description: Optional description (defaults to session description)

        Returns:
            Created LearnedWorkflow record

        Raises:
            HTTPException: If session not found or generation fails
        """
        # Get the capture session with all related data
        result = await db.execute(
            select(CaptureSession)
            .options(
                selectinload(CaptureSession.screenshots).selectinload(
                    CaptureScreenshot.state_matches
                ),
                selectinload(CaptureSession.screenshots).selectinload(
                    CaptureScreenshot.actions
                ),
                selectinload(CaptureSession.screenshots).selectinload(
                    CaptureScreenshot.detected_elements
                ),
            )
            .filter(
                CaptureSession.id == session_id,
                CaptureSession.user_id == user_id,
            )
        )
        session = result.scalar_one_or_none()

        if not session:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="Capture session not found or access denied",
            )

        # Verify session has screenshots
        if not session.screenshots:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Cannot generate workflow from empty session",
            )

        # Sort screenshots by sequence number
        screenshots = sorted(session.screenshots, key=lambda s: s.sequence_number)

        # Analyze the session to generate workflow structure
        workflow_structure = await WorkflowGenerationService._analyze_session(
            screenshots
        )

        # Calculate overall confidence
        confidence = workflow_structure["metadata"]["confidence"]

        # Create learned workflow record
        learned_workflow = LearnedWorkflow(
            session_id=session_id,
            project_id=session.project_id,
            name=name or f"Learned: {session.name}",
            description=description or session.description,
            workflow_json=workflow_structure,
            confidence=confidence,
            status="draft",
            warnings=workflow_structure["metadata"].get("warnings"),
        )

        db.add(learned_workflow)
        await db.commit()
        await db.refresh(learned_workflow)

        logger.info(
            "workflow_generated",
            session_id=str(session_id),
            workflow_id=str(learned_workflow.id),
            confidence=confidence,
            state_count=len(workflow_structure["states"]),
            transition_count=len(workflow_structure["transitions"]),
        )

        return learned_workflow

    @staticmethod
    async def _analyze_session(screenshots: list[CaptureScreenshot]) -> dict:
        """
        Analyze screenshots to extract workflow structure.

        Args:
            screenshots: List of screenshots in sequence order

        Returns:
            Workflow structure dictionary
        """
        states = []
        transitions = []
        warnings = []
        confidence_scores = []

        # Build state sequence from screenshot state matches
        state_sequence = []
        for screenshot in screenshots:
            # Get the highest confidence state match for this screenshot
            if screenshot.state_matches:
                best_match = max(screenshot.state_matches, key=lambda m: m.confidence)
                state_sequence.append(
                    {
                        "screenshot_id": str(screenshot.id),
                        "sequence_number": screenshot.sequence_number,
                        "state_identifier": best_match.state_identifier,
                        "confidence": best_match.confidence,
                        "state_metadata": best_match.state_metadata,
                        "actions": [
                            {
                                "action_type": action.action_type,
                                "x": action.x,
                                "y": action.y,
                                "text": action.text,
                                "key": action.key,
                                "button": action.button,
                                "timestamp": action.timestamp.isoformat(),
                            }
                            for action in sorted(
                                screenshot.actions, key=lambda a: a.sequence_number
                            )
                        ],
                    }
                )
                confidence_scores.append(best_match.confidence)
            else:
                # No state match found
                state_sequence.append(
                    {
                        "screenshot_id": str(screenshot.id),
                        "sequence_number": screenshot.sequence_number,
                        "state_identifier": f"unknown_state_{screenshot.sequence_number}",
                        "confidence": 0.0,
                        "state_metadata": None,
                        "actions": [
                            {
                                "action_type": action.action_type,
                                "x": action.x,
                                "y": action.y,
                                "text": action.text,
                                "key": action.key,
                                "button": action.button,
                                "timestamp": action.timestamp.isoformat(),
                            }
                            for action in sorted(
                                screenshot.actions, key=lambda a: a.sequence_number
                            )
                        ],
                    }
                )
                warnings.append(
                    f"Screenshot {screenshot.sequence_number} has no state match"
                )

        # Extract unique states
        unique_state_identifiers = set()
        for item in state_sequence:
            unique_state_identifiers.add(item["state_identifier"])

        # Create state definitions
        for state_id in unique_state_identifiers:
            # Find all screenshots with this state
            matching_screenshots = [
                item for item in state_sequence if item["state_identifier"] == state_id
            ]

            # Calculate average confidence
            avg_confidence = (
                sum(cast(float, s["confidence"]) for s in matching_screenshots)
                / len(matching_screenshots)
                if matching_screenshots
                else 0.0
            )

            # Get state metadata from first match
            state_metadata = (
                matching_screenshots[0]["state_metadata"]
                if matching_screenshots
                else None
            )

            states.append(
                {
                    "state_id": state_id,
                    "name": state_id,
                    "confidence": avg_confidence,
                    "occurrence_count": len(matching_screenshots),
                    "metadata": state_metadata,
                }
            )

        # Generate transitions from state sequence
        for i in range(len(state_sequence) - 1):
            current = state_sequence[i]
            next_item = state_sequence[i + 1]

            # Get actions that triggered the transition
            trigger_actions = current["actions"]

            # Calculate transition confidence (average of source and target confidences)
            transition_confidence = (
                cast(float, current["confidence"])
                + cast(float, next_item["confidence"])
            ) / 2

            if transition_confidence < 0.5:
                warnings.append(
                    f"Low confidence transition from {current['state_identifier']} to {next_item['state_identifier']} ({transition_confidence:.2f})"
                )

            transitions.append(
                {
                    "from_state": current["state_identifier"],
                    "to_state": next_item["state_identifier"],
                    "trigger_actions": trigger_actions,
                    "confidence": transition_confidence,
                    "screenshot_sequence": [
                        current["sequence_number"],
                        next_item["sequence_number"],
                    ],
                }
            )

        # Calculate overall confidence
        overall_confidence = (
            sum(confidence_scores) / len(confidence_scores)
            if confidence_scores
            else 0.0
        )

        # Determine start state (first screenshot's state)
        start_state_id = (
            state_sequence[0]["state_identifier"] if state_sequence else None
        )

        return {
            "states": states,
            "transitions": transitions,
            "start_state_id": start_state_id,
            "metadata": {
                "confidence": overall_confidence,
                "warnings": warnings,
                "generation_method": "sequential_analysis",
                "screenshot_count": len(screenshots),
                "unique_state_count": len(states),
                "transition_count": len(transitions),
                "generated_at": datetime.now(UTC).isoformat(),
            },
        }

    @staticmethod
    async def get_learned_workflows(
        db: AsyncSession,
        session_id: UUID,
        user_id: UUID,
    ) -> list[LearnedWorkflow]:
        """
        Get all learned workflows for a capture session.

        Args:
            db: Database session
            session_id: ID of the capture session
            user_id: ID of the user (for authorization)

        Returns:
            List of LearnedWorkflow records
        """
        # Verify session access
        from app.services.session_repository import SessionRepository

        await SessionRepository.get_by_id(db, session_id, user_id)

        # Get workflows
        result = await db.execute(
            select(LearnedWorkflow)
            .filter(LearnedWorkflow.session_id == session_id)
            .order_by(LearnedWorkflow.created_at.desc())
        )

        return list(result.scalars().all())

    @staticmethod
    async def update_workflow_status(
        db: AsyncSession,
        workflow_id: UUID,
        user_id: UUID,
        status: str,
        review_notes: str | None = None,
    ) -> LearnedWorkflow:
        """
        Update the status of a learned workflow.

        Args:
            db: Database session
            workflow_id: ID of the learned workflow
            user_id: ID of the user (for authorization)
            status: New status ('draft', 'reviewing', 'approved', 'rejected', 'published')
            review_notes: Optional notes from reviewer

        Returns:
            Updated LearnedWorkflow

        Raises:
            HTTPException: If workflow not found
        """
        # Get workflow with session for authorization
        result = await db.execute(
            select(LearnedWorkflow)
            .options(selectinload(LearnedWorkflow.session))
            .filter(LearnedWorkflow.id == workflow_id)
        )
        workflow = result.scalar_one_or_none()

        if not workflow:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="Learned workflow not found",
            )

        # Verify user owns the session
        if workflow.session.user_id != user_id:
            raise HTTPException(
                status_code=http_status.HTTP_403_FORBIDDEN,
                detail="Access denied",
            )

        # Update workflow
        workflow.status = status
        if status in ["approved", "rejected"]:
            workflow.reviewed_at = datetime.now(UTC)
            workflow.reviewer_id = user_id

        await db.commit()
        await db.refresh(workflow)

        logger.info(
            "workflow_status_updated",
            workflow_id=str(workflow_id),
            new_status=status,
            user_id=str(user_id),
        )

        return workflow
