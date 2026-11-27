FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends clamav-daemon clamav-freshclam tini ca-certificates bash && rm -rf /var/lib/apt/lists/* && mkdir -p /run/clamav /var/lib/clamav /app /run/student-creators && chown node:node /run/clamav /var/lib/clamav /app /run/student-creators && chmod 0700 /run/student-creators
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node packages ./packages
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node infra/worker/clamd.conf infra/worker/freshclam.conf infra/worker/entrypoint.sh ./infra/worker/
ENV NODE_ENV=production CLAMD_SOCKET=/run/clamav/clamd.sock
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=22m --retries=3 CMD ["node","scripts/check-worker-health.mjs"]
ENTRYPOINT ["/usr/bin/tini","--","/bin/bash","/app/infra/worker/entrypoint.sh"]
