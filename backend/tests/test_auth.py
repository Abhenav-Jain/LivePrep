"""Tests for Supabase JWT verification (no network, no real keys)."""
import base64
import hashlib
import hmac
import json
import time
import uuid
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from jwt import PyJWKClientError

import auth

SUPABASE_URL = "https://test-project.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"
KID = "test-key-1"


class FakeJWKSClient:
    """Mimics PyJWKClient: knows exactly one public key."""

    def __init__(self, public_key, kid=KID, error=None):
        self.public_key = public_key
        self.kid = kid
        self.error = error

    def get_signing_key_from_jwt(self, token):
        if self.error is not None:
            raise self.error
        header = jwt.get_unverified_header(token)
        if header.get("kid") != self.kid:
            raise PyJWKClientError(f'Unable to find a signing key that matches: "{header.get("kid")}"')
        return SimpleNamespace(key=self.public_key)


@pytest.fixture(scope="module")
def private_key():
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def verifier(private_key):
    return auth.SupabaseJWTVerifier(SUPABASE_URL, jwks_client=FakeJWKSClient(private_key.public_key()))


def claims(**overrides):
    now = int(time.time())
    base = {
        "sub": str(uuid.uuid4()),
        "aud": "authenticated",
        "iss": ISSUER,
        "iat": now,
        "exp": now + 3600,
        "email": "student@example.com",
    }
    base.update(overrides)
    return {k: v for k, v in base.items() if v is not None}


def make_token(private_key, payload=None, kid=KID, alg="ES256"):
    headers = {"kid": kid} if kid else {}
    return jwt.encode(payload if payload is not None else claims(), private_key, algorithm=alg, headers=headers)


def b64(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


def status_of(verifier, token):
    with pytest.raises(HTTPException) as exc:
        verifier.verify(token)
    return exc.value.status_code


def test_valid_token(verifier, private_key):
    user_id = str(uuid.uuid4())
    user = verifier.verify(make_token(private_key, claims(sub=user_id)))
    assert str(user.user_id) == user_id
    assert user.email == "student@example.com"


def test_expired_token(verifier, private_key):
    now = int(time.time())
    token = make_token(private_key, claims(iat=now - 7200, exp=now - 3600))
    assert status_of(verifier, token) == 401


def test_wrong_audience(verifier, private_key):
    assert status_of(verifier, make_token(private_key, claims(aud="anon"))) == 401


def test_wrong_issuer(verifier, private_key):
    token = make_token(private_key, claims(iss="https://evil.example.com/auth/v1"))
    assert status_of(verifier, token) == 401


def test_missing_sub(verifier, private_key):
    assert status_of(verifier, make_token(private_key, claims(sub=None))) == 401


def test_non_uuid_sub(verifier, private_key):
    assert status_of(verifier, make_token(private_key, claims(sub="not-a-uuid"))) == 401


def test_missing_exp(verifier, private_key):
    assert status_of(verifier, make_token(private_key, claims(exp=None))) == 401


def test_issued_in_the_future(verifier, private_key):
    now = int(time.time())
    token = make_token(private_key, claims(iat=now + 3600, exp=now + 7200))
    assert status_of(verifier, token) == 401


def test_unknown_kid(verifier, private_key):
    assert status_of(verifier, make_token(private_key, kid="some-other-key")) == 401


def test_missing_kid(verifier, private_key):
    assert status_of(verifier, make_token(private_key, kid=None)) == 401


def test_tampered_signature(verifier, private_key):
    token = make_token(private_key)
    header, payload, signature = token.split(".")
    flipped = ("A" if signature[0] != "A" else "B") + signature[1:]
    assert status_of(verifier, ".".join([header, payload, flipped])) == 401


def test_tampered_payload(verifier, private_key):
    token = make_token(private_key, claims())
    header, _payload, signature = token.split(".")
    forged_payload = b64(claims(sub=str(uuid.uuid4())))
    assert status_of(verifier, ".".join([header, forged_payload, signature])) == 401


def test_hs256_algorithm_confusion_is_rejected(verifier):
    """Classic attack: HMAC-sign a token with a guessable secret and claim HS256."""
    header = b64({"alg": "HS256", "typ": "JWT", "kid": KID})
    payload = b64(claims())
    signing_input = f"{header}.{payload}".encode()
    sig = hmac.new(b"public-key-material-or-anything", signing_input, hashlib.sha256).digest()
    token = f"{header}.{payload}." + base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    assert status_of(verifier, token) == 401


def test_alg_none_is_rejected(verifier):
    token = f"{b64({'alg': 'none', 'typ': 'JWT', 'kid': KID})}.{b64(claims())}."
    assert status_of(verifier, token) == 401


@pytest.mark.parametrize("bad", ["", "abc", "a.b.c", "....", "x" * 20000])
def test_garbage_tokens(verifier, bad):
    assert status_of(verifier, bad) == 401


def test_jwks_unreachable_returns_503(private_key):
    broken = auth.SupabaseJWTVerifier(
        SUPABASE_URL,
        jwks_client=FakeJWKSClient(private_key.public_key(), error=PyJWKClientError("Fail to fetch data from the url")),
    )
    assert status_of(broken, make_token(private_key)) == 503


def test_empty_jwks_returns_503(private_key):
    empty = auth.SupabaseJWTVerifier(
        SUPABASE_URL,
        jwks_client=FakeJWKSClient(
            private_key.public_key(),
            error=PyJWKClientError("The JWKS endpoint did not contain any signing keys"),
        ),
    )
    assert status_of(empty, make_token(private_key)) == 503


def test_audience_is_configurable(private_key):
    custom = auth.SupabaseJWTVerifier(
        SUPABASE_URL, audience="my-aud", jwks_client=FakeJWKSClient(private_key.public_key())
    )
    assert custom.verify(make_token(private_key, claims(aud="my-aud"))).user_id
    assert status_of(custom, make_token(private_key, claims(aud="authenticated"))) == 401


def test_invalid_supabase_url_rejected():
    with pytest.raises(ValueError):
        auth.SupabaseJWTVerifier("gkulij.supabase.co")


@pytest.mark.parametrize(
    "header,ok",
    [
        (None, False),
        ("", False),
        ("Bearer", False),
        ("Basic abc", False),
        ("Bearer a b", False),
        ("bearer tok", True),
        ("Bearer tok", True),
        ("BEARER tok", True),
    ],
)
def test_extract_bearer(header, ok):
    if ok:
        assert auth._extract_bearer(header) == "tok"
    else:
        with pytest.raises(HTTPException) as exc:
            auth._extract_bearer(header)
        assert exc.value.status_code == 401
