FROM node:22-slim

RUN npm install -g bun

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install

COPY . .

EXPOSE 5173
