FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig*.json vite.config.ts index.html ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
