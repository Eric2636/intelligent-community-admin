import 'reflect-metadata';
import './load-env';
import cors from '@koa/cors';
import Koa = require('koa');
import bodyParser from 'koa-bodyparser';
import { koaSwagger } from 'koa2-swagger-ui';
import { prisma } from './lib/prisma';
import { adminMutationAudit } from './middleware/admin-mutation-audit';
import { apiAccessLog } from './middleware/api-access-log';
import { errorHandler } from './middleware/error-handler';
import { AdminService } from './modules/admin/admin.service';
import { syncRegisteredApiEndpoints } from './modules/api-log/api-endpoint.service';
import { validateDefaultAvatarConfiguration } from './modules/user/default-avatar';
import { createRouter } from './routes';
import { openApiDocument } from './swagger/openapi';

function hostFromDatabaseUrl(value?: string) {
  if (!value) return '(unset)';
  try {
    return new URL(value).hostname || '(unknown)';
  } catch {
    return '(invalid)';
  }
}

function logRuntimeEnvironment() {
  console.log('[env]', {
    appEnv: process.env.APP_ENV || 'development',
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT || '3000',
    databaseHost: hostFromDatabaseUrl(process.env.DATABASE_URL),
    redisHost: process.env.REDIS_HOST || '(disabled)',
    redisDb: process.env.REDIS_DB || '0',
    cosBucket: process.env.COS_BUCKET || '(unset)',
    cosRegion: process.env.COS_REGION || '(unset)',
    cosEnvPrefix: process.env.COS_ENV_PREFIX || 'test',
  });
}

async function bootstrap() {
  validateDefaultAvatarConfiguration(process.env.APP_ENV, process.env.DEFAULT_AVATAR_URL);
  logRuntimeEnvironment();
  await prisma.$connect();
  await new AdminService().ensureDefaultSuperAdmin();

  const app = new Koa();
  // Keep this outermost so it observes both normal responses and errors handled
  // by the shared error handler, without changing the response on log failure.
  app.use(apiAccessLog);
  app.use(errorHandler);
  app.use(cors());
  app.use(bodyParser());
  app.use(adminMutationAudit);
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
    void syncRegisteredApiEndpoints(router).then((result) => {
      console.info('[api-endpoint-sync]', result);
    });
  });
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
