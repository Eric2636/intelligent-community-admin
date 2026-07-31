import Router from '@koa/router';
import { prisma } from '../lib/prisma';
import { adminAuth, requireSuperAdmin } from '../middleware/admin-auth';
import { redactPath } from '../modules/api-log/api-log-redaction';
import { CreateSystemNoticeDto } from '../modules/notification/system-notice.dto';
import {
  publishSystemNotice,
  type PublishSystemNoticeInput,
} from '../modules/notification/system-notice.service';
import { parseDto } from '../validate';
import { jsonBody } from './json-body';

export type PublishSystemNotice = (
  input: PublishSystemNoticeInput,
) => Promise<{ noticeId: string; recipientCount: number }>;

export function registerAdminSystemNoticeRoute(
  router: Router,
  publish: PublishSystemNotice = (input) => publishSystemNotice(prisma, input),
) {
  router.post('/api/admin/system-notices', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const dto = await parseDto(CreateSystemNoticeDto, jsonBody(ctx));
    ctx.body = {
      code: 200,
      data: await publish({
        title: dto.title,
        content: dto.content,
        clientRequestId: dto.clientRequestId,
        adminId: ctx.state.admin.adminId,
        adminUsername: ctx.state.admin.username,
        ip: ctx.ip,
        ...(ctx.protocol && ctx.host && (ctx.originalUrl || ctx.url || ctx.path)
          ? { requestUrl: `${ctx.protocol}://${ctx.host}${redactPath(ctx.originalUrl || ctx.url || ctx.path)}` }
          : {}),
      }),
    };
  });
}
