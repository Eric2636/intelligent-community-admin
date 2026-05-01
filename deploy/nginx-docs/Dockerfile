# Nginx + Swagger UI 静态页；OpenAPI 与 /api 反代到 node 容器
FROM node:22-bookworm-slim AS ui
WORKDIR /ui
RUN npm install swagger-ui-dist@5.17.14 --no-save

FROM nginx:1.27-alpine
COPY --from=ui /ui/node_modules/swagger-ui-dist /usr/share/nginx/html
COPY index.html /usr/share/nginx/html/index.html
RUN rm -f /etc/nginx/conf.d/default.conf
COPY default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
