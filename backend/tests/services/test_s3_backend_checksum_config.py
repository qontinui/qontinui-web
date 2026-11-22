"""S3Backend's checksum posture: when_required against a self-hosted store.

Plan 2026-11-22-fetches-stop-depending-on-upstreams, Phase 2. The dev and
staging compose files run versitygw, whose S3 conformance subset was measured
with boto3 set to send/validate checksums only where the API requires them.
botocore >= 1.36 otherwise adds CRC32 trailers to every PUT, a request shape
the store was never tested with. Real AWS (no endpoint URL) keeps the default.
"""

from __future__ import annotations

from unittest import mock

from app.services.storage.s3_backend import S3Backend


def _config_passed(**kwargs):
    with (
        mock.patch("app.services.storage.s3_backend.boto3.client") as client,
        mock.patch.object(S3Backend, "_ensure_bucket_exists"),
    ):
        S3Backend(bucket_name="b", region="us-east-1", **kwargs)
    return client.call_args.kwargs["config"]


def test_self_hosted_endpoint_sends_checksums_only_when_required():
    config = _config_passed(
        access_key="a", secret_key="s", endpoint_url="http://127.0.0.1:9000"
    )
    assert config.request_checksum_calculation == "when_required"
    assert config.response_checksum_validation == "when_required"
    assert config.s3 == {"addressing_style": "path"}


def test_aws_keeps_the_sdk_default():
    config = _config_passed(access_key="a", secret_key="s")
    # Unset on the Config object means botocore applies its own default.
    assert config.request_checksum_calculation is None
    assert config.response_checksum_validation is None


def test_an_older_botocore_skips_the_options_instead_of_raising():
    # botocore < 1.36 (pyproject allows boto3 ^1.35) has neither the options
    # nor the CRC32 default they override; passing them would be a TypeError.
    with mock.patch(
        "app.services.storage.s3_backend._supports_checksum_config", return_value=False
    ):
        config = _config_passed(
            access_key="a", secret_key="s", endpoint_url="http://127.0.0.1:9000"
        )
    assert config.request_checksum_calculation is None
    assert config.response_checksum_validation is None


def test_the_support_probe_reads_this_botocore():
    from botocore.config import Config

    from app.services.storage.s3_backend import _supports_checksum_config

    assert _supports_checksum_config() is (
        "request_checksum_calculation" in Config.OPTION_DEFAULTS
    )
