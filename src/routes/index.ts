import Router from '@koa/router';
import jwt from 'jsonwebtoken';
import { HttpError } from '../http-error';
import { parseMultipartForm } from '../lib/multipart-form';
import { jwtAuth } from '../middleware/jwt-auth';
import { AdminService } from '../modules/admin/admin.service';
import { WechatLoginDto, WechatPhoneLoginDto } from '../modules/auth/auth.dto';
import { AuthService } from '../modules/auth/auth.service';
import { AvatarReviewService } from '../modules/avatar-review/avatar-review.service';
import {
  parseWechatMediaCheckResult,
  verifyWechatCallbackSignature,
} from '../modules/avatar-review/wechat-callback';
import { ReportMiniApiErrorLogDto } from '../modules/client-log/client-log.dto';
import { ClientLogService } from '../modules/client-log/client-log.service';
import {
  GetForumAnnouncementsQueryDto,
  GetForumPostsQueryDto,
  PublishForumPostDto,
  PublishForumReplyDto,
  SetForumReplyReactionDto,
} from '../modules/forum/forum.dto';
import { ForumService } from '../modules/forum/forum.service';
import { MallService } from '../modules/mall/mall.service';
import { SettingsService } from '../modules/settings/settings.service';
import {
  ClaimTaskDto,
  CreateTaskDto,
  GetTasksQueryDto,
  SaveTaskDraftDto,
  SubmitTaskCompleteDto,
} from '../modules/task/task.dto';
import { TaskService } from '../modules/task/task.service';
import { CosCredentialsDto, PresignDto } from '../modules/upload/upload.dto';
import { UploadService } from '../modules/upload/upload.service';
import { UpdateMeDto } from '../modules/user/user.dto';
import { UserService } from '../modules/user/user.service';
import { parseDto } from '../validate';
import { registerAdminRoutes } from './admin.routes';
import { registerFeedbackRoutes } from './feedback.routes';
import { jsonBody } from './json-body';
import { registerMallRoutes } from './mall.routes';
import { registerNotificationRoutes } from './notification.routes';

const adminService = new AdminService();
const authService = new AuthService();
const userService = new UserService();
const taskService = new TaskService();
const forumService = new ForumService();
const uploadService = new UploadService();
const settingsService = new SettingsService();
const mallService = new MallService();
const clientLogService = new ClientLogService();
const avatarReviewService = new AvatarReviewService();
const uploadMaxBytes = Number(process.env.UPLOAD_MAX_BYTES || String(100 * 1024 * 1024));

function tryGetUserFromBearer(auth?: string) {
  if (!auth?.startsWith('Bearer ')) return {};
  const secret = process.env.JWT_SECRET;
  if (!secret) return {};
  try {
    const payload = jwt.verify(auth.slice(7).trim(), secret) as { sub?: string; openid?: string };
    return { userId: payload.sub, openid: payload.openid };
  } catch {
    return {};
  }
}

function queryString(value: unknown) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function verifyContentSecurityCallback(ctx: { query: Record<string, unknown> }) {
  const token = String(process.env.WX_MESSAGE_TOKEN || '').trim();
  if (!token) throw new Error('后端未配置 WX_MESSAGE_TOKEN');
  const valid = verifyWechatCallbackSignature({
    token,
    timestamp: queryString(ctx.query.timestamp),
    nonce: queryString(ctx.query.nonce),
    signature: queryString(ctx.query.signature),
  });
  if (!valid) throw new HttpError(403, '微信回调签名无效');
}

