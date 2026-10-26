# Single-service image for Railway: builds the React UI and the API, and the API
# serves the UI from the SAME origin (so API calls are relative — no CORS, no
# VITE_API_URL). Build context = repo root (set the Railway service's Root
# Directory to the repo root / empty, NOT "backend").
#
#   https://<service>.up.railway.app/          -> React UI  (served by the API)
#   https://<service>.up.railway.app/api/...   -> API       (same origin)

# ---- Stage 1: build the frontend (Vite) ----
FROM node:20-slim AS frontend
WORKDIR /fe
COPY package*.json ./
RUN npm install
COPY . .
# Empty API base => the app calls /api/... on its own host (same-origin).
ENV VITE_API_URL=""
RUN npm run build            # outputs /fe/dist

# ---- Stage 2: build the backend (API + Prisma) ----
FROM node:20-slim AS backend
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
RUN npm install
COPY backend/ .
RUN npx prisma generate
RUN npm run build            # outputs /app/dist

# ---- Stage 3: runtime ----
FROM node:20-slim AS runtime
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
# Tell the API where the built UI lives so it serves it with SPA fallback.
ENV FRONTEND_DIST=/app/public
COPY --from=backend /app/package*.json ./
COPY --from=backend /app/node_modules ./node_modules
COPY --from=backend /app/dist ./dist
COPY --from=backend /app/prisma ./prisma
# The one-time data fix (npm run fix:existing-bills) runs from source with tsx.
COPY --from=backend /app/src ./src
COPY --from=backend /app/scripts ./scripts
COPY --from=backend /app/tsconfig.json ./tsconfig.json
# The built UI, served by the API from FRONTEND_DIST.
COPY --from=frontend /fe/dist ./public
EXPOSE 8080
# Sync schema, then start the API (which also serves the UI). Railway injects PORT.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
