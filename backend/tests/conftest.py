"""Shared test configuration.

These defaults are applied BEFORE any test module imports the application, so the
app's fail-closed startup checks pass without touching real credentials.
Real values from a developer's .env file are never needed (and never used) in tests.
"""
import os

os.environ.setdefault("GEMINI_API_KEY", "test_gemini_api_key_valid")
os.environ.setdefault("LIVEPREP_TOKEN", "12345678901234567890123456789012")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8000")
os.environ.setdefault("SUPABASE_URL", "https://test-project.supabase.co")
