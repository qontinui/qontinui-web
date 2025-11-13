"""
Transition discovery service for automated transition identification

This service handles:
- Detecting state changes from frame timeline
- Correlating interactions with state changes
- Generating workflows for transitions
- Detecting multi-state scenarios (modals, overlays)
"""

from typing import List, Dict, Any, Optional, Tuple
import uuid
import structlog
from datetime import datetime, timedelta

logger = structlog.get_logger(__name__)


class TransitionDiscoveryService:
    """Service for discovering transitions between states"""

    def discover_transitions(
        self,
        states: List[Dict[str, Any]],
        frames: List[Dict[str, Any]],
        interactions: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Discover transitions between states

        Args:
            states: List of discovered states
            frames: List of frame data with state assignments
            interactions: List of interaction events

        Returns:
            List of discovered transitions
        """
        # Build state timeline
        state_timeline = self._build_state_timeline(frames, states)

        # Detect state changes
        state_changes = self._detect_state_changes(state_timeline)

        # Correlate with interactions
        transitions = []

        for change in state_changes:
            try:
                # Find trigger interaction
                trigger = self._find_trigger_interaction(change, interactions)

                # Collect interaction sequence
                interaction_sequence = self._get_interaction_sequence(
                    change["from_state"],
                    change["to_state"],
                    trigger,
                    interactions,
                    state_timeline
                )

                # Generate workflow
                workflow = self._generate_workflow(
                    interaction_sequence,
                    change["from_state"],
                    change["to_state"],
                    change["latency_ms"]
                )

                # Detect multi-state scenario
                multi_state_info = self._detect_multi_state_scenario(
                    change["from_state"],
                    change["to_state"],
                    states
                )

                # Calculate confidence
                confidence_scores = self._calculate_transition_confidence(
                    change,
                    trigger,
                    interaction_sequence,
                    workflow
                )

                # Create transition object
                transition = {
                    "id": str(uuid.uuid4()),
                    "from_state_id": change["from_state"]["id"],
                    "to_state_id": change["to_state"]["id"] if not multi_state_info["is_multi_state"] else None,
                    "activate_state_ids": multi_state_info["activate_states"],
                    "deactivate_state_ids": multi_state_info["deactivate_states"],
                    "stays_visible": multi_state_info["stays_visible"],
                    "trigger_interaction_id": trigger["id"] if trigger else None,
                    "trigger_type": trigger["interaction_type"] if trigger else "auto",
                    "trigger_description": self._describe_trigger(trigger),
                    "latency_ms": change["latency_ms"],
                    "recommended_timeout_ms": int(change["latency_ms"] * 1.5 + 1000),  # 1.5x + 1s buffer
                    "recommended_retry_count": 3,
                    "workflow": workflow,
                    "workflow_name": f"{change['from_state']['name']}_to_{change['to_state']['name']}",
                    "confidence": confidence_scores["overall"],
                    "clarity_score": confidence_scores["clarity"],
                    "consistency_score": confidence_scores["consistency"],
                    "completeness_score": confidence_scores["completeness"],
                }

                transitions.append(transition)

            except Exception as e:
                logger.error("Failed to create transition", error=str(e), exc_info=True)
                continue

        return transitions

    def _build_state_timeline(
        self,
        frames: List[Dict[str, Any]],
        states: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Build timeline mapping frames to states

        Args:
            frames: List of frames
            states: List of states with frame_ids

        Returns:
            List of timeline entries {frame_number, timestamp, state, relative_time_ms}
        """
        # Create frame_id to state mapping
        frame_to_state = {}
        for state in states:
            for frame_id in state.get("frame_ids", []):
                frame_to_state[frame_id] = state

        # Build timeline
        timeline = []
        for frame in sorted(frames, key=lambda f: f.get("frame_number", 0)):
            frame_id = frame.get("id")
            state = frame_to_state.get(frame_id)

            if state:
                timeline.append({
                    "frame_number": frame["frame_number"],
                    "timestamp": frame["timestamp"],
                    "relative_time_ms": frame["relative_time_ms"],
                    "state": state,
                    "state_id": state["id"],
                })

        return timeline

    def _detect_state_changes(
        self,
        timeline: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Detect points where state changes

        Args:
            timeline: State timeline

        Returns:
            List of state change events
        """
        changes = []

        for i in range(len(timeline) - 1):
            current = timeline[i]
            next_entry = timeline[i + 1]

            if current["state_id"] != next_entry["state_id"]:
                # State change detected
                latency_ms = next_entry["relative_time_ms"] - current["relative_time_ms"]

                changes.append({
                    "from_state": current["state"],
                    "to_state": next_entry["state"],
                    "change_time_ms": next_entry["relative_time_ms"],
                    "change_timestamp": next_entry["timestamp"],
                    "latency_ms": latency_ms,
                    "from_frame": current["frame_number"],
                    "to_frame": next_entry["frame_number"],
                })

        return changes

    def _find_trigger_interaction(
        self,
        change: Dict[str, Any],
        interactions: List[Dict[str, Any]],
        lookback_ms: int = 2000
    ) -> Optional[Dict[str, Any]]:
        """
        Find interaction that likely triggered the state change

        Args:
            change: State change event
            interactions: List of all interactions
            lookback_ms: How far back to look for trigger (default 2 seconds)

        Returns:
            Trigger interaction or None
        """
        change_time = change["change_time_ms"]
        window_start = change_time - lookback_ms

        # Find interactions in time window before state change
        candidates = [
            interaction for interaction in interactions
            if window_start <= interaction["relative_time_ms"] < change_time
        ]

        if not candidates:
            return None

        # Priority: click > key > other
        priority = {
            "click": 3,
            "key": 2,
            "drag": 1,
            "scroll": 0,
            "hover": 0,
        }

        # Sort by priority, then by time (closest to change)
        candidates.sort(
            key=lambda i: (
                priority.get(i["interaction_type"], 0),
                -abs(change_time - i["relative_time_ms"])
            ),
            reverse=True
        )

        return candidates[0] if candidates else None

    def _get_interaction_sequence(
        self,
        from_state: Dict[str, Any],
        to_state: Dict[str, Any],
        trigger: Optional[Dict[str, Any]],
        all_interactions: List[Dict[str, Any]],
        timeline: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Get sequence of interactions between two states

        Args:
            from_state: Source state
            to_state: Target state
            trigger: Trigger interaction
            all_interactions: All interactions
            timeline: State timeline

        Returns:
            List of interactions in sequence
        """
        if not trigger:
            return []

        # Find time range: from start of from_state to trigger
        from_state_frames = [
            entry for entry in timeline
            if entry["state_id"] == from_state["id"]
        ]

        if not from_state_frames:
            return [trigger]

        start_time = from_state_frames[0]["relative_time_ms"]
        end_time = trigger["relative_time_ms"]

        # Get interactions in range
        sequence = [
            interaction for interaction in all_interactions
            if start_time <= interaction["relative_time_ms"] <= end_time
        ]

        # Sort by time
        sequence.sort(key=lambda i: i["relative_time_ms"])

        return sequence

    def _generate_workflow(
        self,
        interactions: List[Dict[str, Any]],
        from_state: Dict[str, Any],
        to_state: Dict[str, Any],
        latency_ms: int
    ) -> Dict[str, Any]:
        """
        Generate workflow from interaction sequence

        Args:
            interactions: Sequence of interactions
            from_state: Source state
            to_state: Target state
            latency_ms: Expected latency

        Returns:
            Workflow dict with actions and connections
        """
        actions = []
        connections = {}

        # Convert interactions to actions
        for i, interaction in enumerate(interactions):
            action_id = f"action_{i}"

            action = self._interaction_to_action(interaction, action_id)
            actions.append(action)

            # Connect to next action
            if i > 0:
                prev_action_id = f"action_{i - 1}"
                if prev_action_id not in connections:
                    connections[prev_action_id] = []
                connections[prev_action_id].append(action_id)

        # Add WAIT_FOR_STATE action at end
        wait_action_id = f"action_{len(actions)}"
        wait_action = {
            "id": wait_action_id,
            "type": "WAIT_FOR_STATE",
            "targetState": to_state["id"],
            "targetStateName": to_state["name"],
            "timeout": int(latency_ms * 1.5 + 1000),
        }
        actions.append(wait_action)

        # Connect last interaction to wait action
        if actions and len(actions) > 1:
            last_action_id = f"action_{len(actions) - 2}"
            if last_action_id not in connections:
                connections[last_action_id] = []
            connections[last_action_id].append(wait_action_id)

        workflow = {
            "id": str(uuid.uuid4()),
            "name": f"{from_state['name']}_to_{to_state['name']}",
            "version": "1.0",
            "format": "graph",
            "actions": actions,
            "connections": connections,
            "initialStateIds": [from_state["id"]],
        }

        return workflow

    def _interaction_to_action(
        self,
        interaction: Dict[str, Any],
        action_id: str
    ) -> Dict[str, Any]:
        """Convert interaction to workflow action"""
        interaction_type = interaction["interaction_type"]

        if interaction_type == "click":
            return {
                "id": action_id,
                "type": "CLICK",
                "x": interaction["x"],
                "y": interaction["y"],
                "button": interaction.get("button", "left"),
                "clickCount": interaction.get("click_count", 1),
            }

        elif interaction_type == "key":
            if interaction.get("action") == "type" and interaction.get("text"):
                return {
                    "id": action_id,
                    "type": "FILL_TEXT",
                    "value": interaction["text"],
                    "targetElement": interaction.get("target_element"),
                }
            else:
                return {
                    "id": action_id,
                    "type": "KEY_PRESS",
                    "key": interaction.get("key", ""),
                    "modifiers": interaction.get("modifiers", []),
                }

        elif interaction_type == "drag":
            return {
                "id": action_id,
                "type": "DRAG",
                "startX": interaction["start_x"],
                "startY": interaction["start_y"],
                "endX": interaction["end_x"],
                "endY": interaction["end_y"],
            }

        elif interaction_type == "scroll":
            return {
                "id": action_id,
                "type": "SCROLL",
                "deltaX": interaction.get("scroll_delta_x", 0),
                "deltaY": interaction.get("scroll_delta_y", 0),
                "direction": interaction.get("scroll_direction"),
            }

        else:
            return {
                "id": action_id,
                "type": "UNKNOWN",
                "interactionType": interaction_type,
            }

    def _detect_multi_state_scenario(
        self,
        from_state: Dict[str, Any],
        to_state: Dict[str, Any],
        all_states: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Detect if this is a multi-state scenario (modal/overlay)

        Args:
            from_state: Source state
            to_state: Target state
            all_states: All states

        Returns:
            Dict with multi-state info
        """
        from_images = set(img["name"] for img in from_state.get("state_images", []))
        to_images = set(img["name"] for img in to_state.get("state_images", []))

        # Check if to_state contains all from_state images + new ones
        if from_images and to_images and from_images.issubset(to_images):
            # Overlay scenario: from_state stays visible, to_state activates
            new_images = to_images - from_images

            if len(new_images) > 0:
                return {
                    "is_multi_state": True,
                    "activate_states": [to_state["id"]],
                    "deactivate_states": [],
                    "stays_visible": True,
                    "scenario": "overlay"
                }

        # Check if to_state is subset of from_state (partial close)
        if from_images and to_images and to_images.issubset(from_images):
            removed_images = from_images - to_images

            if len(removed_images) > 0:
                return {
                    "is_multi_state": True,
                    "activate_states": [],
                    "deactivate_states": [],  # Would need to identify which state to deactivate
                    "stays_visible": False,
                    "scenario": "partial_close"
                }

        # Normal transition
        return {
            "is_multi_state": False,
            "activate_states": [],
            "deactivate_states": [],
            "stays_visible": False,
            "scenario": "full_transition"
        }

    def _describe_trigger(self, trigger: Optional[Dict[str, Any]]) -> str:
        """Generate human-readable description of trigger"""
        if not trigger:
            return "Auto transition (no user interaction)"

        interaction_type = trigger["interaction_type"]

        if interaction_type == "click":
            target = trigger.get("target_element", {})
            text = target.get("text", "")
            role = target.get("role", "")

            if text:
                return f"Click on '{text}' {role}".strip()
            else:
                return f"Click at ({trigger['x']}, {trigger['y']})"

        elif interaction_type == "key":
            key = trigger.get("key", "")
            modifiers = trigger.get("modifiers", [])

            if modifiers:
                return f"Keyboard shortcut: {'+'.join(modifiers + [key])}"
            else:
                return f"Press {key} key"

        elif interaction_type == "drag":
            return f"Drag from ({trigger['start_x']}, {trigger['start_y']}) to ({trigger['end_x']}, {trigger['end_y']})"

        else:
            return f"{interaction_type} interaction"

    def _calculate_transition_confidence(
        self,
        change: Dict[str, Any],
        trigger: Optional[Dict[str, Any]],
        interactions: List[Dict[str, Any]],
        workflow: Dict[str, Any]
    ) -> Dict[str, float]:
        """
        Calculate confidence scores for transition

        Returns:
            Dict with clarity, consistency, completeness, and overall scores
        """
        # Clarity: how clear is the visual change?
        # Based on whether states are distinct
        from_state = change["from_state"]
        to_state = change["to_state"]

        from_images = set(img["name"] for img in from_state.get("state_images", []))
        to_images = set(img["name"] for img in to_state.get("state_images", []))

        if from_images and to_images:
            overlap = len(from_images & to_images)
            total = len(from_images | to_images)
            clarity = 1.0 - (overlap / total if total > 0 else 0.0)
        else:
            clarity = 0.5

        # Consistency: would need multiple recordings
        # For now, assume good consistency
        consistency = 0.85

        # Completeness: do we have trigger and target?
        completeness = 1.0 if trigger and workflow.get("actions") else 0.5

        # Overall
        overall = (clarity * 0.4 + consistency * 0.3 + completeness * 0.3)

        return {
            "clarity": float(clarity),
            "consistency": float(consistency),
            "completeness": float(completeness),
            "overall": float(overall)
        }

    def deduplicate_transitions(
        self,
        transitions: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Remove duplicate transitions (same from/to states)

        Args:
            transitions: List of transitions

        Returns:
            Deduplicated list
        """
        seen = set()
        deduplicated = []

        for transition in transitions:
            key = (transition["from_state_id"], transition.get("to_state_id"))

            if key not in seen:
                seen.add(key)
                deduplicated.append(transition)
            else:
                # Merge with existing (take higher confidence)
                existing = next(
                    t for t in deduplicated
                    if (t["from_state_id"], t.get("to_state_id")) == key
                )

                if transition["confidence"] > existing["confidence"]:
                    deduplicated.remove(existing)
                    deduplicated.append(transition)

        return deduplicated
