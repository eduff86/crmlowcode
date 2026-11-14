FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev && mkdir -p /data && chown node:node /data
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV DEMO_MODE=true
USER node
EXPOSE 3000
CMD ["npm", "start"]
