# syntax=docker/dockerfile:1.7
FROM node:24-trixie-slim AS builder
WORKDIR /build
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vitest.config.ts .oxlintrc.json ./
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
COPY fixtures ./fixtures
COPY .github ./.github
RUN pnpm typecheck && pnpm test && pnpm build

FROM node:24-trixie-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive COMPOSER_ALLOW_SUPERUSER=1 COMPOSER_HOME=/opt/composer-home \
    PATH="/opt/venv/bin:/opt/php/bin:${PATH}" FALLOW_TELEMETRY_DISABLED=1 JSCPD_NO_TIPS=1 NO_COLOR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      php8.4-cli php8.4-mbstring php8.4-xml php8.4-intl php8.4-zip \
      php8.4-apcu php8.4-redis php8.4-gd php8.4-bcmath php8.4-curl php8.4-mysql \
      php8.4-pgsql php8.4-sqlite3 php8.4-soap php8.4-xsl php8.4-imagick \
      php8.4-memcached php8.4-amqp php8.4-mongodb php8.4-igbinary php8.4-msgpack \
      php8.4-uuid php8.4-yaml php8.4-ldap php8.4-gmp php8.4-bz2 php8.4-mailparse \
      php8.4-ds unzip composer python3 python3-venv git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY docker/php/99-code-quality.ini /etc/php/8.4/cli/conf.d/99-code-quality.ini
# TS/JS tools (typescript is required by dependency-cruiser to resolve TS sources)
RUN npm install -g --no-fund --no-audit oxlint@1.82.0 fallow@3.23.0 jscpd@5.2.0 knip@6.35.1 dependency-cruiser@18.2.0 typescript@5.9.3 \
    && npm cache clean --force
# PHP tools: isolated Composer projects + verified phars
COPY docker/php/phpcs /opt/php/phpcs
COPY docker/php/phpcs-standard /opt/php/phpcs-standard
COPY docker/php/phpstan /opt/php/phpstan
COPY docker/php/deptrac /opt/php/deptrac
RUN for t in phpcs phpstan deptrac; do composer install --working-dir=/opt/php/$t --no-dev --no-progress --no-interaction --classmap-authoritative || exit 1; done \
    && mkdir -p /opt/php/bin \
    && ln -s /opt/php/phpcs/vendor/bin/phpcs /opt/php/bin/phpcs \
    && ln -s /opt/php/phpstan/vendor/bin/phpstan /opt/php/bin/phpstan \
    && ln -s /opt/php/deptrac/vendor/bin/deptrac /opt/php/bin/deptrac \
    && curl -fsSL -o /opt/php/bin/composer-unused https://github.com/composer-unused/composer-unused/releases/download/0.9.6/composer-unused.phar \
    && echo "9560e8bd0c3e30ecb0dc6e6348d170c66ac175e715ae58b6e8b302978d5b9dab  /opt/php/bin/composer-unused" | sha256sum -c - \
    && curl -fsSL -o /opt/php/bin/composer-require-checker https://github.com/maglnet/ComposerRequireChecker/releases/download/4.24.0/composer-require-checker.phar \
    && echo "35d1dfdd7aa94a750f4b4c9b0b22dd5e76b5e9e35fb910c8901f3dafd2ad2ab9  /opt/php/bin/composer-require-checker" | sha256sum -c - \
    && chmod +x /opt/php/bin/* && rm -rf /opt/composer-home/cache
# Python tools
COPY docker/python/requirements.txt /opt/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r /opt/requirements.txt
# CLI bundle + grammar assets
COPY --from=builder /build/dist /opt/code-quality/dist
COPY docker/code-quality /usr/local/bin/code-quality
RUN chmod +x /usr/local/bin/code-quality && git config --system safe.directory '*' \
    && mkdir -p /work && chown node:node /work
USER node
WORKDIR /work
ENTRYPOINT ["code-quality"]
CMD ["--help"]
