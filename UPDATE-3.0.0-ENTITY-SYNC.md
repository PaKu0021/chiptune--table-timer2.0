# Chiptune Table Timer v3.0.0 — 实体级多端同步

## 新 Firestore 结构

- `shops/main/tables/{tableId}`：每桌独立文档
- `shops/main/bookings/{bookingId}`：每个预约独立文档，删除使用 tombstone
- `shops/main/groups/{groupId}`：每个分组独立文档
- `shops/main/customers/{customerId}`：每位客户独立文档
- `shops/main/records/{recordId}`：账单元数据
- `shops/main/records/{recordId}/payments/{paymentId}`：不可互相覆盖的付款/退款流水
- `shops/main/operations/{operationId}`：幂等操作日志

旧 `shop/main` 与顶层 `records` 暂时保留，作为现有页面的兼容物化视图。新同步操作在事务中只修改目标实体，同时更新兼容视图，不再上传整份本地状态。

## 冲突规则

- 不同实体：独立提交，互不覆盖。
- 同一实体、不同字段：基于远端最新版本自动合并 patch。
- 同一实体、同一字段：拒绝旧操作，保留本地队列并显示同步失败，禁止按客户端时间强行覆盖。
- 每个操作使用唯一 `operationId`；网络超时后重复提交不会重复执行。
- 删除使用 `deleted: true` tombstone，旧设备不能复活已删除实体。

## 上线步骤

1. 在旧版本中确认所有设备显示“已同步”。
2. 停止营业操作并关闭其他设备页面。
3. 从 Firebase Console 导出或备份 Firestore。
4. 发布 `firestore.rules.v3.example` 中对应的新路径规则。当前示例保持旧程序的开放访问方式；正式环境建议另行接入 Firebase Authentication。
5. 部署 v3.0.0 文件。
6. 仅在一台设备打开 `migrate-sync-v3.html`，执行一次迁移。
7. 检查 `shops/main/tables`、`bookings`、`records/*/payments` 已生成。
8. 再打开其他设备，执行双设备测试。

## 必测场景

- 两台设备同时开始不同桌位。
- 两台设备同时修改不同预约。
- 两台设备同时给同一账单新增不同付款。
- 一台设备离线新增付款，恢复联网后只出现一次。
- 一台设备删除预约，旧设备恢复后预约不复活。
- 两台设备同时修改同一预约时间，一方成功，另一方明确报告冲突。

## 注意

IndexedDB 数据库版本升级为 3。上线前必须先让旧版本把所有待同步操作上传完成。旧版队列格式不再继续执行，以避免把整份旧快照写回新结构。
