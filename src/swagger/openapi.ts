/**
 * OpenAPI 3.0 文档（供 Swagger UI 展示）。与 `routes/index.ts`、`routes/mall.routes.ts` 对齐。
 */
export const openApiDocument: Record<string, unknown> = {
  openapi: '3.0.3',
  info: {
    title: '智慧社区管理端 API',
    description:
      '与 intelligent-community 小程序配套的后端接口。除登录与健康检查外，均需 `Authorization: Bearer <token>`。',
    version: '0.1.0',
  },
  servers: [{ url: '/', description: '当前服务' }],
  tags: [
    { name: 'Health', description: '健康检查' },
    { name: 'Auth', description: '认证' },
    { name: 'User', description: '用户资料' },
    { name: 'Forum', description: '小区留言（帖子）' },
    { name: 'Errand', description: '跑腿' },
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
      PublishErrandBody: {
        type: 'object',
        required: ['title', 'content', 'reward'],
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          reward: { type: 'string' },
          authorName: { type: 'string', description: '可选，服务端以用户表为准' },
        },
      },
      ClaimErrandBody: {
        type: 'object',
        properties: { claimerName: { type: 'string' } },
      },
      PublishErrandReplyBody: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string' },
          authorName: { type: 'string' },
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
        required: ['title', 'desc', 'reward', 'location'],
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
            enum: ['forum', 'task', 'errand', 'mall', 'avatar'],
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
      CreateMallOrderBody: {
        type: 'object',
        required: ['itemId', 'sellerId'],
        properties: {
          itemId: { type: 'string', minLength: 1 },
          itemTitle: { type: 'string', maxLength: 500 },
          itemPrice: { type: 'string', maxLength: 64 },
          itemUnit: { type: 'string', maxLength: 16 },
          sellerId: { type: 'string', minLength: 1 },
          contact: { type: 'string', maxLength: 500 },
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
    '/api/posts': {
      get: {
        tags: ['Forum'],
        summary: '帖子列表',
        security: [{ bearerAuth: [] }],
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
    '/api/errands': {
      get: {
        tags: ['Errand'],
        summary: '跑腿列表',
        security: [{ bearerAuth: [] }],
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
        tags: ['Errand'],
        summary: '发布跑腿',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PublishErrandBody' } },
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
    '/api/errands/my': {
      get: {
        tags: ['Errand'],
        summary: '我的跑腿',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'role', in: 'query', schema: { type: 'string', enum: ['published', 'claimed'] } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/errands/{errandId}': {
      get: {
        tags: ['Errand'],
        summary: '跑腿详情',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'errandId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/errands/{errandId}/claim': {
      post: {
        tags: ['Errand'],
        summary: '领取跑腿',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'errandId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ClaimErrandBody' } },
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
    '/api/errands/{errandId}/complete': {
      post: {
        tags: ['Errand'],
        summary: '发布者确认完成',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'errandId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/errands/{errandId}/replies': {
      post: {
        tags: ['Errand'],
        summary: '跑腿下回复',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'errandId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PublishErrandReplyBody' } },
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
    '/api/errands/{errandId}/like': {
      post: {
        tags: ['Errand'],
        summary: '点赞跑腿',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'errandId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      delete: {
        tags: ['Errand'],
        summary: '取消点赞跑腿',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'errandId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
    },
    '/api/errands/{errandId}/favorite': {
      post: {
        tags: ['Errand'],
        summary: '收藏跑腿',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'errandId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
        },
      },
      delete: {
        tags: ['Errand'],
        summary: '取消收藏跑腿',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'errandId', in: 'path', required: true, schema: { type: 'string' } }],
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
        security: [{ bearerAuth: [] }],
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
        security: [{ bearerAuth: [] }],
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
        security: [{ bearerAuth: [] }],
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
        },
      },
    },
    '/api/tasks/{taskId}/revoke': {
      post: {
        tags: ['Task'],
        summary: '发布者撤销发布',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'taskId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/JsonSuccess' } } },
          },
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
        security: [{ bearerAuth: [] }],
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
        security: [{ bearerAuth: [] }],
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
        security: [{ bearerAuth: [] }],
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
        },
      },
    },
    '/api/items/{itemId}/comments': {
      get: {
        tags: ['Mall'],
        summary: '商品评论列表',
        security: [{ bearerAuth: [] }],
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
  },
};
