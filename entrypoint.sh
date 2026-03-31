#!/bin/bash
set -e

# If no external MONGO_URL is provided, start the internal mongod
if [ -z "$MONGO_URL" ]; then
  echo "[entrypoint] No MONGO_URL set — starting internal MongoDB..."
  mkdir -p /data/db
  mongod --fork --logpath /var/log/mongod.log --dbpath /data/db --bind_ip 127.0.0.1

  echo "[entrypoint] Waiting for MongoDB to accept connections..."
  until mongosh --quiet --eval "db.adminCommand('ping')" > /dev/null 2>&1; do
    sleep 0.5
  done
  echo "[entrypoint] MongoDB is ready."

  export MONGO_URL="mongodb://127.0.0.1:27017/edalerts"
fi

echo "[entrypoint] Starting services with pm2..."
exec pm2-runtime /app/pm2.config.js
