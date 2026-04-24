# 总结文档：{{objective}}

> 由 Loop 自动生成 · loopId={{loopId}} · 生成时间={{createdAt}}

---

## 1. 任务概要

- **目标**：{{objective}}
- **任务类型**：{{taskType}}
- **团队**：{{teamName}}
- **总轮次**：{{totalIterations}} / {{maxIterations}}
- **最终状态**：{{finalStatus}}

## 2. 执行摘要

### 2.1 完成的步骤

| 序号 | 步骤 ID | 标题 | 类型 | 状态 |
|------|---------|------|------|------|
{{completedStepsTable}}

### 2.2 跳过/未完成的步骤

| 序号 | 步骤 ID | 标题 | 类型 | 原因 |
|------|---------|------|------|------|
{{skippedStepsTable}}

## 3. 验证矩阵总结

| 维度 | 最终状态 | 证据 |
|------|----------|------|
| 编译 | {{compileFinalStatus}} | {{compileFinalEvidence}} |
| UI | {{uiFinalStatus}} | {{uiFinalEvidence}} |
| 接口 | {{apiFinalStatus}} | {{apiFinalEvidence}} |
| 数据 | {{dataFinalStatus}} | {{dataFinalEvidence}} |
| 终端 | {{terminalFinalStatus}} | {{terminalFinalEvidence}} |

## 4. 文件变更汇总

| 文件路径 | 变更类型 | 关联步骤 |
|----------|----------|----------|
{{fileChangesTable}}

## 5. 工件清单

| 类型 | 标签 | 路径 |
|------|------|------|
{{artifactsTable}}

## 6. 阻塞项

{{blockersSection}}

## 7. 收敛判定

### 7.1 是否满足上线条件

- [ ] 功能实现完成
- [ ] 关键测试通过
- [ ] build 成功
- [ ] 无已知 blocker
- [ ] 变更摘要已记录

### 7.2 收敛原因

{{convergenceReason}}

## 8. 下一步建议

{{nextStepRecommendation}}

## 9. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | {{createdAt}} | 初始生成 |
