FROM oven/bun:1-debian

WORKDIR /app

# Set global browser path for Playwright so all users/contexts locate the same browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install curl, ca-certificates, and clean up apt cache
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy root and workspace package definitions for caching layer
COPY package.json bun.lock ./
COPY packages/app/package.json ./packages/app/
COPY packages/logger/package.json ./packages/logger/

# Install workspace dependencies
RUN bun install --frozen-lockfile

# Install Playwright Chromium, headless shell, and required OS dependencies
RUN bun run --cwd=/app/packages/app playwright install --with-deps chromium chromium-headless-shell \
    && chmod -R 777 /ms-playwright

# Copy remaining project source code
COPY packages/ ./packages/

# Set working directory to app package so relative paths (data/, mflm.sqlite) resolve correctly
WORKDIR /app/packages/app

# Default to non-interactive and headless for scheduled background execution
ENV NON_INTERACTIVE=true
ENV HEADLESS=true

CMD ["bun", "run", "index.ts"]

