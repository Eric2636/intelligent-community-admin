import Router from '@koa/router';
import { jwtAuth } from '../middleware/jwt-auth';
import { WechatLoginDto } from '../modules/auth/auth.dto';
import { AuthService } from '../modules/auth/auth.service';
import {
  ClaimErrandDto,
  GetErrandsQueryDto,
  GetMyErrandsQueryDto,
  PublishErrandDto,
  PublishErrandReplyDto,
} from '../modules/errand/errand.dto';
import { ErrandService } from '../modules/errand/errand.service';
import {
  GetForumPostsQueryDto,
  PublishForumPostDto,
  PublishForumReplyDto,
  SetForumReplyReactionDto,
} from '../modules/forum/forum.dto';
import { ForumService } from '../modules/forum/forum.service';
import { MallService } from '../modules/mall/mall.service';
import { SettingsService } from '../modules/settings/settings.service';
import { CreateTaskDto, GetTasksQueryDto, SaveTaskDraftDto } from '../modules/task/task.dto';
import { TaskService } from '../modules/task/task.service';
import { CosCredentialsDto, PresignDto } from '../modules/upload/upload.dto';
import { UploadService } from '../modules/upload/upload.service';
import { UpdateMeDto } from '../modules/user/user.dto';
import { UserService } from '../modules/user/user.service';
import { parseDto } from '../validate';
import { jsonBody } from './json-body';
import { registerAdminRoutes } from './admin.routes';
import { registerMallRoutes } from './mall.routes';
import { AdminService } from '../modules/admin/admin.service';

const adminService = new AdminService();
const authService = new AuthService();
const userService = new UserService();
const taskService = new TaskService();
const errandService = new ErrandService();
const forumService = new ForumService();
const uploadService = new UploadService();
const settingsService = new SettingsService();
const mallService = new MallService();

export function createRouter() {
  const router = new Router();

  router.get('/api/health', (ctx) => {
    ctx.body = { ok: true };
  });

  registerAdminRoutes(router, adminService, settingsService);

  router.post('/api/auth/wechat/login', async (ctx) => {
    const dto = await parseDto(WechatLoginDto, jsonBody(ctx));
    ctx.body = await authService.wechatLogin(dto.code);
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

  // 小区留言（帖子）列表
  router.get('/api/posts', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
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

  router.get('/api/posts/:postId', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
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

  // 跑腿列表
  router.get('/api/errands', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const q = await parseDto(GetErrandsQueryDto, ctx.query);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 10;
    const data = await errandService.listErrands({
      userId,
      page,
      pageSize,
      keyword: q.keyword,
      orderBy: q.orderBy,
    });
    ctx.body = { code: 200, data };
  });

  // 我的跑腿（注意：要放在 /api/errands/:errandId 之前，避免被参数路由吞掉）
  router.get('/api/errands/my', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const q = await parseDto(GetMyErrandsQueryDto, ctx.query);
    const data = await errandService.getMyErrands({ userId, role: q.role });
    ctx.body = { code: 200, data };
  });

  // 跑腿详情
  router.get('/api/errands/:errandId', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const errandId = String((ctx.params as { errandId?: string }).errandId || '').trim();
    const data = await errandService.getErrandDetail({ userId, errandId });
    ctx.body = { code: 200, data };
  });

  // 发布跑腿
  router.post('/api/errands', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const dto = await parseDto(PublishErrandDto, jsonBody(ctx));
    const data = await errandService.publishErrand({
      userId,
      title: dto.title,
      content: dto.content,
      reward: dto.reward,
    });
    ctx.body = { code: 200, data };
  });

  // 领取跑腿
  router.post('/api/errands/:errandId/claim', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const errandId = String((ctx.params as { errandId?: string }).errandId || '').trim();
    const dto = await parseDto(ClaimErrandDto, jsonBody(ctx));
    const data = await errandService.claimErrand({ userId, errandId, claimerName: dto.claimerName });
    ctx.body = { code: 200, data };
  });

  // 发布者确认完成
  router.post('/api/errands/:errandId/complete', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const errandId = String((ctx.params as { errandId?: string }).errandId || '').trim();
    const data = await errandService.completeErrand({ userId, errandId });
    ctx.body = { code: 200, data };
  });

  // 回复
  router.post('/api/errands/:errandId/replies', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const errandId = String((ctx.params as { errandId?: string }).errandId || '').trim();
    const dto = await parseDto(PublishErrandReplyDto, jsonBody(ctx));
    const data = await errandService.publishReply({ userId, errandId, content: dto.content });
    ctx.body = { code: 200, data };
  });

  // 点赞/取消点赞
  router.post('/api/errands/:errandId/like', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const errandId = String((ctx.params as { errandId?: string }).errandId || '').trim();
    ctx.body = { code: 200, data: await errandService.like({ userId, errandId }) };
  });
  router.delete('/api/errands/:errandId/like', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const errandId = String((ctx.params as { errandId?: string }).errandId || '').trim();
    ctx.body = { code: 200, data: await errandService.unlike({ userId, errandId }) };
  });

  // 收藏/取消收藏
  router.post('/api/errands/:errandId/favorite', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const errandId = String((ctx.params as { errandId?: string }).errandId || '').trim();
    ctx.body = { code: 200, data: await errandService.favorite({ userId, errandId }) };
  });
  router.delete('/api/errands/:errandId/favorite', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const errandId = String((ctx.params as { errandId?: string }).errandId || '').trim();
    ctx.body = { code: 200, data: await errandService.unfavorite({ userId, errandId }) };
  });

  router.get('/api/tasks', jwtAuth, async (ctx) => {
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
  router.post('/api/tasks/list', jwtAuth, async (ctx) => {
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

  router.get('/api/tasks/:taskId', jwtAuth, async (ctx) => {
    const taskId = String((ctx.params as { taskId?: string }).taskId || '').trim();
    const data = await taskService.getTaskDetail(taskId);
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

  router.get('/api/files/presign', jwtAuth, async (ctx) => {
    const q = await parseDto(PresignDto, ctx.query);
    ctx.body = await uploadService.presignGetObjectUrl({ key: q.key });
  });

  router.get('/api/app-settings/module-entry-tabs', jwtAuth, async (ctx) => {
    const data = await settingsService.getModuleEntryTabs();
    ctx.body = { code: 200, data };
  });

  registerMallRoutes(router, mallService);

  return router;
}
