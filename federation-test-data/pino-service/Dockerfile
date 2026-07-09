FROM public.ecr.aws/docker/library/node:20-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY app.js ./

# Unbuffered stdout so log lines reach the awslogs driver promptly.
ENV NODE_ENV=production
CMD ["node", "app.js"]
