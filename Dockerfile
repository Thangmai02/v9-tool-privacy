FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/privacy-policy.html /app/terms.html /app/data-deletion.html /app/style.css /app/logo.svg ./public/
COPY --from=build --chown=node:node /app/scripts/start-service.sh ./scripts/start-service.sh
USER node
EXPOSE 3000
CMD ["sh", "scripts/start-service.sh", "api"]
