"""Unit tests for the memory-write secret sweep
(``app/services/memory_redaction.py``)."""

from __future__ import annotations

from app.services.memory_redaction import redact_text


def test_clean_text_untouched() -> None:
    text = (
        "The runner retries the workflow three times before surfacing "
        "the failure to the operator. See phases.rs for details."
    )
    result = redact_text(text)
    assert result.text == text
    assert not result.redacted
    assert result.counts == {}


def test_aws_access_key_redacted() -> None:
    result = redact_text("creds were AKIAIOSFODNN7EXAMPLE in the env")
    assert "AKIAIOSFODNN7EXAMPLE" not in result.text
    assert "[REDACTED:aws_key]" in result.text
    assert result.counts == {"aws_key": 1}


def test_jwt_blob_redacted() -> None:
    jwt = (
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
        "eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P"
    )
    result = redact_text(f"the bearer was {jwt} apparently")
    assert jwt not in result.text
    assert "[REDACTED:jwt]" in result.text
    assert result.counts.get("jwt") == 1


def test_private_key_block_redacted() -> None:
    pem = (
        "-----BEGIN RSA PRIVATE KEY-----\n"
        "MIIEpAIBAAKCAQEA7bq0\nmoresecretbytes\n"
        "-----END RSA PRIVATE KEY-----"
    )
    result = redact_text(f"found this in the repo:\n{pem}\nplease rotate")
    assert "MIIEpAIBAAKCAQEA7bq0" not in result.text
    assert "[REDACTED:private_key]" in result.text
    assert result.counts.get("private_key") == 1
    assert "please rotate" in result.text


def test_keyed_secret_assignment_redacted() -> None:
    result = redact_text("set api_key: sk-abcdef1234567890 in the config")
    assert "sk-abcdef1234567890" not in result.text
    assert "[REDACTED:keyed_secret]" in result.text
    # The key name itself stays readable.
    assert "api_key" in result.text


def test_password_equals_redacted_case_insensitive() -> None:
    result = redact_text("PASSWORD=hunter2hunter2")
    assert "hunter2hunter2" not in result.text
    assert result.counts.get("keyed_secret") == 1


def test_long_hex_after_secret_key_redacted() -> None:
    hex_blob = "deadbeef" * 8  # 64 hex chars
    result = redact_text(f"secret = {hex_blob}")
    assert hex_blob not in result.text
    assert result.counts.get("keyed_secret") == 1


def test_short_values_after_key_not_redacted() -> None:
    # < 8 chars after the key — not secret-shaped enough to sweep.
    result = redact_text("token = abc")
    assert result.text == "token = abc"
    assert not result.redacted


def test_multiple_classes_counted() -> None:
    result = redact_text(
        "AKIAIOSFODNN7EXAMPLE and AKIAIOSFODNN7EXAMPL2 plus password=supersecret123"
    )
    assert result.counts["aws_key"] == 2
    assert result.counts["keyed_secret"] == 1
    assert result.total == 3