export function createRouter() {
  const router = new Router();

  router.get('/api/health', (ctx) => {
    ctx.body = { ok: true };
  });

  router.get('/api/wechat/content-security/callback', (ctx) => {
    verifyContentSecurityCallback(ctx);
    ctx.type = 'text/plain';
    ctx.body = queryString(ctx.query.echostr);
  });

  router.post('/api/wechat/content-security/callback', async (ctx) => {
    verifyContentSecurityCallback(ctx);
    const result = parseWechatMediaCheckResult(jsonBody(ctx), String(process.env.WX_APPID || '').trim());
    await avatarReviewService.handleResult(result);
    ctx.type = 'text/plain';
    ctx.body = 'success';
  });

  registerAdminRoutes(router, adminService, settingsService, clientLogService);
  registerFeedbackRoutes(router);
  registerNotificationRoutes(router);

  router.post('/api/logs/mini-api-errors', async (ctx) => {
    const dto = await parseDto(ReportMiniApiErrorLogDto, jsonBody(ctx));
    const user = tryGetUserFromBearer(ctx.headers.authorization);
    ctx.body = {
      code: 200,
      data: await clientLogService.reportMiniApiErrorLog({
        ...user,
        ip: ctx.ip,
        dto,
      }),
    };
  });

  router.post('/api/auth/wechat/login', async (ctx) => {
    const dto = await parseDto(WechatLoginDto, jsonBody(ctx));
    ctx.body = await authService.wechatLogin(dto);
  });

  router.post('/api/auth/wechat/phone-login', async (ctx) => {
    const dto = await parseDto(WechatPhoneLoginDto, jsonBody(ctx));
    ctx.body = await authService.wechatPhoneLogin(dto);
  });

  router.get('/api/user/me', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    ctx.body = await userService.getMe(userId);
  });

  router.patch('/api/user/me', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const dto = await parseDto(UpdateMeDto, jsonBody(ctx));
    ctx.body = await userService.updateMe(userId, dto);
  });

  router.get('/api/user/avatar-reviews/:reviewId', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const reviewId = String((ctx.params as { reviewId?: string }).reviewId || '').trim();
    ctx.body = await avatarReviewService.getStatus(userId, reviewId);
  });

  // 小区留言（帖子）列表
  router.get('/api/posts', async (ctx) => {
    const { userId } = tryGetUserFromBearer(ctx.headers.authorization);
    const q = await parseDto(GetForumPostsQueryDto, ctx.query);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 10;
    const data = await forumService.listPosts({
      userId,
      page,
      pageSize,
      keyword: q.keyword,
      orderBy: q.orderBy,
    });
    ctx.body = { code: 200, data };
  });

  router.get('/api/posts/my', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const data = await forumService.getMyPosts({ userId });
    ctx.body = { code: 200, data };
  });

  router.get('/api/posts/my-favorites', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const data = await forumService.getMyFavoritePosts({ userId });
    ctx.body = { code: 200, data };
  });

  router.get('/api/posts/announcements', async (ctx) => {
    const { userId } = tryGetUserFromBearer(ctx.headers.authorization);
    const q = await parseDto(GetForumAnnouncementsQueryDto, ctx.query);
    const data = await forumService.listAnnouncements({ userId, limit: q.limit });
    ctx.body = { code: 200, data };
  });

  router.get('/api/posts/:postId', async (ctx) => {
    const { userId } = tryGetUserFromBearer(ctx.headers.authorization);
    const postId = String((ctx.params as { postId?: string }).postId || '').trim();
    const data = await forumService.getPostDetail({ userId, postId });
    ctx.body = { code: 200, data };
  });

  router.post('/api/posts', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const dto = await parseDto(PublishForumPostDto, jsonBody(ctx));
    const data = await forumService.publishPost({
      userId,
      title: dto.title,
      content: dto.content,
      images: dto.images,
      videos: dto.videos,
    });
    ctx.body = { code: 200, data };
  });

  router.post('/api/posts/:postId/replies', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const postId = String((ctx.params as { postId?: string }).postId || '').trim();
    const dto = await parseDto(PublishForumReplyDto, jsonBody(ctx));
    const data = await forumService.publishReply({
      userId,
      postId,
      parentReplyId: dto.parentReplyId,
      content: dto.content,
      images: dto.images,
      videos: dto.videos,
    });
    ctx.body = { code: 200, data };
  });

  router.post('/api/posts/:postId/replies/:replyId/like', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const postId = String((ctx.params as { postId?: string }).postId || '').trim();
    const replyId = String((ctx.params as { replyId?: string }).replyId || '').trim();
    const data = await forumService.likeReply({ userId, postId, replyId });
    ctx.body = { code: 200, data };
  });
  router.delete('/api/posts/:postId/replies/:replyId/like', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const postId = String((ctx.params as { postId?: string }).postId || '').trim();
    const replyId = String((ctx.params as { replyId?: string }).replyId || '').trim();
    const data = await forumService.unlikeReply({ userId, postId, replyId });
    ctx.body = { code: 200, data };
  });
  router.post('/api/posts/:postId/replies/:replyId/favorite', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const postId = String((ctx.params as { postId?: string }).postId || '').trim();
    const replyId = String((ctx.params as { replyId?: string }).replyId || '').trim();
    const data = await forumService.favoriteReply({ userId, postId, replyId });
    ctx.body = { code: 200, data };
  });
  router.delete('/api/posts/:postId/replies/:replyId/favorite', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const postId = String((ctx.params as { postId?: string }).postId || '').trim();
    const replyId = String((ctx.params as { replyId?: string }).replyId || '').trim();
    const data = await forumService.unfavoriteReply({ userId, postId, replyId });
    ctx.body = { code: 200, data };
  });
  router.post('/api/posts/:postId/replies/:replyId/reaction', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const postId = String((ctx.params as { postId?: string }).postId || '').trim();
    const replyId = String((ctx.params as { replyId?: string }).replyId || '').trim();
    const dto = await parseDto(SetForumReplyReactionDto, jsonBody(ctx));
    const data = await forumService.setReplyReaction({
      userId,
      postId,
      replyId,
      emoji: dto.emoji,
    });
    ctx.body = { code: 200, data };
  });

  router.delete('/api/posts/:postId/replies/:replyId', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const postId = String((ctx.params as { postId?: string }).postId || '').trim();
    const replyId = String((ctx.params as { replyId?: string }).replyId || '').trim();
    const data = await forumService.deleteReply({ userId, postId, replyId });
    ctx.body = { code: 200, data };
  });

  router.delete('/api/posts/:postId', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const postId = String((ctx.params as { postId?: string }).postId || '').trim();
    const data = await forumService.deletePost({ userId, postId });
    ctx.body = { code: 200, data };
  });

  router.post('/api/posts/:postId/like', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const postId = String((ctx.params as { postId?: string }).postId || '').trim();
    ctx.body = { code: 200, data: await forumService.like({ userId, postId }) };
  });
  router.delete('/api/posts/:postId/like', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const postId = String((ctx.params as { postId?: string }).postId || '').trim();
    ctx.body = { code: 200, data: await forumService.unlike({ userId, postId }) };
  });

  router.post('/api/posts/:postId/favorite', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const postId = String((ctx.params as { postId?: string }).postId || '').trim();
    ctx.body = { code: 200, data: await forumService.favorite({ userId, postId }) };
  });
  router.delete('/api/posts/:postId/favorite', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const postId = String((ctx.params as { postId?: string }).postId || '').trim();
    ctx.body = { code: 200, data: await forumService.unfavorite({ userId, postId }) };
  });

  router.post('/api/posts/:postId/share', async (ctx) => {
    const postId = String((ctx.params as { postId?: string }).postId || '').trim();
    ctx.body = { code: 200, data: await forumService.share({ postId }) };
  });

  router.get('/api/tasks', async (ctx) => {
    const q = await parseDto(GetTasksQueryDto, ctx.query);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const data = await taskService.listPendingTasks({
      keyword: q.keyword,
      page,
      pageSize,
    });
    ctx.body = { code: 200, data };
  });

  // 兼容：部分客户端更喜欢用 POST 拉列表（body 传参）
  router.post('/api/tasks/list', async (ctx) => {
    const q = await parseDto(GetTasksQueryDto, jsonBody(ctx));
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const data = await taskService.listPendingTasks({
      keyword: q.keyword,
      page,
      pageSize,
    });
    ctx.body = { code: 200, data };
  });

  router.get('/api/tasks/my', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const type = String((ctx.query as { type?: string }).type || 'published').trim();
    const data = await taskService.getMyTasks({ userId, type });
    ctx.body = { code: 200, data };
  });

  router.get('/api/tasks/:taskId', async (ctx) => {
    const taskId = String((ctx.params as { taskId?: string }).taskId || '').trim();
    const data = await taskService.getTaskDetail(taskId);
    ctx.body = { code: 200, data };
  });

  // 领取任务
  router.post('/api/tasks/:taskId/claim', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const taskId = String((ctx.params as { taskId?: string }).taskId || '').trim();
    const dto = await parseDto(ClaimTaskDto, jsonBody(ctx));
    const data = await taskService.claimTask({ taskId, userId, takerName: dto.takerName });
    ctx.body = { code: 200, data };
  });

  // 接单人提交完成说明
  router.post('/api/tasks/:taskId/submit-complete', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const taskId = String((ctx.params as { taskId?: string }).taskId || '').trim();
    const dto = await parseDto(SubmitTaskCompleteDto, jsonBody(ctx));
    const data = await taskService.submitComplete({
      taskId,
      userId,
      proofText: dto.proofText,
      proofImages: dto.proofImages,
    });
    ctx.body = { code: 200, data };
  });

  // 发布者确认任务完成
  router.post('/api/tasks/:taskId/confirm-complete', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const taskId = String((ctx.params as { taskId?: string }).taskId || '').trim();
    const data = await taskService.confirmComplete({ taskId, userId });
    ctx.body = { code: 200, data };
  });

  // 发布者驳回接单人的完成提交，保留凭证并退回进行中
  router.post('/api/tasks/:taskId/reject-complete', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const taskId = String((ctx.params as { taskId?: string }).taskId || '').trim();
    const data = await taskService.rejectComplete({ taskId, userId });
    ctx.body = { code: 200, data };
  });

  // 保存草稿（新建/更新）
  router.post('/api/tasks/draft', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const dto = await parseDto(SaveTaskDraftDto, jsonBody(ctx));
    const data = await taskService.saveDraft({
      userId,
      taskId: dto.taskId,
      title: dto.title,
      desc: dto.desc,
      reward: dto.reward,
      location: dto.location,
      images: dto.images,
      videos: dto.videos,
    });
    ctx.body = { code: 200, data };
  });

  // 发布草稿
  router.post('/api/tasks/:taskId/publish', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const taskId = String((ctx.params as { taskId?: string }).taskId || '').trim();
    const data = await taskService.publishDraft({ taskId, userId });
    ctx.body = { code: 200, data };
  });

  // 发布者撤销发布（仅待领取且无人领取）
  router.post('/api/tasks/:taskId/revoke', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const taskId = String((ctx.params as { taskId?: string }).taskId || '').trim();
    const data = await taskService.revokePublish({ taskId, userId });
    ctx.body = { code: 200, data };
  });

  // 发布者重新发布（从已撤销恢复到待领取）
  router.post('/api/tasks/:taskId/republish', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const taskId = String((ctx.params as { taskId?: string }).taskId || '').trim();
    const data = await taskService.republish({ taskId, userId });
    ctx.body = { code: 200, data };
  });

  // 删除“未发布/已撤销”的任务（当前模型：已撤销且无人领取）
  router.delete('/api/tasks/:taskId', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const taskId = String((ctx.params as { taskId?: string }).taskId || '').trim();
    ctx.body = { code: 200, data: await taskService.deleteUnpublished({ taskId, userId }) };
  });

  // 接单人放弃任务（回到待领取）
  router.post('/api/tasks/:taskId/abandon', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const taskId = String((ctx.params as { taskId?: string }).taskId || '').trim();
    const data = await taskService.abandonTask({ taskId, userId });
    ctx.body = { code: 200, data };
  });

  router.post('/api/tasks', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const dto = await parseDto(CreateTaskDto, jsonBody(ctx));
    const data = await taskService.createTask({
      publisherId: userId,
      title: dto.title,
      desc: dto.desc,
      reward: dto.reward,
      location: dto.location,
      images: dto.images,
      videos: dto.videos,
    });
    ctx.body = { code: 200, data };
  });

  router.post('/api/upload/cos/credentials', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const dto = await parseDto(CosCredentialsDto, jsonBody(ctx));
    ctx.body = await uploadService.getStsCredentials({
      userId,
      module: dto.module,
      type: dto.type,
    });
  });

  router.post('/api/upload/media', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const form = await parseMultipartForm(ctx.req, ctx.headers['content-type'] || '', {
      maxBytes: uploadMaxBytes,
    });
    const file = form.files.find((x) => x.fieldName === 'file') || form.files[0];
    if (!file) {
      ctx.status = 400;
      ctx.body = { statusCode: 400, message: '缺少上传文件' };
      return;
    }
    const uploaded = await uploadService.uploadMedia({
      userId,
      module: form.fields.module,
      type: form.fields.type,
      filename: file.filename,
      filenameHint: form.fields.filenameHint,
      contentType: file.contentType,
      buffer: file.buffer,
    });
    if (form.fields.module !== 'avatar') {
      ctx.body = uploaded;
      return;
    }
    const avatarReview = await avatarReviewService.submit({
      userId,
      openid: ctx.state.user!.openid,
      mediaUrl: uploaded.url,
    });
    ctx.body = { ...uploaded, avatarReview };
  });

  router.get('/api/files/presign', jwtAuth, async (ctx) => {
    const q = await parseDto(PresignDto, ctx.query);
    ctx.body = await uploadService.presignGetObjectUrl({ key: q.key });
  });

  router.get('/api/app-settings/module-entry-tabs', async (ctx) => {
    const data = await settingsService.getModuleEntryTabs();
    ctx.body = { code: 200, data };
  });

  registerMallRoutes(router, mallService);

  return router;
}
