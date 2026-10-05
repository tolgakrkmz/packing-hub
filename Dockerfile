FROM node:24-bookworm-slim
ENV NODE_ENV=production HUB_DATABASE=/var/lib/package-hub/hub.sqlite
WORKDIR /app
COPY *.html ./
COPY css ./css
COPY js ./js
COPY server ./server
COPY scripts/check-publication.cjs ./scripts/check-publication.cjs
RUN mkdir -p /var/lib/package-hub && chown node:node /var/lib/package-hub
USER node
EXPOSE 3000
CMD ["node", "server/server.cjs"]
