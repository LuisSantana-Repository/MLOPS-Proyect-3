FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# AWS publishes this bundle so clients can verify the identity of RDS endpoints.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/aws-rds-global-bundle.pem

RUN chmod +x docker/entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3100

ENTRYPOINT ["docker/entrypoint.sh"]
