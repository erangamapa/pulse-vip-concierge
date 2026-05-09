# Build from the folder that holds all three repos.
#   docker build -f pulse-vip-concierge/Dockerfile -t pulse-vip-concierge .
FROM node:22-slim
WORKDIR /srv
COPY sportsbook-contracts/packages/ts ./sportsbook-contracts/packages/ts
COPY agentloop ./agentloop
COPY pulse-vip-concierge ./pulse-vip-concierge
RUN cd sportsbook-contracts/packages/ts && npm ci
RUN cd agentloop && npm ci
WORKDIR /srv/pulse-vip-concierge
RUN npm ci --omit=dev
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["npm", "start"]
