# Backend Dockerfile
FROM node:18-alpine AS builder

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package файлы
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем исходный код
COPY . .

# Production stage
FROM node:18-alpine

WORKDIR /app

# Создаем пользователя без прав root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# установка curl..долго
RUN apk add --no-cache curl

# Копируем установленные зависимости и код
COPY --from=builder --chown=nodejs:nodejs /app /app

# Переключаемся на непривилегированного пользователя
USER nodejs

# Открываем порт
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/items/available?limit=1', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Запускаем приложение
CMD ["node", "server.js"]