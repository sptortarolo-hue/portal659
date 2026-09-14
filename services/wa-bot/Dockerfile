FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.mjs ./
COPY src ./src

ENV PORT=8792
EXPOSE 8792

CMD ["node", "index.mjs"]