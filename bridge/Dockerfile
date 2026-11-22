FROM node:24-alpine
WORKDIR /srv
COPY --chown=node:node server.mjs feishu-cards.mjs .
USER node
CMD ["node", "/srv/server.mjs"]
