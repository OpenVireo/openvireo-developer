# developer.openvireo.com: built with Astro + Starlight and served as static files by nginx. The docs under
# src/content/docs and the TypeDoc output in public/sdk/api are committed (npm run sync), so this needs no
# checkouts of the source repos.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . ./
RUN npm run build

FROM nginx:1.27-bookworm
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
# Strict-Transport-Security value for every response, set at run time; empty sends none
ENV HSTS=""
EXPOSE 8080
