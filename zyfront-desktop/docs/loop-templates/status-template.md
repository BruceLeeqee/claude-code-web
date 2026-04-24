# Loop 状态：{{loopId}}

> 由 Loop 自动生成 · 生成时间={{createdAt}}

---

## 1. 基本信息

- **任务名称**：{{objective}}
- **当前阶段**：{{stage}}
- **当前状态**：{{status}}
- **当前团队**：{{teamName}}
- **任务类型**：{{taskType}}

## 2. 当前进度

- **iteration**：{{iteration}} / {{maxIterations}}
- **retryCount**：{{retryCount}}
- **当前步骤**：{{currentStepTitle}}
- **下一步**：{{nextStepTitle}}

## 3. 验证矩阵

| 维度 | 状态 | 证据 | 备注 |
|------|------|------|------|
| 编译 | {{compileStatus}} | {{compileEvidence}} | {{compileNote}} |
| UI | {{uiStatus}} | {{uiEvidence}} | {{uiNote}} |
| 接口 | {{apiStatus}} | {{apiEvidence}} | {{apiNote}} |
| 数据 | {{dataStatus}} | {{dataEvidence}} | {{dataNote}} |
| 终端 | {{terminalStatus}} | {{terminalEvidence}} | {{terminalNote}} |

## 4. 工件

- **文档**：{{documentsList}}
- **截图**：{{screenshotsList}}
- **日志**：{{logsList}}
- **Patch**：{{patchesList}}

## 5. 阻塞项

{{blockersList}}

## 6. 下一步建议

{{nextStepSuggestions}}

## 7. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | {{createdAt}} | 初始生成 |
