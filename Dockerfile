FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# prisma generate only needs the config to load; the real URL is supplied at runtime.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate && npm run build
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
