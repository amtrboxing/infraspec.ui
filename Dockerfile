FROM node:18-alpine

ARG UID="948"
ARG GID="948"

RUN apk add --no-cache ca-certificates tini python3 make gcc g++ \
    && npm install -g infraspec.ui@latest \
    && apk del make gcc g++ \
    && addgroup -g "${GID}" app \
    && adduser -u "${UID}" -G app -D -h /app app \
    && mkdir -p /app/logs

USER app
WORKDIR /app

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["camera.ui"]
