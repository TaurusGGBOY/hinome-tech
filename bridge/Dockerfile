FROM node:24-alpine
WORKDIR /srv
COPY --chown=node:node server.mjs .
USER node
CMD ["node", "/srv/server.mjs"]
