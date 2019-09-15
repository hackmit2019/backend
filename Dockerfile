FROM node:current-stretch-slim
RUN mkdir -p app
WORKDIR app
ADD package.json .
ADD package-lock.json .
RUN npm install
RUN mkdir -p src
ADD src src/
CMD ["node", "src/index.js"]
