FROM oven/bun:1 AS dependencies-env
COPY package.json bun.lock /app/
WORKDIR /app
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS build-env
COPY . /app/
COPY --from=dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN bun run build

FROM oven/bun:1
COPY package.json bun.lock /app/
COPY --from=dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
COPY server/ /app/server/
WORKDIR /app
ENV NODE_ENV=production
CMD ["bun", "server/index.ts"]
