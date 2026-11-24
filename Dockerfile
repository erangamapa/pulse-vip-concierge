#   docker build -t pulse-vip-concierge .
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["npm", "start"]
