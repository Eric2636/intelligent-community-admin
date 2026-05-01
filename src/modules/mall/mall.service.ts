import { MallFavoriteService } from './mall-favorite.service';
import { MallItemService } from './mall-item.service';
import { MallOrderService } from './mall-order.service';
import { MallCommentService } from './mall-comment.service';

/**
 * 小区市场聚合入口，对外保持与原 MallService 相同的方法签名，便于路由与其它模块调用。
 */
export class MallService {
  private readonly items = new MallItemService();
  private readonly favorites = new MallFavoriteService();
  private readonly orders = new MallOrderService();
  private readonly comments = new MallCommentService();

  listCategories() {
    return this.items.listCategories();
  }

  listItems(params: Parameters<MallItemService['listItems']>[0]) {
    return this.items.listItems(params);
  }

  getItemDetail(params: Parameters<MallItemService['getItemDetail']>[0]) {
    return this.items.getItemDetail(params);
  }

  publishItem(params: Parameters<MallItemService['publishItem']>[0]) {
    return this.items.publishItem(params);
  }

  getMyItems(params: Parameters<MallItemService['getMyItems']>[0]) {
    return this.items.getMyItems(params);
  }

  favoriteItem(params: Parameters<MallFavoriteService['favoriteItem']>[0]) {
    return this.favorites.favoriteItem(params);
  }

  unfavoriteItem(params: Parameters<MallFavoriteService['unfavoriteItem']>[0]) {
    return this.favorites.unfavoriteItem(params);
  }

  getMyFavoriteItems(params: Parameters<MallFavoriteService['getMyFavoriteItems']>[0]) {
    return this.favorites.getMyFavoriteItems(params);
  }

  createOrder(params: Parameters<MallOrderService['createOrder']>[0]) {
    return this.orders.createOrder(params);
  }

  getMyOrders(params: Parameters<MallOrderService['getMyOrders']>[0]) {
    return this.orders.getMyOrders(params);
  }

  getOrderDetail(params: Parameters<MallOrderService['getOrderDetail']>[0]) {
    return this.orders.getOrderDetail(params);
  }

  updateOrderStatus(params: Parameters<MallOrderService['updateOrderStatus']>[0]) {
    return this.orders.updateOrderStatus(params);
  }

  listItemComments(params: Parameters<MallCommentService['listItemComments']>[0]) {
    return this.comments.listItemComments(params);
  }

  createItemComment(params: Parameters<MallCommentService['createItemComment']>[0]) {
    return this.comments.createItemComment(params);
  }

  deleteItemComment(params: Parameters<MallCommentService['deleteItemComment']>[0]) {
    return this.comments.deleteItemComment(params);
  }

  likeItemComment(params: Parameters<MallCommentService['likeItemComment']>[0]) {
    return this.comments.likeItemComment(params);
  }

  unlikeItemComment(params: Parameters<MallCommentService['unlikeItemComment']>[0]) {
    return this.comments.unlikeItemComment(params);
  }
}
