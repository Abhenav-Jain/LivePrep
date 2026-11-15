import os
import uuid
import logging
from dataclasses import dataclass
from typing import Optional
import jwt
from jwt import PyJWKClient, PyJWKClientError, InvalidTokenError, PyJWTError
from dotenv import load_dotenv
from fastapi import Header, HTTPException, status

load_dotenv()

logger = logging.getLogger("liveprep-auth")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
if not SUPABASE_URL:
    raise RuntimeError("CRITICAL STARTUP ERROR: SUPABASE_URL is missing or empty in environment.")

SUPABASE_JWT_AUDIENCE = os.getenv("SUPABASE_JWT_AUDIENCE", "authenticated")
JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
EXPECTED_ISSUER = f"{SUPABASE_URL}/auth/v1"

# Allowed asymmetric algorithms ONLY. Explicitly reject 'none' and 'HS256'
ALLOWED_ALGORITHMS = ["ES256", "RS256"]

# Key client with caching and auto key rotation
jwks_client = PyJWKClient(
    JWKS_URL,
    cache_keys=True,
    max_cached_keys=16,
    cache_jwk_set=True,
    lifespan=3600,
)


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: uuid.UUID
    email: Optional[str] = None


def verify_supabase_jwt(token: str) -> AuthenticatedUser:
    """Verifies a Supabase user access token against the project JWKS.
    Enforces asymmetric algorithms (ES256, RS256), exp, iat, sub, aud, and iss.
    Rejects HS256, none, and non-UUID sub.
    """
    if not token or not isinstance(token, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Inspect header for algorithm-confusion protection and kid
    try:
        unverified_header = jwt.get_unverified_header(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    alg = unverified_header.get("alg")
    if alg not in ALLOWED_ALGORITHMS or alg in ("none", "HS256", "HS384", "HS512"):
        logger.warning(f"Rejected token with disallowed algorithm: {alg}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    kid = unverified_header.get("kid")
    if not kid:
        logger.warning("Token missing 'kid' in header.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Fetch signing key from JWKS with one refresh on unknown kid
    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)
    except PyJWKClientError as e:
        err_msg = str(e).lower()
        # If JWKS returned no keys or server is unreachable
        if "unable to find a signing key" in err_msg:
            # Check if JWKS is reachable but empty (e.g. legacy HS256 project)
            try:
                signing_keys = jwks_client.get_signing_keys()
                if not signing_keys:
                    logger.error("Supabase JWKS endpoint returned 0 keys! The project might still be using legacy symmetric HMAC/HS256.")
                    raise RuntimeError("Supabase project has no asymmetric keys published in JWKS. Migrate to asymmetric signing keys (ES256/RS256).")
            except RuntimeError:
                raise
            except Exception:
                pass
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        # Network/connection error to JWKS endpoint
        logger.error(f"JWKS endpoint connection error: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        logger.error(f"Unexpected error fetching signing key: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Decode and verify payload
    try:
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=ALLOWED_ALGORITHMS,
            audience=SUPABASE_JWT_AUDIENCE,
            issuer=EXPECTED_ISSUER,
            options={
                "verify_signature": True,
                "verify_exp": True,
                "verify_iat": True,
                "verify_aud": True,
                "verify_iss": True,
                "require": ["exp", "iat", "sub", "aud", "iss"],
            },
        )
    except (InvalidTokenError, PyJWTError) as e:
        logger.warning(f"JWT validation failed: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        logger.error(f"Unexpected token decoding error: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    raw_sub = payload.get("sub")
    try:
        user_uuid = uuid.UUID(str(raw_sub))
    except (TypeError, ValueError):
        logger.warning("Token sub claim is not a valid UUID.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return AuthenticatedUser(
        user_id=user_uuid,
        email=payload.get("email"),
    )


async def current_user(
    authorization: Optional[str] = Header(default=None)
) -> AuthenticatedUser:
    """FastAPI dependency for verifying Bearer access token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization[len("Bearer ") :].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return verify_supabase_jwt(token)
