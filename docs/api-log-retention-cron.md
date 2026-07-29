# API 日志保留与清理

访问日志和 5xx 错误日志默认保留 90 天。清理由部署环境的 cron/计划任务执行，不在 API 启动时自动运行：

```cron
# 每日 03:20（服务器时区）分批删除 90 天以前的日志
20 3 * * * cd /srv/intelligent-community-admin && APP_ENV=test npm run cleanup-api-logs >> /var/log/intelligent-community-api-log-cleanup.log 2>&1
```

脚本每批最多处理 5,000 条，输出删除数量与耗时；失败会返回非零退出码。迁移和清理均需在测试环境验证后再安排生产定时任务。
