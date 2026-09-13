# Single-image build: Vite frontend + Express/Prisma backend served together.
# Railway (or any Docker host) builds this and runs one web service.
FROM node:20-slim AS build
WORKDIR /app

# Prisma needs OpenSSL present.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# --- 1. Build the frontend (repo root) ---
COPY package*.json ./
RUN npm install
COPY . .
# Empty base URL => the SPA calls the API on its own origin (same service).
ENV VITE_API_URL=""
RUN npm run build            # outputs /app/dist

# --- 2. Build the backend ---
WORKDIR /app/backend
RUN npm install
RUN npx prisma generate
RUN npm run build            # outputs /app/backend/dist

# ---------- runtime image ----------
FROM node:20-slim AS runtime
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production

# Frontend build (served by the backend) and backend build + deps.
COPY --from=build /app/dist ./dist
COPY --from=build /app/backend/package*.json ./backend/
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma

WORKDIR /app/backend
# Railway injects PORT; the server reads process.env.PORT.
EXPOSE 8080
# On boot: sync the schema to the database, then start the server.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
