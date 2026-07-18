# API Spector CLI image: run tests, mock servers, and the contract dashboard
# in CI or on a server, with no Node/Electron setup on the host.
#
#   docker build -t api-spector .
#   docker run --rm -v "$PWD:/workspace" api-spector run --workspace /workspace
#   docker run --rm -p 8080:8080 -v "$PWD:/workspace" api-spector \
#     contract report --workspace /workspace --serve --port 8080
#
# The UI is not included (Electron is skipped entirely); use the desktop app
# for that. Every CLI subcommand works: run, mock, record, contract, wsdl, agents.

# ── Build stage: compile src/ → out/ ─────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips Electron's binary download and the repo's macOS-only
# prepare hooks; neither is needed to compile the CLI bundles.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# ── Runtime stage: production deps only, no Electron, no toolchain ───────────
FROM node:22-alpine AS production
LABEL org.opencontainers.image.title="API Spector CLI" \
      org.opencontainers.image.description="Local-first API testing: CLI runner, mock servers, contract testing and dashboard" \
      org.opencontainers.image.source="https://github.com/testsmith-io/api-spector"
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# --omit=optional drops electron (the CLI never needs it); --omit=dev drops the
# build toolchain. Result: a small pure-Node runtime.
RUN npm ci --omit=dev --omit=optional --ignore-scripts && npm cache clean --force
COPY --from=build /app/out ./out
COPY bin ./bin

# Convention: mount your workspace at /workspace and pass relative paths.
WORKDIR /workspace
EXPOSE 8080
ENTRYPOINT ["node", "/app/bin/cli.js"]
CMD ["--help"]
