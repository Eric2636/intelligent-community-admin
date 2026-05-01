import 'reflect-metadata';
import './load-env';
import cors from '@koa/cors';
import Koa = require('koa');
import bodyParser from 'koa-bodyparser';
import { prisma } from './lib/prisma';
import { errorHandler } from './middleware/error-handler';
import { createRouter } from './routes';

async function bootstrap() {
  await prisma.$connect();

  const app = new Koa();
  app.use(errorHandler);
  app.use(cors());
  app.use(bodyParser());
  const router = createRouter();
  app.use(router.routes());
  app.use(router.allowedMethods());

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Listening on http://0.0.0.0:${port}`);
  });
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
