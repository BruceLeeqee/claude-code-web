# 修复文档：{{stepTitle}}

> 由 Loop 自动生成 · loopId={{loopId}} · stepId={{stepId}} · 生成时间={{createdAt}}

---

## 1. 修复信息

- **步骤 ID**：{{stepId}}
- **修复触发原因**：{{repairTrigger}}
- **当前重试次数**：{{retryCount}}

## 2. 失败分析

### 2.1 原始错误

```
{{originalError}}
```

### 2.2 错误来源定位

- **相关文件**：{{errorSourceFiles}}
- **相关步骤**：{{errorSourceStep}}
- **错误类型**：{{errorType}}

### 2.3 根因分析

{{rootCauseAnalysis}}

## 3. 修复策略

### 3.1 修复优先级

1. 语法错误 > 类型错误 > 低级 lint 错误 > 业务逻辑错误 > 风格问题

### 3.2 本次修复策略

- **策略描述**：{{repairStrategy}}
- **修改范围**：{{repairScope}}
- **最小修改文件**：{{minTargetFiles}}

## 4. 修复执行

### 4.1 补丁记录

| 序号 | 补丁模式 | 目标文件 | 结果 |
|------|----------|----------|------|
| 1 | {{patch1Mode}} | {{patch1Target}} | {{patch1Result}} |
| 2 | {{patch2Mode}} | {{patch2Target}} | {{patch2Result}} |

### 4.2 变更摘要

{{changeSummary}}

## 5. 修复后验证

- **验证结果**：{{postRepairResult}}
- **是否通过**：{{postRepairPassed}}

## 6. 连续失败处理

- 同一错误连续失败阈值：3 次
- 多轮无进展阈值：5 次
- 当前连续失败次数：{{consecutiveFailures}}

### 处理策略

- 达到连续失败阈值 -> `blocked`
- 达到无进展阈值 -> `failed`
- 需要重大架构变更 -> `pause` 并请求确认

## 7. 下一步

- **建议**：{{nextAction}}

## 8. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | {{createdAt}} | 初始生成 |
