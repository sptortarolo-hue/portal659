FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.mjs ./

ENV PORT=8791
EXPOSE 8791

CMD ["node", "index.mjs"]