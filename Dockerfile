FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN addgroup -S nodejs -g 1001 && adduser -S nodejs -u 1001 -G nodejs
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
RUN mkdir -p /app/data && chown -R nodejs:nodejs /app
COPY --chown=nodejs:nodejs . .
USER nodejs
ENV NODE_ENV=production PORT=3000 DB_PATH=/app/data/reentry.db
EXPOSE 3000
CMD ["node", "server.js"]
