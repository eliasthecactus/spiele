# Ein Image für alles: Node liefert die App aus und beantwortet /api.
FROM node:24-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data FRONTEND_DIR=/app/frontend
COPY api/package.json api/package-lock.json api/
RUN cd api && npm ci --omit=dev && npm cache clean --force
COPY api/src api/src
COPY api/entrypoint.sh /entrypoint.sh
COPY frontend frontend
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "api/src/server.js"]
