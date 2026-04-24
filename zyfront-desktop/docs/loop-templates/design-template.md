# 设计文档：{{taskName}}

> 由 Loop 自动生成 · loopId={{loopId}} · 生成时间={{createdAt}}

---

## 1. 设计目标

- {{designGoal1}}
- {{designGoal2}}

## 2. 总体架构

- 模块 A：{{moduleA}}
- 模块 B：{{moduleB}}
- 模块 C：{{moduleC}}

## 3. 关键流程

1. {{flow1}}
2. {{flow2}}
3. {{flow3}}

## 4. 接口/命令设计

- **命令格式**：{{commandFormat}}
- **输入输出**：{{inputOutput}}
- **错误处理**：{{errorHandling}}

## 5. 状态模型

- 字段说明：{{stateFields}}
- 状态流转：{{stateTransition}}

### 5.1 核心状态

| 字段 | 类型 | 说明 |
|------|------|------|
| {{field1Name}} | {{field1Type}} | {{field1Desc}} |
| {{field2Name}} | {{field2Type}} | {{field2Desc}} |

### 5.2 状态流转图

```
idle -> planning -> executing -> verifying -> completed
                                \-> repairing -> verifying
                                \-> blocked
                                \-> paused
```

## 6. 验证方案

- **编译验证**：{{compileVerification}}
- **UI 验证**：{{uiVerification}}
- **接口验证**：{{apiVerification}}
- **数据验证**：{{dataVerification}}

### 6.1 验证矩阵

| 维度 | 验证方式 | 通过标准 | 备注 |
|------|----------|----------|------|
| 编译 | build | 0 error | |
| UI | 页面打开/截图 | 无报错 | |
| 接口 | API 状态码 | 2xx | |
| 数据 | 持久化检查 | 读写一致 | |
| 终端 | 命令退出码 | exit 0 | |

## 7. 风险与回退方案

- 风险 1：{{risk1}}
  - 缓解措施：{{mitigation1}}

- 风险 2：{{risk2}}
  - 缓解措施：{{mitigation2}}

## 8. 待确认细节

- 细节 1：{{pendingDetail1}}
- 细节 2：{{pendingDetail2}}

## 9. 最终确认

- 已确认项：{{confirmedItems}}
- 未确认项：{{unconfirmedItems}}

## 10. 版本记录

| 版本 | 日期 | 修改人 | 说明 |
|------|------|--------|------|
| v0.1 | {{createdAt}} | Loop (auto) | 初始生成 |
