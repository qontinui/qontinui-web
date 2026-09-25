"""``EmailTransportService`` must not block the event loop, and must be bounded.

``_send_via_ses_api`` is an ``async def``, but ``self.ses_client.send_email``
is synchronous boto3 — a real HTTPS round-trip to AWS. Awaiting an ``async
def`` that performs a blocking call does not make the call non-blocking: the
coroutine runs on the event loop thread until it yields, so the blocking send
stalls EVERY request the uvicorn worker is serving, not just its own.

Two properties close that, and neither is sufficient alone:

1. **The call runs off the loop** (``asyncio.to_thread``), so the blocking is
   confined to one worker thread.
2. **The client is bounded** (``botocore.config.Config`` with connect/read
   timeouts and a retry cap), so that thread's wait cannot be open-ended.
   botocore's defaults are 60s connect, 60s read and up to 5 attempts.

A timeout wrapper around the call is NOT an alternative to (1): a blocked
event loop cannot fire its own timer, so ``asyncio.wait_for`` around a
loop-blocking call never fires.

This matters more here than for a typical sender because the member-added
notice reports the send's outcome in the HTTP response, so the send cannot be
deferred to a background task — it is awaited inside the request, and
bounding it is the only thing that keeps the worst case finite.
"""

import asyncio
import time
from unittest.mock import MagicMock, patch

import pytest

from app.services.email.email_transport_service import (
    SMTP_TIMEOUT,
    EmailTransportService,
    _ses_client_config,
)


class TestTheSesClientIsBounded:
    def test_the_config_caps_connect_read_and_retries(self):
        config = _ses_client_config()
        assert config.connect_timeout == 5
        assert config.read_timeout == 10
        # botocore's default is 5 total attempts; an unbounded retry budget
        # multiplies every timeout above by the attempt count.
        assert config.retries["max_attempts"] == 2

    def test_the_effective_attempt_cap_is_three(self):
        """Units, pinned. botocore's ``max_attempts`` counts RETRIES, so the
        worst case is 1 initial + 2 retries. Anyone reasoning about the
        latency bound from the config alone would otherwise be out by one
        whole connect+read cycle."""
        import boto3

        config = _ses_client_config()
        boto3.client(
            "ses",
            region_name="us-east-1",
            aws_access_key_id="x",
            aws_secret_access_key="y",
            config=config,
        )
        assert config.retries["total_max_attempts"] == 3

    def test_each_client_gets_its_own_config_object(self):
        """Client construction MUTATES the config it is given, so a shared
        module-level instance would have its contents change underneath
        whoever reads it next."""
        assert _ses_client_config() is not _ses_client_config()

    def test_the_client_is_built_with_a_bounded_config(self):
        with (
            patch(
                "app.services.email.email_transport_service.settings"
            ) as fake_settings,
            patch(
                "app.services.email.email_transport_service.boto3.client"
            ) as boto_client,
        ):
            fake_settings.USE_SES_API = True
            fake_settings.AWS_REGION = "us-east-1"
            EmailTransportService()

        boto_client.assert_called_once()
        config = boto_client.call_args.kwargs["config"]
        assert config.connect_timeout == 5
        assert config.read_timeout == 10
        assert config.retries["max_attempts"] == 2


class TestTheSmtpFallbackIsBoundedToo:
    """The fallback leg is not an alternative budget — it is an ADDITION.

    ``send_email`` tries SES first and falls through to SMTP when it raises,
    so on any deployment with ``SMTP_HOST`` set both legs run inside one
    request. ``aiosmtplib.send`` defaults to 60s and was called with no
    timeout at all, which put the combined worst case past the point where
    an upstream idle timeout shows a 504 for a grant that already committed.
    """

    @pytest.mark.asyncio
    async def test_send_is_called_with_an_explicit_timeout(self):
        service = EmailTransportService()

        with (
            patch(
                "app.services.email.email_transport_service.settings"
            ) as fake_settings,
            patch(
                "app.services.email.email_transport_service.aiosmtplib.send"
            ) as smtp_send,
        ):
            fake_settings.SMTP_HOST = "smtp.example.com"
            fake_settings.SMTP_PORT = 587
            fake_settings.SMTP_TLS = True
            fake_settings.SMTP_USER = ""
            fake_settings.SMTP_PASSWORD = ""
            fake_settings.SMTP_FROM_EMAIL = "no-reply@example.com"
            smtp_send.return_value = None
            sent = await service._send_via_smtp(
                "to@example.com", "Subject", "text", "<p>html</p>"
            )

        assert sent is True
        assert smtp_send.call_args.kwargs["timeout"] == SMTP_TIMEOUT

    def test_the_timeout_is_well_under_aiosmtplibs_default(self):
        # The default is 60s. Anything near it defeats the purpose, since
        # this leg lands on top of the ~45s SES budget.
        assert SMTP_TIMEOUT <= 30


class TestTheSendDoesNotBlockTheEventLoop:
    @pytest.mark.asyncio
    async def test_a_slow_ses_send_leaves_the_loop_responsive(self):
        """The regression test with teeth.

        The SES client is made to block for 300ms. While that is in flight a
        second coroutine ticks a counter every 10ms. If the send were called
        directly from the coroutine the loop would be stalled and the ticker
        could not run at all; off the loop, it keeps ticking.
        """
        service = EmailTransportService()
        service.ses_client = MagicMock()

        def _blocking_send(**_kwargs):
            time.sleep(0.3)  # synchronous, exactly like the real boto3 call
            return {"MessageId": "m-1"}

        service.ses_client.send_email.side_effect = _blocking_send

        ticks = 0

        async def _ticker():
            nonlocal ticks
            while True:
                await asyncio.sleep(0.01)
                ticks += 1

        ticker = asyncio.create_task(_ticker())
        with patch(
            "app.services.email.email_transport_service.settings"
        ) as fake_settings:
            fake_settings.SMTP_FROM_EMAIL = "no-reply@example.com"
            fake_settings.AWS_REGION = "us-east-1"
            sent = await service._send_via_ses_api(
                "to@example.com", "Subject", "text", "<p>html</p>"
            )
        ticker.cancel()

        assert sent is True
        # ~30 ticks are possible; anything above a handful proves the loop
        # kept running. Zero is the signature of the defect.
        assert ticks >= 5, f"event loop was blocked during the send (ticks={ticks})"

    @pytest.mark.asyncio
    async def test_it_calls_send_email_and_never_send_raw_email(self):
        """The web task role is granted ``ses:SendEmail`` only. A raw-MIME
        path would be refused at IAM, so this pins the API actually used."""
        service = EmailTransportService()
        service.ses_client = MagicMock()
        service.ses_client.send_email.return_value = {"MessageId": "m-2"}

        with patch(
            "app.services.email.email_transport_service.settings"
        ) as fake_settings:
            fake_settings.SMTP_FROM_EMAIL = "no-reply@example.com"
            fake_settings.AWS_REGION = "us-east-1"
            await service._send_via_ses_api(
                "to@example.com", "Subject", "text", "<p>html</p>"
            )

        service.ses_client.send_email.assert_called_once()
        service.ses_client.send_raw_email.assert_not_called()
        kwargs = service.ses_client.send_email.call_args.kwargs
        assert kwargs["Destination"] == {"ToAddresses": ["to@example.com"]}
        assert kwargs["Message"]["Body"]["Text"]["Data"] == "text"
        assert kwargs["Message"]["Body"]["Html"]["Data"] == "<p>html</p>"
