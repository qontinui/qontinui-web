"""``COGNITO_REGION`` is baked into the issuer URL, so a wrong one fails silently.

The sibling of ``test_aws_region_default.py``: same defect class (a region
default that disagrees with where the resource actually lives, failing with no
configuration error), one setting over. qontinui-web#1189 pinned the SES half
and left this one unasserted.
"""

from app.core.config import Settings


def test_cognito_region_agrees_with_the_pool_it_points_at():
    """The other region default that fails silently -- and it is self-checking.

    ``COGNITO_REGION`` is not consumed as a region string; it is baked into a
    URL.  ``Settings.derive_cognito_issuer`` builds
    ``https://cognito-idp.<COGNITO_REGION>.amazonaws.com/<COGNITO_USER_POOL_ID>``
    whenever ``COGNITO_ISSUER`` is blank, and that issuer is what every Cognito
    JWT is validated against.  A region that disagrees with the pool yields an
    issuer no token will ever carry, so *every* Cognito login fails -- with no
    configuration error, exactly the silent per-region failure #1179 hit with
    SES identities.

    Unlike ``test_aws_region_default_is_us_east_1`` this pins no literal: a
    Cognito pool id is ``<region>_<suffix>``, so the pool states its own region
    and the two settings can be checked against each other.  Moving the pool to
    another region keeps this test passing; moving only one of the two does not.
    """
    pool_id = Settings.model_fields["COGNITO_USER_POOL_ID"].default
    region = Settings.model_fields["COGNITO_REGION"].default

    if not pool_id:
        # A blank pool id is a supported configuration: config.py documents it as
        # disabling the Cognito accept path, and derive_cognito_issuer then
        # returns "" regardless of region. Nothing to cross-check.
        return

    assert "_" in pool_id, (
        f"COGNITO_USER_POOL_ID default {pool_id!r} is not <region>_<suffix>, so "
        "the issuer derived from it cannot be checked against COGNITO_REGION"
    )
    assert pool_id.split("_", 1)[0] == region, (
        f"COGNITO_REGION default is {region!r} but the default user pool "
        f"{pool_id!r} lives in {pool_id.split('_', 1)[0]!r}. derive_cognito_issuer "
        "would build an issuer no token carries, rejecting every Cognito login."
    )
