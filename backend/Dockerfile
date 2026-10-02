# Backend-only image (API + Prisma). Deployed on Railway; the UI is on Vercel.
# Railway build context is this /backend directory (set Root Directory = backend).
FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build            # outputs /app/dist

FROM node:20-slim AS runtime
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
# The one-time data fix (npm run fix:existing-bills) runs from source with tsx.
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json
EXPOSE 8080
# Sync schema, then start the API. Railway injects PORT.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
