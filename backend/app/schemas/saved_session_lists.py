"""Request and response shapes for ``/api/v1/saved-session-lists``.

Plan ``2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days``,
Phase 2. The routes are in ``app/api/v1/endpoints/saved_session_lists.py``.

The envelope fields are snake_case, as everywhere in this API. ``layout`` is
the runner's own wire type, ``TerminalLayout`` from qontinui-schemas, so its
fields are the runner's camelCase. It is served through that generated model,
so it carries exactly the fields this backend's schemas version declares. A
field a newer runner added is kept in storage but not served until the
schemas version here declares it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from qontinui_schemas.generated import TerminalLayout

#: The longest title a caller may give a saved list.
SAVED_SESSION_LIST_TITLE_MAX_LENGTH = 200


class SavedSessionListCreate(BaseModel):
    """``POST /api/v1/saved-session-lists``: which runner to capture, and a title.

    There is no port or instance to choose: the capture reads the runner that
    owns the device's relay socket (the primary whenever it is connected),
    and records the instance, port and build that runner reports. Unknown
    fields are refused, so a client that sends ``runner_port`` learns it is
    not honoured instead of having it silently ignored.
    """

    model_config = ConfigDict(extra="forbid")

    device_id: UUID = Field(description="The device whose runner to capture.")
    title: str | None = Field(
        default=None,
        max_length=SAVED_SESSION_LIST_TITLE_MAX_LENGTH,
        description=(
            "Optional label for the saved list, trimmed before its length is "
            "checked. Blank is stored as null."
        ),
    )

    @field_validator("title", mode="before")
    @classmethod
    def _trim_title(cls, value: Any) -> Any:
        """Trim the title BEFORE the length check, so surrounding whitespace
        does not count against ``max_length``; blank becomes null. A
        non-string is left for the type check to refuse."""
        if isinstance(value, str):
            return value.strip() or None
        return value

    @field_validator("title")
    @classmethod
    def _title_is_one_line(cls, value: str | None) -> str | None:
        """Refuse control characters and unpaired surrogates.

        A title is one line of text. Refusing control characters here also
        keeps a NUL byte, and an unpaired UTF-16 surrogate (which a JSON body
        can carry as a lone ``\\ud800`` escape), from failing the insert as a
        500: Postgres ``text`` cannot store either.
        """
        if value is not None and any(
            ord(ch) < 0x20 or ord(ch) == 0x7F or 0xD800 <= ord(ch) <= 0xDFFF
            for ch in value
        ):
            raise ValueError(
                "title must be one line of text, without control characters "
                "or unpaired surrogates"
            )
        return value


class SavedSessionListCoordStatus(BaseModel):
    """coord's work-axis status for one session, read at capture time.

    ``read`` says what kind of answer ``value`` is:

    * ``ok``: coord answered for this session. ``value`` is its
      ``session_status`` (``finished``, another work-axis word, or ``null``
      when the session exists and its work axis is unset).
    * ``unknown``: coord answered, but not for this session. It has no such
      session in the caller's tenant, which is also how a session of another
      tenant on a shared device reads. ``value`` is ``null``.
    * ``failed``: coord could not be read. ``value`` is ``null``.

    ``unknown`` and ``failed`` never mean "not finished".
    """

    value: str | None
    read: Literal["ok", "unknown", "failed"]


class SavedSessionListSummary(BaseModel):
    """One saved list without its layout: the list route's row."""

    id: UUID
    device_id: UUID
    runner_instance: str | None = Field(
        description="The runner instance's name, as the runner reported it."
    )
    runner_port: int | None = Field(
        description="The runner instance's API port, as the runner reported it."
    )
    runner_build_id: str | None = Field(
        description="The runner build that answered, as the runner reported it."
    )
    title: str | None
    created_by_user_id: UUID
    created_by_name: str | None = Field(
        description="The creator's full name, else username; null when neither is set."
    )
    captured_at: datetime = Field(
        description="When this backend captured the list (its own clock)."
    )
    expires_at: datetime = Field(
        description="When the list is deleted: captured_at plus 14 days."
    )
    tab_count: int = Field(description="Terminal pages (tabs) in the layout.")
    session_count: int = Field(description="Terminals across all pages.")


class SavedSessionListDetail(SavedSessionListSummary):
    """One saved list with its layout: the capture's and the get route's body."""

    layout: TerminalLayout = Field(
        description=(
            "The runner's GET /terminal-layout body as captured: tabs in the "
            "runner's order, each with its terminals and their sessions."
        )
    )
    coord_status: dict[str, SavedSessionListCoordStatus] = Field(
        description=(
            "coord's work-axis status at capture time, keyed by a session's "
            "claudeSessionId. A terminal with no claudeSessionId has no entry."
        )
    )
