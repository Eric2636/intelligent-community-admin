/**
 * OpenAPI 3.0 文档（供 Swagger UI 展示）。与 `routes/index.ts`、`routes/mall.routes.ts` 对齐。
 */
export const openApiDocument: Record<string, unknown> = {
  openapi: '3.0.3',
  info: {
    title: '智慧社区管理端 API',
    description:
      '与 intelligent-community 小程序配套的后端接口。健康检查、微信登录、公开模块配置、论坛公开列表/详情、任务公开列表/详情及小区市场公开查询支持游客访问；论坛和市场公开查询携带有效 Bearer token 时会附带当前用户的互动状态。其余接口按各路径的 security 声明鉴权。',
    version: '0.1.0',
  },
  servers: [{ url: '/', description: '当前服务' }],
  tags: [
    { name: 'Health', description: '健康检查' },
    { name: 'Auth', description: '认证' },
    { name: 'User', description: '用户资料' },
    { name: 'Feedback', description: '意见反馈' },
    { name: 'Notification', description: '消息通知' },
    { name: 'Forum', description: '小区留言（帖子）' },
    { name: 'Task', description: '任务' },
    { name: 'Upload', description: '上传与文件' },
    { name: 'Settings', description: '应用设置' },
    { name: 'Mall', description: '小区市场' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '微信登录接口返回的 token',
      },
      adminBearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '管理端登录接口返回的 Bearer token',
      },
    },
    parameters: {
      Page: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      PageSize: { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      ApiLogFilters: {
        name: 'filters', in: 'query', description: 'IP、endpointId、method、source、httpStatus/statusClass、startAt/endAt、actorId、minDurationMs/maxDurationMs；实际请求可展开为同名查询参数',
        schema: { type: 'string' },
      },
    },
    schemas: {
      HealthResponse: {
        type: 'object',
        properties: { ok: { type: 'boolean', example: true } },
      },
      WechatLoginBody: {
        type: 'object',
        required: ['code'],
        properties: { code: { type: 'string', minLength: 1, description: 'wx.login 临时 code' } },
      },
      UpdateMeBody: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          avatar: { type: 'string' },
          gender: { type: 'integer', minimum: 0, maximum: 2 },
          birth: { type: 'string' },
          address: { type: 'array', items: {} },
          photos: { type: 'array', items: {} },
          brief: { type: 'string' },
        },
      },
      PublishForumPostBody: {
        type: 'object',
        required: ['title', 'content'],
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          images: { type: 'array', items: { type: 'string' } },
          videos: { type: 'array', items: { type: 'string' } },
          authorName: { type: 'string' },
        },
      },
      PublishForumReplyBody: {
        type: 'object',
        required: ['content'],
        properties: {
          parentReplyId: { type: 'string' },
          content: { type: 'string' },
          images: { type: 'array', items: { type: 'string' } },
          videos: { type: 'array', items: { type: 'string' } },
          authorName: { type: 'string' },
        },
      },
      SetForumReplyReactionBody: {
        type: 'object',
        properties: {
          emoji: {
            type: 'string',
            maxLength: 32,
            description: '传空字符串或省略表示取消表情',
          },
        },
      },
      TasksQuery: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 50, default: 50 },
        },
      },
      CreateTaskBody: {
        type: 'object',
        required: ['title', 'desc', 'location'],
        properties: {
          title: { type: 'string' },
          desc: { type: 'string' },
          reward: { type: 'string' },
          location: { type: 'string' },
          images: { type: 'array', items: { type: 'string' } },
          videos: { type: 'array', items: { type: 'string' } },
        },
      },
      SaveTaskDraftBody: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          title: { type: 'string' },
          desc: { type: 'string' },
          reward: { type: 'string' },
          location: { type: 'string' },
          images: { type: 'array', items: { type: 'string' } },
          videos: { type: 'array', items: { type: 'string' } },
        },
      },
      CosCredentialsBody: {
        type: 'object',
        required: ['module'],
        properties: {
          module: {
            type: 'string',
            enum: ['forum', 'task', 'mall', 'avatar'],
          },
          type: { type: 'string', enum: ['img', 'vid'] },
        },
      },
      PublishMallItemBody: {
        type: 'object',
        required: ['categoryId', 'title'],
        properties: {
          categoryId: { type: 'string', minLength: 1, maxLength: 200 },
          title: { type: 'string', minLength: 1, maxLength: 200 },
          price: { type: 'string', maxLength: 64 },
          unit: { type: 'string', maxLength: 16 },
          desc: { type: 'string', maxLength: 8000 },
          contact: { type: 'string', maxLength: 500 },
          mainImages: { type: 'array', maxItems: 1, items: { type: 'string' }, description: '列表主图，仅 1 张' },
          subImages: { type: 'array', items: { type: 'string' } },
          videos: { type: 'array', items: { type: 'string' } },
          images: { type: 'array', items: { type: 'string' }, description: '兼容旧字段' },
        },
      },
      UpdateMallItemBody: {
        type: 'object',
        additionalProperties: false,
        properties: {
          categoryId: { type: 'string', minLength: 1, maxLength: 200 },
          title: { type: 'string', minLength: 1, maxLength: 200 },
          price: { type: ['string', 'null'], maxLength: 64 },
          unit: { type: 'string', maxLength: 16 },
          desc: { type: 'string', maxLength: 8000 },
          contact: { type: ['string', 'null'], maxLength: 500 },
          locationName: { type: ['string', 'null'], maxLength: 200 },
          locationAddress: { type: ['string', 'null'], maxLength: 500 },
          latitude: { type: ['number', 'null'] },
          longitude: { type: ['number', 'null'] },
          mainImages: { type: 'array', maxItems: 1, items: { type: 'string' } },
          subImages: { type: 'array', maxItems: 6, items: { type: 'string' } },
          videos: { type: 'array', maxItems: 2, items: { type: 'string' } },
        },
      },
      PatchMallItemVisibilityBody: {
        type: 'object',
        required: ['visibility'],
        additionalProperties: false,
        properties: {
          visibility: { type: 'string', enum: ['ONLINE', 'OFFLINE'] },
        },
      },
      CreateMallOrderBody: {
        type: 'object',
        required: ['itemId', 'clientRequestId'],
        additionalProperties: false,
        properties: {
          itemId: { type: 'string', minLength: 1 },
          clientRequestId: {
            type: 'string',
            minLength: 16,
            maxLength: 64,
            pattern: '^[A-Za-z0-9_-]+$',
            description: '一次用户下单意图的稳定幂等键；失败重试复用，成功后新意图重新生成',
          },
          buyerContact: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
      PatchMallOrderBody: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['completed', 'cancelled'] },
        },
      },
      CreateMallItemCommentBody: {
        type: 'object',
        properties: {
          content: { type: 'string', maxLength: 1000 },
          parentCommentId: { type: 'string', maxLength: 64 },
          images: { type: 'array', items: { type: 'string' } },
        },
      },
      CreateFeedbackBody: {
        type: 'object',
        description: '反馈内容最多 500 Unicode code points；组合字符按其实际 code point 数量计算。',
        required: ['content'],
        additionalProperties: false,
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
      CreateSystemNoticeBody: {
        type: 'object',
        description: '仅超级管理员可发布。clientRequestId 用于安全重试，同一发布意图必须保持不变。',
        required: ['title', 'content', 'clientRequestId'],
        additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 191 },
          content: {
            type: 'string',
            minLength: 1,
            description: '纯文本，UTF-8 编码后最多 65535 字节',
          },
          clientRequestId: {
            type: 'string',
            minLength: 16,
            maxLength: 64,
            pattern: '^[A-Za-z0-9_-]+$',
          },
        },
      },
      PublishSystemNoticeResponse: {
        type: 'object',
        required: ['code', 'data'],
        properties: {
          code: { type: 'integer', example: 200 },
          data: {
            type: 'object',
            required: ['noticeId', 'recipientCount'],
            properties: {
              noticeId: { type: 'string', minLength: 16, maxLength: 64 },
              recipientCount: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
      NotificationItem: {
        type: 'object',
        required: [
          'id',
          'recipientId',
          'actorId',
          'type',
          'bizType',
          'bizId',
          'title',
          'content',
          'readAt',
          'createdAt',
        ],
        properties: {
          id: { type: 'string' },
          recipientId: { type: 'string' },
          actorId: { type: 'string', nullable: true },
          type: { type: 'string', description: '具体事件类型' },
          bizType: { type: 'string', enum: ['forum', 'task', 'mall', 'system'] },
          bizId: { type: 'string', nullable: true },
          title: { type: 'string' },
          content: { type: 'string' },
          readAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      NotificationListData: {
        type: 'object',
        required: ['list', 'total', 'page', 'pageSize'],
        properties: {
          list: { type: 'array', items: { $ref: '#/components/schemas/NotificationItem' } },
          total: { type: 'integer', minimum: 0 },
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
      NotificationListResponse: {
        type: 'object',
        required: ['code', 'data'],
        properties: {
          code: { type: 'integer', example: 200 },
          data: { $ref: '#/components/schemas/NotificationListData' },
        },
      },
      NotificationCountResponse: {
        type: 'object',
        required: ['code', 'data'],
        properties: {
          code: { type: 'integer', example: 200 },
          data: {
            type: 'object',
            required: ['count'],
            properties: { count: { type: 'integer', minimum: 0 } },
          },
        },
      },
      EmptySuccessResponse: {
        type: 'object',
        required: ['code', 'data'],
        properties: {
          code: { type: 'integer', example: 200 },
          data: { type: 'object', additionalProperties: false },
        },
      },
      JsonSuccess: {
        type: 'object',
        properties: {
          code: { type: 'integer', example: 200 },
          data: { description: '业务载荷' },
        },
      },
      JsonUnknown: { type: 'object', additionalProperties: true },
    },
  },
  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: '健康检查',
        responses: {
          '200': {
            description: '服务正常',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } },
            },
          },
        },
      },
    },
    '/api/auth/wechat/login': {
      post: {
        tags: ['Auth'],
        summary: '微信登录',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/WechatLoginBody' } },
          },
        },
        responses: {
          '200': {
            description: '登录成功（含 token 等，结构以实际返回为准）',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonUnknown' } } },
          },
        },
      },
    },
    '/api/user/me': {
      get: {
        tags: ['User'],
        summary: '当前用户资料',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonUnknown' } } },
          },
        },
      },
      patch: {
        tags: ['User'],
        summary: '更新当前用户资料',
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/UpdateMeBody' } },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonUnknown' } } },
          },
        },
      },
    },
    '/api/feedbacks': {
      post: {
        tags: ['Feedback'],
        summary: '提交意见反馈',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateFeedbackBody' } },
          },
        },
        responses: {
          '200': {
            description: '提交成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/admin/feedbacks': {
      get: {
        tags: ['Feedback'],
        summary: '后台分页查询意见反馈',
        description: '超级管理员和平台管理员均可访问；关键词同时匹配用户昵称和反馈内容。',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          {
            name: 'pageSize',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
          { name: 'keyword', in: 'query', schema: { type: 'string' } },
          {
            name: 'identity',
            in: 'query',
            schema: { type: 'string', enum: ['OWNER', 'OUTSIDER'] },
          },
          { name: 'startAt', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'endAt', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: {
          '200': {
            description: '意见反馈分页结果',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonUnknown' } } },
          },
          '400': { description: '查询参数错误' },
          '401': { description: '管理员未登录或 token 无效' },
        },
      },
    },
    '/api/notifications': {
      get: {
        tags: ['Notification'],
        summary: '分页查询我的通知',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 20001, default: 1 },
          },
          {
            name: 'pageSize',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        ],
        responses: {
          '200': {
            description: '通知分页结果',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/NotificationListResponse' },
              },
            },
          },
          '400': { description: '分页参数错误' },
          '401': { description: '未登录或 token 无效' },
        },
      },
    },
    '/api/notifications/unread-count': {
      get: {
        tags: ['Notification'],
        summary: '查询我的未读通知数量',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: '未读数量；已软删除通知不计入',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/NotificationCountResponse' },
              },
            },
          },
          '401': { description: '未登录或 token 无效' },
        },
      },
    },
    '/api/notifications/read-all': {
      patch: {
        tags: ['Notification'],
        summary: '将我的全部可见通知标为已读',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: '标记成功',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EmptySuccessResponse' },
              },
            },
          },
          '401': { description: '未登录或 token 无效' },
        },
      },
    },
    '/api/notifications/{id}/read': {
      patch: {
        tags: ['Notification'],
        summary: '将我的一条通知标为已读',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: '标记成功；重复标记保持幂等',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/EmptySuccessResponse' } },
            },
          },
          '401': { description: '未登录或 token 无效' },
          '404': { description: '通知不存在、已删除或不属于当前用户' },
        },
      },
    },
    '/api/notifications/{id}': {
      delete: {
        tags: ['Notification'],
        summary: '删除我的一条通知',
        description: '执行软删除，不物理移除数据库记录。',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: '软删除成功',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/EmptySuccessResponse' } },
            },
          },
          '401': { description: '未登录或 token 无效' },
          '404': { description: '通知不存在、已删除或不属于当前用户' },
        },
      },
    },
    '/api/posts': {
      get: {
        tags: ['Forum'],
        summary: '帖子列表',
        description: '游客可访问；携带有效 Bearer token 时返回当前用户的点赞、收藏等互动状态。',
        security: [{}, { bearerAuth: [] }],
        parameters: [
          { name: 'keyword', in: 'query', schema: { type: 'string' } },
          { name: 'orderBy', in: 'query', schema: { type: 'string', enum: ['time', 'hot'] } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      post: {
        tags: ['Forum'],
        summary: '发布帖子',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PublishForumPostBody' } },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/posts/my': {
      get: {
        tags: ['Forum'],
        summary: '我的帖子',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/posts/my-favorites': {
      get: {
        tags: ['Forum'],
        summary: '我收藏的帖子',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/posts/{postId}': {
      get: {
        tags: ['Forum'],
        summary: '帖子详情',
        description: '游客可访问；携带有效 Bearer token 时返回当前用户的点赞、收藏等互动状态。',
        security: [{}, { bearerAuth: [] }],
        parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      delete: {
        tags: ['Forum'],
        summary: '删除帖子',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/posts/{postId}/replies': {
      post: {
        tags: ['Forum'],
        summary: '发表回复',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PublishForumReplyBody' } },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/posts/{postId}/replies/{replyId}/like': {
      post: {
        tags: ['Forum'],
        summary: '点赞回复',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'postId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'replyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      delete: {
        tags: ['Forum'],
        summary: '取消点赞回复',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'postId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'replyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/posts/{postId}/replies/{replyId}/favorite': {
      post: {
        tags: ['Forum'],
        summary: '收藏回复',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'postId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'replyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      delete: {
        tags: ['Forum'],
        summary: '取消收藏回复',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'postId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'replyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/posts/{postId}/replies/{replyId}/reaction': {
      post: {
        tags: ['Forum'],
        summary: '设置回复表情反应',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'postId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'replyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SetForumReplyReactionBody' } },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/posts/{postId}/replies/{replyId}': {
      delete: {
        tags: ['Forum'],
        summary: '删除回复',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'postId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'replyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/posts/{postId}/like': {
      post: {
        tags: ['Forum'],
        summary: '点赞帖子',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      delete: {
        tags: ['Forum'],
        summary: '取消点赞帖子',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/posts/{postId}/favorite': {
      post: {
        tags: ['Forum'],
        summary: '收藏帖子',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      delete: {
        tags: ['Forum'],
        summary: '取消收藏帖子',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'postId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/tasks': {
      get: {
        tags: ['Task'],
        summary: '待领取任务列表',
        description: '公开查询，无需登录。',
        parameters: [
          { name: 'keyword', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      post: {
        tags: ['Task'],
        summary: '创建并发布任务',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateTaskBody' } },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/tasks/list': {
      post: {
        tags: ['Task'],
        summary: '待领取任务列表（POST，body 传参）',
        description: '公开查询的兼容入口，无需登录。',
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/TasksQuery' } },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/tasks/{taskId}': {
      get: {
        tags: ['Task'],
        summary: '任务详情',
        description: '公开查询，无需登录。',
        parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      delete: {
        tags: ['Task'],
        summary: '删除未发布/已撤销任务',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
          '409': { description: '任务已被其他请求更新' },
        },
      },
    },
    '/api/tasks/draft': {
      post: {
        tags: ['Task'],
        summary: '保存任务草稿',
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SaveTaskDraftBody' } },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
          '409': { description: '任务已被其他请求更新' },
        },
      },
    },
    '/api/tasks/{taskId}/publish': {
      post: {
        tags: ['Task'],
        summary: '发布草稿',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
          '409': { description: '任务已被其他请求更新' },
        },
      },
    },
    '/api/tasks/{taskId}/claim': {
      post: {
        tags: ['Task'],
        summary: '领取任务',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: '领取成功并通知发布者',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
          '409': { description: '任务已被其他请求更新' },
        },
      },
    },
    '/api/tasks/{taskId}/submit-complete': {
      post: {
        tags: ['Task'],
        summary: '接单人提交完成凭证',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  proofText: { type: 'string' },
                  proofImages: { type: 'array', items: { type: 'string', format: 'uri' } },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: '提交成功并通知发布者',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
          '409': { description: '任务已被其他请求更新' },
        },
      },
    },
    '/api/tasks/{taskId}/confirm-complete': {
      post: {
        tags: ['Task'],
        summary: '发布者确认任务完成',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: '确认成功并通知接单人',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
          '409': { description: '任务已被其他请求更新' },
        },
      },
    },
    '/api/tasks/{taskId}/reject-complete': {
      post: {
        tags: ['Task'],
        summary: '发布者驳回完成提交',
        description: '仅待确认状态可操作；退回进行中，保留上次完成说明、图片和提交时间，接单人可重新提交。',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: '驳回成功并通知接单人',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
          '409': { description: '任务已被其他请求更新' },
        },
      },
    },
    '/api/tasks/{taskId}/revoke': {
      post: {
        tags: ['Task'],
        summary: '发布者取消未结束任务',
        description: '支持待领取、进行中和待确认状态；存在接单人时会保留双方快照并通知接单人。',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
          '409': { description: '任务已被其他请求更新' },
        },
      },
    },
    '/api/tasks/{taskId}/republish': {
      post: {
        tags: ['Task'],
        summary: '重新发布（从已撤销恢复）',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
          '409': { description: '任务已被其他请求更新' },
        },
      },
    },
    '/api/tasks/{taskId}/abandon': {
      post: {
        tags: ['Task'],
        summary: '接单人放弃任务',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
          '409': { description: '任务已被其他请求更新' },
        },
      },
    },
    '/api/upload/cos/credentials': {
      post: {
        tags: ['Upload'],
        summary: '获取 COS 临时凭证',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CosCredentialsBody' } },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonUnknown' } } },
          },
        },
      },
    },
    '/api/files/presign': {
      get: {
        tags: ['Upload'],
        summary: '对象存储文件预签名访问 URL',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'key', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonUnknown' } } },
          },
        },
      },
    },
    '/api/app-settings/module-entry-tabs': {
      get: {
        tags: ['Settings'],
        summary: '首页模块入口 Tab 配置',
        description: '小程序启动时读取的公开配置，无需登录。',
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/admin/app-settings/module-entry-tabs': {
      get: {
        tags: ['Settings'],
        summary: '（超管）小程序模块入口开关列表',
        description: '管理端 JWT（ADMIN_JWT_SECRET），需超级管理员',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/admin/system-notices': {
      post: {
        tags: ['Notification'],
        summary: '（超管）向全部已启用用户发布系统通知',
        description:
          '使用管理端 Bearer JWT，且仅超级管理员可调用。相同 clientRequestId、管理员及内容的重试返回首次发布结果，不会重复发送；请求标识冲突返回 409。',
        security: [{ adminBearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateSystemNoticeBody' },
            },
          },
        },
        responses: {
          '200': {
            description: '发布成功，或返回同一幂等请求的既有发布结果',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PublishSystemNoticeResponse' },
              },
            },
          },
          '400': { description: '请求字段、长度或纯文本内容不合法' },
          '401': { description: '管理端身份未认证或令牌无效' },
          '403': { description: '当前管理员不是超级管理员' },
          '409': { description: 'clientRequestId 已被其他管理员或不同内容使用' },
          '500': { description: '发布事务失败，未提交任何通知或操作日志' },
        },
      },
    },
    '/api/admin/app-settings/module-entry-tabs/{key}': {
      patch: {
        tags: ['Settings'],
        summary: '（超管）更新某模块是否在小程序展示',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'key',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'mall' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['enabled'],
                properties: { enabled: { type: 'boolean' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/categories': {
      get: {
        tags: ['Mall'],
        summary: '市场分类列表',
        description: '游客可访问；携带有效 Bearer token 时按登录用户处理。',
        security: [{}, { bearerAuth: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/items': {
      get: {
        tags: ['Mall'],
        summary: '商品列表',
        description: '游客仅查询未删除且已上架的商品；携带有效 Bearer token 时返回当前用户的收藏状态。',
        security: [{}, { bearerAuth: [] }],
        parameters: [
          { name: 'categoryId', in: 'query', schema: { type: 'string' } },
          { name: 'keyword', in: 'query', schema: { type: 'string' } },
          {
            name: 'orderBy',
            in: 'query',
            schema: { type: 'string', enum: ['time', 'price_asc', 'price_desc'] },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      post: {
        tags: ['Mall'],
        summary: '发布商品',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PublishMallItemBody' } },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/items/my': {
      get: {
        tags: ['Mall'],
        summary: '我的商品',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/items/my-favorites': {
      get: {
        tags: ['Mall'],
        summary: '我收藏的商品',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/items/{itemId}': {
      get: {
        tags: ['Mall'],
        summary: '商品详情',
        description:
          '游客可查看未删除且已上架的商品；未上架商品仅发布者携带有效 Bearer token 时可查看，其他情况按不存在返回。',
        security: [{}, { bearerAuth: [] }],
        parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      patch: {
        tags: ['Mall'],
        summary: '编辑自己发布的市场信息',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/UpdateMallItemBody' } },
          },
        },
        responses: {
          '200': { description: 'OK' },
          '403': { description: '只能编辑自己发布的信息' },
          '404': { description: '信息不存在或已删除' },
        },
      },
      delete: {
        tags: ['Mall'],
        summary: '删除自己发布的市场信息（软删除）',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'OK' },
          '403': { description: '只能删除自己发布的信息' },
          '404': { description: '信息不存在或已删除' },
        },
      },
    },
    '/api/items/{itemId}/visibility': {
      patch: {
        tags: ['Mall'],
        summary: '公开或隐藏自己发布的市场信息',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PatchMallItemVisibilityBody' } },
          },
        },
        responses: {
          '200': { description: 'OK' },
          '403': { description: '只能操作自己发布的信息' },
          '404': { description: '信息不存在或已删除' },
        },
      },
    },
    '/api/items/{itemId}/favorite': {
      post: {
        tags: ['Mall'],
        summary: '收藏商品',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      delete: {
        tags: ['Mall'],
        summary: '取消收藏商品',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/orders': {
      post: {
        tags: ['Mall'],
        summary: '创建订单',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateMallOrderBody' } },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
          '409': {
            description: '同一买家的幂等键已用于不同下单参数',
          },
        },
      },
    },
    '/api/orders/my': {
      get: {
        tags: ['Mall'],
        summary: '我的订单',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/orders/{orderId}': {
      get: {
        tags: ['Mall'],
        summary: '订单详情',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      patch: {
        tags: ['Mall'],
        summary: '更新订单状态',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PatchMallOrderBody' } },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
          '409': {
            description: '订单状态或版本已变化，请刷新后重试',
          },
        },
      },
    },
    '/api/items/{itemId}/comments': {
      get: {
        tags: ['Mall'],
        summary: '商品评论列表',
        description:
          '访问范围与商品详情一致：游客可查看未删除且已上架商品的评论；未上架商品仅发布者可查看。登录后返回当前用户的点赞状态。',
        security: [{}, { bearerAuth: [] }],
        parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      post: {
        tags: ['Mall'],
        summary: '发表商品评论',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateMallItemCommentBody' } },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/items/{itemId}/comments/{commentId}': {
      delete: {
        tags: ['Mall'],
        summary: '删除商品评论',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'commentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/items/{itemId}/comments/{commentId}/like': {
      post: {
        tags: ['Mall'],
        summary: '点赞商品评论',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'commentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      delete: {
        tags: ['Mall'],
        summary: '取消点赞商品评论',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'commentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/admin/api-endpoints': {
      get: {
        tags: ['ApiLog'], summary: '接口注册与日志开关', security: [{ adminBearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/Page' }, { $ref: '#/components/parameters/PageSize' },
          { name: 'keyword', in: 'query', schema: { type: 'string' } }, { name: 'source', in: 'query', schema: { type: 'string', enum: ['MINI', 'ADMIN'] } },
        ], responses: { '200': { description: 'OK' }, '401': { description: '未登录' }, '403': { description: '仅超级管理员' } },
      },
    },
    '/api/admin/api-endpoints/{id}': {
      patch: {
        tags: ['ApiLog'], summary: '修改接口描述或日志开关', security: [{ adminBearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', minProperties: 1, properties: { description: { type: 'string', maxLength: 500 }, logEnabled: { type: 'boolean' } } } } } },
        responses: { '200': { description: 'OK' }, '400': { description: '参数错误' }, '403': { description: '仅超级管理员' } },
      },
    },
    '/api/admin/api-access-logs': {
      get: { tags: ['ApiLog'], summary: '查询访问日志', security: [{ adminBearerAuth: [] }], parameters: [{ $ref: '#/components/parameters/Page' }, { $ref: '#/components/parameters/PageSize' }, { name: 'ip', in: 'query', schema: { type: 'string' } }, { name: 'endpointId', in: 'query', schema: { type: 'string' } }, { name: 'method', in: 'query', schema: { type: 'string' } }, { name: 'source', in: 'query', schema: { type: 'string' } }, { name: 'httpStatus', in: 'query', schema: { type: 'integer' } }, { name: 'statusClass', in: 'query', schema: { type: 'string', enum: ['2xx', '4xx', '5xx'] } }, { name: 'startAt', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'endAt', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'actorId', in: 'query', schema: { type: 'string' } }, { name: 'minDurationMs', in: 'query', schema: { type: 'integer' } }, { name: 'maxDurationMs', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'OK' }, '403': { description: '仅超级管理员' } } },
    },
    '/api/admin/api-error-logs': {
      get: { tags: ['ApiLog'], summary: '查询 4xx/5xx 接口错误日志（含脱敏请求快照）', security: [{ adminBearerAuth: [] }], parameters: [{ $ref: '#/components/parameters/Page' }, { $ref: '#/components/parameters/PageSize' }, { name: 'ip', in: 'query', schema: { type: 'string' } }, { name: 'endpointId', in: 'query', schema: { type: 'string' } }, { name: 'method', in: 'query', schema: { type: 'string' } }, { name: 'source', in: 'query', schema: { type: 'string' } }, { name: 'httpStatus', in: 'query', schema: { type: 'integer' } }, { name: 'statusClass', in: 'query', schema: { type: 'string', enum: ['2xx', '4xx', '5xx'] } }, { name: 'startAt', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'endAt', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'actorId', in: 'query', schema: { type: 'string' } }, { name: 'minDurationMs', in: 'query', schema: { type: 'integer' } }, { name: 'maxDurationMs', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'OK' }, '403': { description: '仅超级管理员' } } },
    },
    '/api/admin/api-access-logs/export': {
      get: { tags: ['ApiLog'], summary: '导出访问日志 CSV', security: [{ adminBearerAuth: [] }], parameters: [{ $ref: '#/components/parameters/ApiLogFilters' }], responses: { '200': { description: 'UTF-8 BOM CSV', content: { 'text/csv': { schema: { type: 'string' } } } }, '403': { description: '仅超级管理员' } } },
    },
    '/api/admin/api-error-logs/export': {
      get: { tags: ['ApiLog'], summary: '导出异常日志 CSV', security: [{ adminBearerAuth: [] }], parameters: [{ $ref: '#/components/parameters/ApiLogFilters' }], responses: { '200': { description: 'UTF-8 BOM CSV', content: { 'text/csv': { schema: { type: 'string' } } } }, '403': { description: '仅超级管理员' } } },
    },
  },
};
