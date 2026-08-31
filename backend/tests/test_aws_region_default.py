"""The ``AWS_REGION`` default is load-bearing, so pin it and pin its wiring.

``AWS_REGION`` decides which region the SES client behind every outbound email
is built in.  It used to default to ``eu-central-1`` while the sending identity
lives in ``us-east-1``, and that combination fails *silently*: SES identities
are per-region, so the boto3 client constructs fine and each send is then
rejected by a region that has never heard of the identity.

Measured against account 047719635665 on 2026-08-31::

    ses list-identities  us-east-1     -> staging.qontinui.io
                         eu-central-1  -> qontinui.io + 3 personal addresses

qontinui-web#1179 corrected the default but asserted nothing, so a revert would
have been invisible -- which is what these tests close.  They matter because the
running task definition (``qontinui-staging-web:645``) omits ``AWS_REGION``
entirely: this default, not an environment variable, is what reaches boto3.
"""

from app.core.config import Settings


def test_aws_region_default_is_us_east_1():
    """The declared default -- not the resolved value, which a local .env moves."""
    assert Settings.model_fields["AWS_REGION"].default == "us-east-1"


def test_ses_client_is_built_from_the_configured_region(monkeypatch):
    """The default only matters if it actually reaches the client.

    Asserted with a sentinel region rather than ``us-east-1`` so the test fails
    if someone hardcodes the correct-looking literal at the boto3 call site
    instead of reading it from settings.
    """
    from app.services.email import email_transport_service as mod

    captured: dict[str, object] = {}

    class _FakeBoto3:
        @staticmethod
        def client(service_name: str, **kwargs: object) -> object:
            captured["service"] = service_name
            captured["region"] = kwargs.get("region_name")
            return object()

    monkeypatch.setattr(mod, "boto3", _FakeBoto3)
    monkeypatch.setattr(mod.settings, "USE_SES_API", True)
    monkeypatch.setattr(mod.settings, "AWS_REGION", "us-west-2")

    service = mod.EmailTransportService()

    assert service.ses_client is not None
    assert captured["service"] == "ses"
    assert captured["region"] == "us-west-2"


def test_aws_region_has_exactly_one_default():
    """Ban a *second* default for ``AWS_REGION`` -- the drift that caused #1179.

    Before #1179 the same environment variable was defaulted in two places that
    nothing kept in agreement: the ``Settings`` field here, and a bare
    ``os.getenv("AWS_REGION", "eu-central-1")`` in the (since-deleted)
    ``app/services/secrets_manager.py``.  Correcting one and missing the other is
    the whole failure mode, so the fix is not "correct both" -- it is to allow
    only one place to say what the default is.

    Reading the variable is fine; supplying a fallback is what this bans, in
    all three shapes a second default can take: ``os.getenv``/``os.environ.get``
    with a fallback argument, ``os.environ.setdefault``, and a declared default
    (``AWS_REGION: str = "..."`` or ``Field(default=...)``) in some other
    settings class.  The first version of this guard caught only the first
    shape, so the other two would have re-admitted exactly the drift it names.
    ``app/core/config.py`` is exempt because it *is* the one place.

    Written in the same "ban the dead pattern" idiom as
    ``test_no_fastembed_import.py`` and ``test_no_celery_import.py``: a guard
    that holds at import time rather than only when a rare branch runs.
    """
    import ast
    from pathlib import Path

    app_root = Path(__file__).resolve().parent.parent / "app"
    owner = app_root / "core" / "config.py"

    def _reads_env(func: ast.expr) -> bool:
        # os.getenv(...) / getenv(...) / os.environ.get(...)
        # os.environ.setdefault(...) supplies a default *by definition*, so it
        # belongs here too -- it was the first hole this guard shipped with.
        if isinstance(func, ast.Name):
            return func.id in {"getenv", "setdefault"}
        if isinstance(func, ast.Attribute):
            return func.attr in {"getenv", "get", "setdefault"}
        return False

    def _declared_default(node: ast.AST) -> bool:
        """A second *declared* default, e.g. in another ``BaseSettings``.

        The call-shaped scan below cannot see this one: ``AWS_REGION: str =
        "eu-central-1"`` is an assignment, not a call. Restricted to a literal
        string or a ``Field(default=...)`` so that a pass-through read such as
        ``AWS_REGION = settings.AWS_REGION`` is not flagged.
        """
        if isinstance(node, ast.AnnAssign):
            targets, value = [node.target], node.value
        elif isinstance(node, ast.Assign):
            targets, value = node.targets, node.value
        else:
            return False
        if value is None:
            return False
        if not any(isinstance(t, ast.Name) and t.id == "AWS_REGION" for t in targets):
            return False
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            return True
        return (
            isinstance(value, ast.Call)
            and isinstance(value.func, ast.Name)
            and value.func.id == "Field"
            and any(
                kw.arg == "default" and isinstance(kw.value, ast.Constant)
                for kw in value.keywords
            )
        )

    offenders: list[str] = []
    for path in sorted(app_root.rglob("*.py")):
        if path == owner:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if _declared_default(node):
                offenders.append(f"{path.relative_to(app_root.parent)}:{node.lineno}")
                continue
            if not isinstance(node, ast.Call) or not _reads_env(node.func):
                continue
            if not node.args or not isinstance(node.args[0], ast.Constant):
                continue
            if node.args[0].value != "AWS_REGION":
                continue
            if len(node.args) > 1 or node.keywords:  # a fallback was supplied
                offenders.append(f"{path.relative_to(app_root.parent)}:{node.lineno}")

    assert not offenders, (
        "AWS_REGION is defaulted outside app/core/config.py, which is exactly the "
        "two-defaults drift #1179 had to correct: " + ", ".join(offenders)
    )
