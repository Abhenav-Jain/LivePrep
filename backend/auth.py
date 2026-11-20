"""Supabase access-token (JWT) verification for LivePrep.

How it works
------------
* Supabase signs user access tokens with an asymmetric key (ES256 / RS256).
* We verify the signature with the PUBLIC keys published at
  ``{SUPABASE_URL}/auth/v1/.well-known/jwks.json`` (no secret is needed).
* Only ES256 and RS256 are accepted. ``none`` and every HMAC algorithm (HS*) are
  rejected before any key is looked up, which blocks algorithm-confusion attacks.
* exp / iat / sub / aud / iss are all required and checked.
* Every failure becomes a generic 401. If the JWKS endpoint cannot be reached the
  answer is 503 (our problem, not the caller's). Tokens are never logged.

The JWKS download is a blocking network call, so ``current_user`` runs the
verification in a worker thread and the HTTP timeout is short. That way a slow or
unreachable Supabase can never freeze the event loop (which also carries the live
audio WebSockets).
"""
import os
import uuid
import logging
import threading
from dataclasses import dataclass
from typing import Optional

import jwt
from jwt import PyJWKClient, PyJWKClientError, PyJWTError
from fastapi import Header, HTTPException, status
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger("liveprep-auth")

# Only asymmetric algorithms are allowed. Never add "none" or any "HS*" here.
ALLOWED_ALGORITHMS = ("ES256", "RS256")
MAX_TOKEN_LENGTH = 8192          # real Supabase tokens are ~1 KB; refuse absurd input early
CLOCK_SKEW_SECONDS = 10          # tolerate small clock differences on exp / iat
JWKS_HTTP_TIMEOUT_SECONDS = 5
JWKS_CACHE_SECONDS = 3600
JWKS_REFRESH_COOLDOWN_SECONDS = 60   # unknown-kid tokens cannot force a refetch more often than this


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: uuid.UUID
    email: Optional[str] = None


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Authentication service temporarily unavailable",
    )


def _safe(value: object) -> str:
    """Printable, truncated form of an attacker-controlled value for log lines."""
    return repr(str(value))[:40]


class SupabaseJWTVerifier:
    def __init__(
        self,
        supabase_url: str,
        audience: str = "authenticated",
        jwks_client: Optional[PyJWKClient] = None,
    ) -> None:
        self.supabase_url = supabase_url.strip().rstrip("/")
        if not self.supabase_url.startswith(("https://", "http://")):
            raise ValueError("SUPABASE_URL must start with https:// (or http:// for local dev)")
        self.audience = audience
        self.issuer = f"{self.supabase_url}/auth/v1"
        self.jwks_url = f"{self.issuer}/.well-known/jwks.json"
        self.jwks_client = jwks_client or PyJWKClient(
            self.jwks_url,
            cache_keys=True,
            max_cached_keys=16,
            cache_jwk_set=True,
            lifespan=JWKS_CACHE_SECONDS,
            timeout=JWKS_HTTP_TIMEOUT_SECONDS,
            cooldown_duration=JWKS_REFRESH_COOLDOWN_SECONDS,
        )

    def verify(self, token: str) -> AuthenticatedUser:
        """Blocking verification. Raises HTTPException (401 / 503)."""
        if not isinstance(token, str) or not token or len(token) > MAX_TOKEN_LENGTH:
            raise _unauthorized()

        # 1. Look at the header BEFORE touching any key (algorithm-confusion protection).
        try:
            header = jwt.get_unverified_header(token)
        except PyJWTError:
            raise _unauthorized()

        alg = header.get("alg")
        if alg not in ALLOWED_ALGORITHMS:
            logger.warning("Rejected token with disallowed algorithm %s", _safe(alg))
            raise _unauthorized()
        if not header.get("kid"):
            logger.warning("Rejected token without kid")
            raise _unauthorized()

        # 2. Find the signing key (cached; one rate-limited refresh for unknown kid).
        try:
            signing_key = self.jwks_client.get_signing_key_from_jwt(token)
        except PyJWKClientError as exc:
            if "Unable to find a signing key" in str(exc):
                logger.warning("Rejected token with unknown kid %s", _safe(header.get("kid")))
                raise _unauthorized()
            # Network failure, bad JSON, or an EMPTY key set (project still on legacy HS256).
            logger.error(
                "JWKS problem (%s). If this persists, open %s and make sure it lists keys; "
                "if it is empty, migrate the Supabase project to asymmetric JWT signing keys.",
                type(exc).__name__,
                self.jwks_url,
            )
            raise _unavailable()
        except Exception as exc:  # noqa: BLE001 - never leak details to the caller
            logger.error("Unexpected error while fetching signing key: %s", type(exc).__name__)
            raise _unavailable()

        # 3. Verify signature and all claims.
        try:
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=list(ALLOWED_ALGORITHMS),
                audience=self.audience,
                issuer=self.issuer,
                leeway=CLOCK_SKEW_SECONDS,
                options={
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_iat": True,
                    "verify_aud": True,
                    "verify_iss": True,
                    "require": ["exp", "iat", "sub", "aud", "iss"],
                },
            )
        except PyJWTError as exc:
            logger.warning("JWT validation failed: %s", type(exc).__name__)
            raise _unauthorized()
        except Exception as exc:  # noqa: BLE001
            logger.error("Unexpected token decoding error: %s", type(exc).__name__)
            raise _unauthorized()

        # 4. The subject must be a UUID (Supabase user id).
        try:
            user_id = uuid.UUID(str(payload.get("sub")))
        except (TypeError, ValueError):
            logger.warning("Token sub claim is not a valid UUID")
            raise _unauthorized()

        email = payload.get("email")
        return AuthenticatedUser(user_id=user_id, email=email if isinstance(email, str) else None)


# --------------------------------------------------------------------------- #
# Process-wide verifier (built lazily from environment variables)
# --------------------------------------------------------------------------- #
_verifier: Optional[SupabaseJWTVerifier] = None
_verifier_lock = threading.Lock()


def get_verifier() -> SupabaseJWTVerifier:
    global _verifier
    if _verifier is None:
        with _verifier_lock:
            if _verifier is None:
                url = os.getenv("SUPABASE_URL", "").strip()
                if not url:
                    raise RuntimeError("SUPABASE_URL is not configured")
                _verifier = SupabaseJWTVerifier(
                    url, audience=os.getenv("SUPABASE_JWT_AUDIENCE", "authenticated")
                )
    return _verifier


def reset_verifier(verifier: Optional[SupabaseJWTVerifier] = None) -> None:
    """Replace (or clear) the process-wide verifier. Used by tests."""
    global _verifier
    with _verifier_lock:
        _verifier = verifier


def _extract_bearer(authorization: Optional[str]) -> str:
    if not authorization:
        raise _unauthorized()
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise _unauthorized()
    return parts[1]


async def current_user(authorization: Optional[str] = Header(default=None)) -> AuthenticatedUser:
    """FastAPI dependency: returns the verified user, or raises 401 / 503."""
    token = _extract_bearer(authorization)
    verifier = get_verifier()
    # Blocking JWKS download must not run on the event loop.
    return await run_in_threadpool(verifier.verify, token)