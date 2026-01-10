#!/bin/bash
set -e

# Путь к файлам Angular
NGINX_ROOT="/usr/share/nginx/html"

# Заменяем API_URL в runtime (если нужно)
if [ ! -z "$API_URL" ]; then
    echo "Setting API_URL to: $API_URL"
    
    # Находим и заменяем в main.js файлах
    find $NGINX_ROOT -type f -name "*.js" -exec sed -i "s|http://localhost:3000|$API_URL|g" {} \;
fi

echo "Starting nginx..."
exec "$@"