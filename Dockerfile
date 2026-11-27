# Finantia 2.0: servidor de pruebas (sin Microsoft 365, todo el sitio detrás de una clave).
#   docker build -t finantia .
#   docker run -p 3000:3000 -e FINANTIA_CLAVE_PRUEBAS=... -v finantia-datos:/datos finantia
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY motor ./motor
COPY servidor ./servidor
COPY web ./web
COPY datos ./datos
ENV NODE_ENV=production FINANTIA_MODO_PRUEBAS=1 FINANTIA_DIR_DATOS=/datos PORT=3000
RUN mkdir -p /datos && chown node:node /datos
VOLUME /datos
EXPOSE 3000
USER node
CMD ["node", "servidor/web/iniciar.js"]
