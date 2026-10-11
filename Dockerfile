FROM node:24-bookworm-slim
ENV NODE_ENV=production HUB_DATABASE=/var/lib/package-hub/hub.sqlite
WORKDIR /app
COPY --chown=node:node *.html manifest.webmanifest ./
COPY --chown=node:node css ./css
COPY --chown=node:node js ./js
COPY --chown=node:node assets/package-hub-mark.svg ./assets/package-hub-mark.svg
COPY --chown=node:node assets/package-hub-icon-180.png assets/package-hub-icon-192.png assets/package-hub-icon-512.png ./assets/
COPY --chown=node:node server ./server
COPY --chown=node:node scripts/check-publication.cjs scripts/configure-push.cjs ./scripts/
RUN mkdir -p -m 700 /var/lib/package-hub && chown node:node /var/lib/package-hub
USER node
EXPOSE 3000
CMD ["node", "server/server.cjs"]
