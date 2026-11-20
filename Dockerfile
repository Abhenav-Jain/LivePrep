# --- Stage 1: Build Frontend ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./

# Public login settings, baked into the browser bundle at build time (not secrets).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
RUN npm run build

# --- Stage 2: Production Python Backend ---
FROM python:3.12-slim AS runner
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (uid 1000)
RUN groupadd -g 1000 appuser && \
    useradd -u 1000 -g appuser -m -s /bin/bash appuser

# Install Python requirements
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy backend application code
COPY backend/ ./backend/

# Copy compiled frontend from Stage 1 into /app/frontend/dist
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# The app runs as a non-root user and stores nothing locally (data lives in Postgres)
RUN chown -R appuser:appuser /app

# Set environment
ENV HOST=0.0.0.0
ENV PORT=8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

EXPOSE 8000

WORKDIR /app/backend

USER appuser

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--ws-max-size", "1048576"]
