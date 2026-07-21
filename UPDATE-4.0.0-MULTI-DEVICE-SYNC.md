# Chiptune Table Timer v4.0.0

## 权威 Firestore 路径

- `tables/{tableId}`
- `bookings/{bookingId}`
- `groups/{groupId}`
- `customers/{customerId}`
- `records/{recordId}`
- `records/{recordId}/payments/{paymentId}`
- `operationLogs/{operationId}`
- `syncConflicts/{operationId}`

`shop/main` 仅作为旧页面兼容视图，不能再作为并发控制来源。

## v4 同步保证

1. 每次本地修改拆成实体级操作，队列主键为唯一 operationId。
2. 每个实体独立 version；事务读取当前版本后再提交。
3. operationLogs 作为幂等凭证，网络重试不会重复执行同一操作。
4. 预约、分组、客户删除写 deleted tombstone，不进行物理删除。
5. 每笔付款写入独立 payments 子集合，避免数组互相覆盖。
6. 冲突操作写入 syncConflicts，并从上传队列隔离，不阻塞其他桌位同步。
7. 同一设备多标签页通过 Web Locks 串行消费 IndexedDB 队列。
8. Firestore 权威实体使用现有顶层集合，不再写入错误的 shops/main 子集合。

## 上线顺序

1. 关闭所有旧版本页面并暂停营业操作。
2. 在 Firebase Console 的 Firestore「规则」中发布 `firestore.rules.v4`。
3. 部署本目录全部文件。
4. 仅用一台设备打开 `migrate-sync-v4.html` 并执行一次。
5. 查看 Firestore 顶层集合及 records 下 payments 子集合是否正常。
6. 清除每台 iPad 的网站数据或至少彻底关闭旧标签页，再打开 v4。
7. 使用两台设备完成并发验收测试。

## 必测场景

- 两台设备同时开始不同桌位。
- 两台设备同时修改不同预约。
- 同一账单两台设备分别新增一笔付款，两笔均存在。
- 离线新增付款后恢复网络，付款只出现一次。
- 删除预约后，离线旧设备恢复不会使预约复活。
- 同一预约同时修改同一字段，失败方进入 syncConflicts，不覆盖成功方。

## 重要限制

项目目前未接入 Firebase Authentication，因此规则只能保障结构与不可物理删除，不能限制未授权人员访问。多端一致性与访问安全是两个不同问题；后续应增加员工登录。
