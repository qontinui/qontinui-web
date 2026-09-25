"""``MemberAddedNoticeComposer`` — the "you have been given access" email.

The composer that closes the ``added`` gap on
``POST /api/v1/operations/coord/tenant-members``: a colleague who ALREADY
holds a confirmed account was granted a role and told nothing at all.

Two properties are load-bearing here and are pinned rather than described:

1. **It needs no ``User`` row.** Every other composer in
   ``app.services.email.email_composers`` takes a
   :class:`~app.models.user.User`. The caller here has an email address and a
   coord operator id; there may be no ``users`` row for this person in this
   backend's database, and requiring one would make the notice unsendable in
   exactly the case it exists for.

2. **It carries no credential.** Not a temporary password, not a reset link,
   not a token. The recipient already has an account. An unsolicited email
   offering a credential is indistinguishable from a phishing attempt, and
   the templates are asserted against that vocabulary directly — a future
   edit that helpfully adds "here is a link to set your password" fails
   here.

The transport is stubbed throughout, and the composer goes through
``EmailTransportService.send_email`` like every other sender — deliberately.
The web task role's SES grant is ``ses:SendEmail`` only, which is the API
``_send_via_ses_api`` calls; ``ses:SendRawEmail`` is NOT granted, so a
hand-rolled raw-MIME path would be refused at IAM. That is a reason to keep
using the shared transport, not to build a second one.

``send_email`` returns ``False`` rather than raising on every transport
failure, so the ``False`` case is a real arm and not a hypothetical, and the
composer must report it rather than swallow it.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.email.email_composers import MemberAddedNoticeComposer
from app.services.email.email_template_service import EmailTemplateService


def _transport(sent: bool = True) -> MagicMock:
    transport = MagicMock()
    transport.send_email = AsyncMock(return_value=sent)
    return transport


def _composer(sent: bool = True) -> tuple[MemberAddedNoticeComposer, MagicMock]:
    """A composer over the REAL template service — the templates are part of
    what is under test, so stubbing the renderer would test nothing."""
    transport = _transport(sent)
    return MemberAddedNoticeComposer(EmailTemplateService(), transport), transport


def _sent_kwargs(transport: MagicMock) -> dict:
    return transport.send_email.await_args.kwargs


class TestTheMessage:
    @pytest.mark.asyncio
    async def test_sends_to_the_address_it_was_given_with_both_bodies(self):
        composer, transport = _composer()

        ok = await composer.send(
            email="colleague@example.com", role="operator", tenant_name="Acme Ops"
        )

        assert ok is True
        kwargs = _sent_kwargs(transport)
        assert kwargs["to_email"] == "colleague@example.com"
        # Both halves are real. Most composers here send `text_body=""` —
        # `FeedbackEmailComposer` is the exception, and builds a real one —
        # and a text/plain alternative is what a client shows when it will
        # not render HTML. An HTML-only message is also a spam signal, the
        # last thing this particular email can afford.
        assert kwargs["html_body"].strip()
        assert kwargs["text_body"].strip()
        assert "<html" in kwargs["html_body"].lower()
        assert "<html" not in kwargs["text_body"].lower()

    @pytest.mark.asyncio
    async def test_names_the_team_and_the_role_in_the_body(self):
        composer, transport = _composer()

        await composer.send(email="c@example.com", role="admin", tenant_name="Acme Ops")

        kwargs = _sent_kwargs(transport)
        for part in (kwargs["html_body"], kwargs["text_body"]):
            assert "Acme Ops" in part
            # coord's role word is internal vocabulary; the product tier is
            # what the dashboard granted and what the person will recognise.
            assert "Administrator" in part
        assert "Developer" not in kwargs["html_body"]

    @pytest.mark.asyncio
    async def test_operator_renders_as_developer(self):
        composer, transport = _composer()

        await composer.send(email="c@example.com", role="operator")

        assert "Developer" in _sent_kwargs(transport)["html_body"]

    @pytest.mark.asyncio
    async def test_an_unknown_role_is_rendered_verbatim(self):
        """Coord's role enum is wider than the two tiers this form grants.
        Showing coord's own word is worse copy than a tier label and far
        better than silently claiming the wrong one."""
        composer, transport = _composer()

        await composer.send(email="c@example.com", role="owner")

        assert "owner" in _sent_kwargs(transport)["html_body"]

    @pytest.mark.asyncio
    async def test_it_says_to_sign_in_normally_and_use_the_selector(self):
        composer, transport = _composer()

        await composer.send(email="c@example.com", role="operator")

        text = _sent_kwargs(transport)["text_body"].lower()
        assert "sign in" in text
        assert "selector" in text


class TestItNeverNamesATenantId:
    @pytest.mark.asyncio
    async def test_an_unresolved_name_becomes_a_team_not_a_uuid(self):
        composer, transport = _composer()

        await composer.send(email="c@example.com", role="operator", tenant_name=None)

        kwargs = _sent_kwargs(transport)
        for part in (kwargs["html_body"], kwargs["text_body"]):
            assert "a team" in part

    @pytest.mark.asyncio
    async def test_a_blank_name_is_treated_as_unresolved(self):
        composer, transport = _composer()

        await composer.send(email="c@example.com", role="operator", tenant_name="   ")

        assert "a team" in _sent_kwargs(transport)["html_body"]


class TestTheTenantNameIsAttackerControlled:
    """A tenant's ``display_name`` is chosen by whoever created the tenant.

    Tenant creation is self-service and every authenticated user can do it;
    coord validates only that the name slugifies, up to
    ``MAX_DISPLAY_NAME_CHARS`` = 200. (This repo's own create proxy caps its
    body at 120, but that bounds one client path, not the column.) So this
    string is attacker-chosen text that arrives inside a genuine,
    DKIM-signed email from the product's own sender.

    This is NOT an escaping bug — the HTML template autoescapes (pinned in
    ``TestTheTemplatesArePaired``) and the subject goes to SES as a
    structured parameter rather than a raw header, so neither HTML nor header
    injection is reachable. It is content spoofing, and the mitigations are
    length and placement.
    """

    SUBJECT = "You have been given access to a team on Qontinui"

    @pytest.mark.asyncio
    async def test_the_subject_is_constant_and_carries_no_tenant_name(self):
        """The strongest mitigation: the line a recipient reads first, in a
        list of messages and with no other context, contains no
        attacker-chosen character at all."""
        composer, transport = _composer()

        await composer.send(
            email="c@example.com",
            role="operator",
            tenant_name="URGENT: your password has expired, click here",
        )

        subject = _sent_kwargs(transport)["subject"]
        assert subject == self.SUBJECT
        assert "password" not in subject.lower()
        assert "URGENT" not in subject

    @pytest.mark.asyncio
    async def test_a_long_name_is_truncated_before_it_reaches_the_body(self):
        # Exactly the 200 characters coord's MAX_DISPLAY_NAME_CHARS permits,
        # ending in the sentence an attacker actually wants delivered.
        tail = " and then a whole sentence of instructions"
        name = "A" * (200 - len(tail)) + tail
        assert len(name) == 200

        composer, transport = _composer()
        await composer.send(email="c@example.com", role="operator", tenant_name=name)

        html = _sent_kwargs(transport)["html_body"]
        assert "instructions" not in html
        # 40 characters is enough to recognise a team, too little to write a
        # plausible instruction.
        assert "A" * 39 in html
        assert "A" * 41 not in html

    @pytest.mark.asyncio
    async def test_control_characters_and_newlines_do_not_survive(self):
        composer, transport = _composer()

        await composer.send(
            email="c@example.com",
            role="operator",
            # Every character the loop below asserts on must appear HERE, or
            # the assertion passes on an input that never contained it. The
            # first version of this test checked for U+2029 against an input
            # carrying only U+2028.
            tenant_name=("Acme\r\nBcc: victim@example.com\u2028\u2029\x00Ops"),
        )

        kwargs = _sent_kwargs(transport)
        # `subject` is deliberately NOT in this loop: it is a module constant
        # the sanitiser never touches, so asserting absence from it cannot
        # fail for any input and would only pad the test.
        #
        # `\n` is likewise absent: the templates are multi-line, so the
        # bodies legitimately contain newlines. What must not survive is a
        # newline from the NAME, which the last assertion covers by pinning
        # the collapsed form.
        for name in ("html_body", "text_body"):
            value = kwargs[name]
            for bad in ("\r", "\x00", "\u2028", "\u2029"):
                assert bad not in value, f"{name} kept {bad!r}"
        # Internal whitespace collapses, so the name reads as one line.
        assert "Acme Bcc: victim@example.com Ops" in kwargs["html_body"]

    #: EVERY member of the sanitiser's character class outside the C0/C1
    #: control ranges — the bidi-formatting and zero-width characters it
    #: exists for, plus the two line/paragraph separators. Completeness is
    #: the point: the first version of the sanitiser let the whole bidi and
    #: zero-width group through while stripping only the controls, and the
    #: first version of this table omitted U+2029 entirely, leaving the one
    #: character in the class with no test at all.
    #:
    #: Written as backslash ESCAPES, never as literal characters, for the
    #: reason given on `_CONTROL_CHARS`: a test file for a Trojan Source
    #: defence must not itself carry a live right-to-left override.
    INVISIBLE = (
        ("\u061c", "ARABIC LETTER MARK"),
        ("\u180e", "MONGOLIAN VOWEL SEPARATOR"),
        ("\u200b", "ZERO WIDTH SPACE"),
        ("\u200c", "ZERO WIDTH NON-JOINER"),
        ("\u200d", "ZERO WIDTH JOINER"),
        ("\u200e", "LEFT-TO-RIGHT MARK"),
        ("\u200f", "RIGHT-TO-LEFT MARK"),
        ("\u2028", "LINE SEPARATOR"),
        ("\u2029", "PARAGRAPH SEPARATOR"),
        ("\u202a", "LEFT-TO-RIGHT EMBEDDING"),
        ("\u202b", "RIGHT-TO-LEFT EMBEDDING"),
        ("\u202c", "POP DIRECTIONAL FORMATTING"),
        ("\u202d", "LEFT-TO-RIGHT OVERRIDE"),
        ("\u202e", "RIGHT-TO-LEFT OVERRIDE"),
        ("\u2060", "WORD JOINER"),
        ("\u2061", "FUNCTION APPLICATION"),
        ("\u2062", "INVISIBLE TIMES"),
        ("\u2063", "INVISIBLE SEPARATOR"),
        ("\u2064", "INVISIBLE PLUS"),
        ("\u2066", "LEFT-TO-RIGHT ISOLATE"),
        ("\u2067", "RIGHT-TO-LEFT ISOLATE"),
        ("\u2068", "FIRST STRONG ISOLATE"),
        ("\u2069", "POP DIRECTIONAL ISOLATE"),
        ("\ufeff", "ZERO WIDTH NO-BREAK SPACE"),
    )

    @pytest.mark.parametrize(("char", "label"), INVISIBLE)
    @pytest.mark.asyncio
    async def test_bidi_and_zero_width_characters_do_not_survive(
        self, char: str, label: str
    ):
        composer, transport = _composer()

        await composer.send(
            email="c@example.com",
            role="operator",
            tenant_name=f"Acme{char}Ops",
        )

        kwargs = _sent_kwargs(transport)
        # `subject` is excluded on purpose. It is a module constant the
        # sanitiser never touches, so "this character is not in it" holds for
        # every input and every character — an assertion that cannot fail is
        # not coverage. That the subject carries no tenant name at all is
        # pinned once, by
        # `test_the_subject_is_constant_and_carries_no_tenant_name`.
        for part in ("html_body", "text_body"):
            assert char not in kwargs[part], f"{part} kept {label}"

    @pytest.mark.asyncio
    async def test_an_rlo_cannot_reverse_the_rest_of_the_line(self):
        """The worked example. A bare RIGHT-TO-LEFT OVERRIDE renders
        everything after it in reverse, and in the plain-text part there is
        no markup boundary to stop the effect leaking into the sentences
        that follow the name."""
        composer, transport = _composer()

        await composer.send(
            email="c@example.com",
            role="operator",
            tenant_name="\u202eyou have NOT been given access",
        )

        text_body = _sent_kwargs(transport)["text_body"]
        assert "\u202e" not in text_body
        # The characters themselves are harmless once the override is gone.
        assert "you have NOT been given access" in text_body

    @pytest.mark.asyncio
    async def test_a_name_that_is_only_invisible_characters_falls_back(self):
        composer, transport = _composer()

        await composer.send(
            email="c@example.com",
            role="operator",
            tenant_name="\r\n\t \x00\u200b\u202e\ufeff",
        )

        assert "a team" in _sent_kwargs(transport)["html_body"]


class TestItCarriesNoCredential:
    """The whole reason this email is not an invitation.

    A person who already has an account is being told about a grant. An
    unsolicited message that offers them a password, a reset link or a token
    is a phishing lookalike, and one that arrives from the real product
    trains people to click the fake ones.
    """

    FORBIDDEN = (
        "password",
        "temporary",
        "credential",
        "reset",
        "token",
        "verify",
        "one-time",
        "activate",
    )

    @pytest.mark.asyncio
    async def test_neither_body_nor_subject_offers_a_credential(self):
        composer, transport = _composer()

        await composer.send(email="c@example.com", role="admin", tenant_name="Acme Ops")

        kwargs = _sent_kwargs(transport)
        for name in ("subject", "html_body", "text_body"):
            lowered = kwargs[name].lower()
            for word in self.FORBIDDEN:
                assert word not in lowered, f"{name} mentions {word!r}"

    @pytest.mark.asyncio
    async def test_the_only_link_is_the_plain_sign_in_page(self):
        """A bare `/login` is the app's front door, not a credential: it
        carries no token and grants nothing by being clicked."""
        import re

        composer, transport = _composer()
        await composer.send(email="c@example.com", role="operator")

        html = _sent_kwargs(transport)["html_body"]
        urls = re.findall(r'href="([^"]+)"', html)
        assert urls, "the email should give them a way in"
        for url in urls:
            assert url.endswith("/login"), url
            assert "?" not in url and "#" not in url, url


class TestTheTransportsAnswerIsReported:
    @pytest.mark.asyncio
    async def test_a_false_send_is_returned_as_false(self):
        """``send_email`` answers ``False`` SILENTLY on every unconfigured or
        refused transport — no SES client, a refused ``SendEmail``, an
        unverified sender identity, an SMTP host that will not answer. It
        raises on none of them. Reporting that as success is the defect this
        whole notice exists to fix, one layer down."""
        composer, transport = _composer(sent=False)

        ok = await composer.send(email="c@example.com", role="operator")

        assert ok is False
        transport.send_email.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_a_missing_template_is_a_failure_not_an_empty_email(self):
        """``render_template`` SWALLOWS ``TemplateNotFound`` and falls back to
        a body built from ``title`` / ``message`` context keys — neither of
        which this composer sets. So a template missing from the image would
        render an empty notification, the transport would return True, and
        the operator would be told the mail went out. The recipient gets a
        blank email; nobody learns anything. Refuse instead."""
        transport = _transport(sent=True)
        templates = EmailTemplateService()
        composer = MemberAddedNoticeComposer(templates, transport)

        with patch.object(templates, "template_exists", return_value=False):
            ok = await composer.send(email="c@example.com", role="operator")

        assert ok is False
        # Nothing was handed to a transport at all.
        transport.send_email.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_an_empty_render_is_a_failure(self):
        """The same failure in a shape ``template_exists`` cannot see — a
        present but empty file, or a render that produced nothing."""
        transport = _transport(sent=True)
        templates = EmailTemplateService()
        composer = MemberAddedNoticeComposer(templates, transport)

        with patch.object(templates, "render_template", return_value="   "):
            ok = await composer.send(email="c@example.com", role="operator")

        assert ok is False
        transport.send_email.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_it_needs_no_user_model(self):
        """The signature itself is the assertion: keyword-only, an email
        address, and nothing that requires a ``users`` row."""
        composer, _ = _composer()

        with pytest.raises(TypeError):
            await composer.send(MagicMock(), "operator")  # type: ignore[call-arg]


class TestTheTemplatesArePaired:
    def test_both_halves_exist_and_the_text_one_is_not_html_escaped(self):
        service = EmailTemplateService()
        assert service.template_exists("member_added")

        text = service.render_text_template(
            "member_added",
            {
                "tenant_name": "Bob's Team & Co",
                "role_label": "Developer",
                "login_url": "http://x/login",
            },
        )
        # The plain-text part is not HTML, so escaping it is a rendering bug:
        # a reader of the text/plain alternative would see `Bob&#39;s`.
        assert "Bob's Team & Co" in text
        assert "&#39;" not in text
        assert "&amp;" not in text

    def test_the_html_half_still_escapes(self):
        """The overlay must not have turned autoescaping off for HTML — a
        tenant name is operator-supplied and reaches this template."""
        service = EmailTemplateService()

        html = service.render_template(
            "member_added",
            {
                "tenant_name": "<script>alert(1)</script>",
                "role_label": "Developer",
                "login_url": "http://x/login",
            },
        )
        assert "<script>alert(1)</script>" not in html
        assert "&lt;script&gt;" in html
