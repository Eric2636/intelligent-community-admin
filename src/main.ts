import 'reflect-metadata';
import './load-env';
import cors from '@koa/cors';
import Koa = require('koa');
import bodyParser from 'koa-bodyparser';
import { koaSwagger } from 'koa2-swagger-ui';
import { prisma } from './lib/prisma';
import { errorHandler } from './middleware/error-handler';
import { AdminService } from './modules/admin/admin.service';
import { createRouter } from './routes';
import { openApiDocument } from './swagger/openapi';

async function bootstrap() {
  await prisma.$connect();
  await new AdminService().ensureDefaultSuperAdmin();

  const app = new Koa();
  app.use(errorHandler);
  app.use(cors());
  app.use(bodyParser());
  app.use(
    koaSwagger({
      title: '智慧社区管理端 API',
      routePrefix: '/api-docs',
      exposeSpec: true,
      specPrefix: '/api-docs/openapi.json',
      swaggerOptions: {
        spec: openApiDocument,
        url: '',
      },
    }),
  );
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
