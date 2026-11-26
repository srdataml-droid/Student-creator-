FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends clamav-daemon clamav-freshclam tini ca-certificates bash && rm -rf /var/lib/apt/lists/* && mkdir -p /run/clamav /var/lib/clamav /app && chown node:node /run/clamav /var/lib/clamav /app
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node packages ./packages
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node infra/worker/clamd.conf infra/worker/freshclam.conf infra/worker/entrypoint.sh ./infra/worker/
ENV NODE_ENV=production CLAMD_SOCKET=/run/clamav/clamd.sock
USER node
ENTRYPOINT ["/usr/bin/tini","--","/bin/bash","/app/infra/worker/entrypoint.sh"]
