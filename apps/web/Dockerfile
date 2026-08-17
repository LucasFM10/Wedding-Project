FROM node:22-alpine AS build

WORKDIR /app

# Copia os manifestos de dependências
COPY package.json package-lock.json ./

# Instala todas as dependências
RUN npm install

# Copia o código-fonte da aplicação
COPY . .

ARG PUBLIC_POCKETBASE_URL
ENV PUBLIC_POCKETBASE_URL=$PUBLIC_POCKETBASE_URL

RUN npm run build


FROM nginx:stable-alpine

COPY default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]