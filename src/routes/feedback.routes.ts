import type Router from '@koa/router';
import { adminAuth } from '../middleware/admin-auth';
import { jwtAuth } from '../middleware/jwt-auth';
import { CreateFeedbackDto, normalizeAdminFeedbackQuery } from '../modules/feedback/feedback.dto';
import { FeedbackService } from '../modules/feedback/feedback.service';
import { parseDto } from '../validate';
import { jsonBody } from './json-body';

export function registerFeedbackRoutes(
  router: Router,
  feedbackService: FeedbackService = new FeedbackService(),
) {
  router.post('/api/feedbacks', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const dto = await parseDto(CreateFeedbackDto, jsonBody(ctx));
    const data = await feedbackService.create({ userId, dto });
    ctx.body = { code: 200, data };
  });

  router.get('/api/admin/feedbacks', adminAuth, async (ctx) => {
    const query = normalizeAdminFeedbackQuery(ctx.query as Record<string, unknown>);
    ctx.body = { code: 200, data: await feedbackService.listAdmin(query) };
  });
}
