FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY backend/public ./backend/public
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3103
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 3103
CMD ["node", "server/app.mjs"]
