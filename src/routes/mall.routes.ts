import Router from '@koa/router';
import { jwtAuth } from '../middleware/jwt-auth';
import {
  CreateMallOrderDto,
  GetMallItemsQueryDto,
  PatchMallOrderDto,
  PublishMallItemDto,
} from '../modules/mall/mall.dto';
import { MallService } from '../modules/mall/mall.service';
import { parseDto } from '../validate';
import { jsonBody } from './json-body';
import { CreateMallItemCommentDto } from '../modules/mall/mall-comment.dto';

export function registerMallRoutes(router: Router, mallService: MallService) {
  router.get('/api/categories', jwtAuth, async (ctx) => {
    const data = mallService.listCategories();
    ctx.body = { code: 200, data };
  });

  router.get('/api/items', jwtAuth, async (ctx) => {
    const q = await parseDto(GetMallItemsQueryDto, ctx.query);
    const data = await mallService.listItems({
      categoryId: q.categoryId,
      keyword: q.keyword,
      orderBy: q.orderBy,
    });
    ctx.body = { code: 200, data };
  });

  router.get('/api/items/my', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const data = await mallService.getMyItems({ userId });
    ctx.body = { code: 200, data };
  });

  router.get('/api/items/my-favorites', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const data = await mallService.getMyFavoriteItems({ userId });
    ctx.body = { code: 200, data };
  });

  router.get('/api/items/:itemId', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const itemId = String((ctx.params as { itemId?: string }).itemId || '').trim();
    const data = await mallService.getItemDetail({ userId, itemId });
    ctx.body = { code: 200, data };
  });

  router.post('/api/items', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const dto = await parseDto(PublishMallItemDto, jsonBody(ctx));
    const data = await mallService.publishItem({
      userId,
      categoryId: dto.categoryId,
      title: dto.title,
      price: dto.price,
      unit: dto.unit,
      desc: dto.desc,
      contact: dto.contact,
      mainImages: dto.mainImages,
      subImages: dto.subImages,
      videos: dto.videos,
      images: dto.images,
    });
    ctx.body = { code: 200, data };
  });

  router.post('/api/items/:itemId/favorite', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const itemId = String((ctx.params as { itemId?: string }).itemId || '').trim();
    const data = await mallService.favoriteItem({ userId, itemId });
    ctx.body = { code: 200, data };
  });

  router.delete('/api/items/:itemId/favorite', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const itemId = String((ctx.params as { itemId?: string }).itemId || '').trim();
    const data = await mallService.unfavoriteItem({ userId, itemId });
    ctx.body = { code: 200, data };
  });

  router.post('/api/orders', jwtAuth, async (ctx) => {
    const buyerId = ctx.state.user!.userId;
    const dto = await parseDto(CreateMallOrderDto, jsonBody(ctx));
    const data = await mallService.createOrder({
      buyerId,
      itemId: dto.itemId,
      itemTitle: dto.itemTitle,
      itemPrice: dto.itemPrice,
      itemUnit: dto.itemUnit,
      sellerId: dto.sellerId,
      contact: dto.contact,
    });
    ctx.body = { code: 200, data };
  });

  router.get('/api/orders/my', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const data = await mallService.getMyOrders({ userId });
    ctx.body = { code: 200, data };
  });

  router.get('/api/orders/:orderId', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const orderId = String((ctx.params as { orderId?: string }).orderId || '').trim();
    const data = await mallService.getOrderDetail({ userId, orderId });
    ctx.body = { code: 200, data };
  });

  router.patch('/api/orders/:orderId', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const orderId = String((ctx.params as { orderId?: string }).orderId || '').trim();
    const dto = await parseDto(PatchMallOrderDto, jsonBody(ctx));
    const data = await mallService.updateOrderStatus({ userId, orderId, status: dto.status });
    ctx.body = { code: 200, data };
  });

  // —— 小区市场评论 ——（item comments）
  router.get('/api/items/:itemId/comments', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const itemId = String((ctx.params as { itemId?: string }).itemId || '').trim();
    const data = await mallService.listItemComments({ itemId, userId });
    ctx.body = { code: 200, data };
  });

  router.post('/api/items/:itemId/comments', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const itemId = String((ctx.params as { itemId?: string }).itemId || '').trim();
    const dto = await parseDto(CreateMallItemCommentDto, jsonBody(ctx));
    const data = await mallService.createItemComment({
      itemId,
      userId,
      content: dto.content,
      parentCommentId: dto.parentCommentId,
      images: dto.images,
    });
    ctx.body = { code: 200, data };
  });

  router.delete('/api/items/:itemId/comments/:commentId', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const itemId = String((ctx.params as { itemId?: string }).itemId || '').trim();
    const commentId = String((ctx.params as { commentId?: string }).commentId || '').trim();
    const data = await mallService.deleteItemComment({ itemId, commentId, userId });
    ctx.body = { code: 200, data };
  });

  router.post('/api/items/:itemId/comments/:commentId/like', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const itemId = String((ctx.params as { itemId?: string }).itemId || '').trim();
    const commentId = String((ctx.params as { commentId?: string }).commentId || '').trim();
    const data = await mallService.likeItemComment({ itemId, commentId, userId });
    ctx.body = { code: 200, data };
  });

  router.delete('/api/items/:itemId/comments/:commentId/like', jwtAuth, async (ctx) => {
    const userId = ctx.state.user!.userId;
    const itemId = String((ctx.params as { itemId?: string }).itemId || '').trim();
    const commentId = String((ctx.params as { commentId?: string }).commentId || '').trim();
    const data = await mallService.unlikeItemComment({ itemId, commentId, userId });
    ctx.body = { code: 200, data };
  });
}
