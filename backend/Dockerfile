FROM node:24-bookworm-slim AS build
WORKDIR /service
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libxml2-utils openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=8080 DATA_DIR=/var/lib/alpha-fiscal SCHEMA_DIR=/schemas
WORKDIR /service
COPY --from=build --chown=node:node /service/dist ./dist
COPY --from=build --chown=node:node /service/node_modules ./node_modules
COPY package.json ./
RUN mkdir -p /var/lib/alpha-fiscal && chown node:node /var/lib/alpha-fiscal
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
