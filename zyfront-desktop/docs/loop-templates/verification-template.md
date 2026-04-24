# 验证文档：{{stepTitle}}

> 由 Loop 自动生成 · loopId={{loopId}} · stepId={{stepId}} · 生成时间={{createdAt}}

---

## 1. 验证信息

- **步骤 ID**：{{stepId}}
- **验证阶段**：{{verificationStage}}
- **验证结果**：{{passedLabel}}

## 2. 验证内容

验证不仅是测试是否通过，还包括：

- [ ] 功能是否达标
- [ ] 是否符合预期设计
- [ ] 是否引入副作用
- [ ] 是否满足安全约束
- [ ] 是否具备发布条件

## 3. 验证矩阵结果

| 维度 | 状态 | 证据 | 备注 |
|------|------|------|------|
| 编译 | {{compileStatus}} | {{compileEvidence}} | {{compileNote}} |
| UI | {{uiStatus}} | {{uiEvidence}} | {{uiNote}} |
| 接口 | {{apiStatus}} | {{apiEvidence}} | {{apiNote}} |
| 数据 | {{dataStatus}} | {{dataEvidence}} | {{dataNote}} |
| 终端 | {{terminalStatus}} | {{terminalEvidence}} | {{terminalNote}} |

## 4. 错误列表

{{errorsSection}}

## 5. 警告列表

{{warningsSection}}

## 6. 阻塞项

{{blockersSection}}

## 7. 建议

- **建议动作**：{{recommendation}}

### 判定规则参考

- 若 lint/typecheck 失败：进入 repair
- 若单元测试失败：进入 repair 或 blocked
- 若 build 失败：进入 repair
- 若 smoke 通过：进入 review 或 release
- 若存在 blocker：暂停并请求用户介入

## 8. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | {{createdAt}} | 初始生成 |
