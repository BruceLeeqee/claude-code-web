# AI量化交易系统 6 页面复刻实施计划（Angular 组件化 + 动态交互）

> 基于原型目录：`C:/Users/95324/Downloads/AI量化交易系统原型`
>
> 目标工程：`zyfront-desktop`（当前已有统一深色主题/壳层样式）
>
> 目标：先出详细计划文档，后续按计划落地 6 个页面的 Angular 化复刻与交互实现。

---

## 1. 项目目标与范围

## 1.1 目标

在 `zyfront-desktop` 现有全局主题与壳层（Global Shell）基础上，复刻以下 6 个页面，并将静态原型升级为可维护的 Angular 组件化页面，具备可演示的动态交互能力：

1. 中枢调度面板（`index.html`）
2. 策略生成画布（`strategy_gen.html`）
3. 智能回测系统（`backtest.html`）
4. 实盘交易系统（`live_trading.html`）
5. 风险控制中心（`risk_control.html`）
6. 全流程追溯（`traceability.html`）

## 1.2 范围边界

**本阶段（复刻阶段）包含：**
- 页面结构与视觉层级复刻（与原型高一致）
- Angular 组件拆分与路由集成
- 使用 mock 数据实现动态交互（切换、筛选、状态流转、图表更新）
- 与当前 `zyfront-desktop` 的深色主题风格协调

**本阶段不包含：**
- 真实交易接口/实盘下单
- 真实回测引擎计算
- 真实风控计算与审计归档
- 后端 API 开发与数据库设计

---

## 2. 现状评估（zyfront-desktop）

## 2.1 已有基础能力

- 已有统一全局样式与深色主题基底（`src/styles.scss`）
- 已有全局壳层框架与左侧活动栏（`global-shell-frame`）
- 已有 prototype 模块化路由体系（`app.routes.ts` -> `prototype/*`）
- 现有页面已采用 Angular standalone component 组织方式，可复用同模式

## 2.2 约束与设计原则

- **不破坏现有 shell 信息架构**：顶部菜单 + 左侧活动栏保持一致
- **页面融入现有主题**：尽量复用现有色板、边框、卡片密度、按钮风格
- **组件优先**：避免“大而全单页模板”，拆成可复用 UI 子组件
- **Mock-first**：先用本地状态与假数据跑通交互，再预留 API 接口层
- **可渐进替换**：每个页面的 mock 数据后续可平滑接真实服务

---

## 3. 信息架构与路由规划

## 3.1 新增一级原型分组（建议）

建议在 `prototype` 下新增量化分组路由，避免与现有 skills/plugins/graph 页面混杂：

- `/prototype/quant/dashboard`
- `/prototype/quant/strategy-canvas`
- `/prototype/quant/backtest`
- `/prototype/quant/live-trading`
- `/prototype/quant/risk-control`
- `/prototype/quant/traceability`

## 3.2 导航呈现建议

两种实现方式（二选一）：

- **方案A（推荐）**：在 Quant 页面内部增加二级侧边导航（仅量化域可见）
- **方案B**：扩展全局左侧活动栏入口，点击进入 quant dashboard，再在页面内 tab 切换

推荐 A 的原因：
- 与原型“同域多页面”结构一致
- 减少对现有 `global-shell-frame` 主导航侵入
- 后续拆分为独立产品线更容易

---

## 4. 组件化拆分方案

## 4.1 通用布局组件（quant shared）

新建 `features/prototype/quant/shared`：

- `QuantPageLayoutComponent`
  - 统一页头（标题、状态、快捷按钮）
  - 主内容容器与滚动策略
- `QuantSideNavComponent`
  - 6 页面导航项
  - 当前路由高亮
- `MetricCardComponent`
  - 指标标题/值/环比/风险色
- `GlassPanelComponent`
  - 原型中的 glass-card 语义封装
- `StatusBadgeComponent`
  - Active/Warning/Blocked/Info 等统一展示

## 4.2 页面级组件

每页一个 container 组件 + 若干 section 组件：

1. DashboardPageComponent
   - `dashboard-kpi-grid`
   - `dashboard-performance-chart`
   - `dashboard-strategy-ranking`
   - `dashboard-decision-stream`
   - `dashboard-trace-summary`

2. StrategyCanvasPageComponent
   - `strategy-chat-panel`
   - `strategy-canvas-board`
   - `strategy-node`
   - `strategy-bottom-toolbar`

3. BacktestPageComponent
   - `backtest-kpi-summary`
   - `backtest-equity-chart`
   - `backtest-trade-table`
   - `backtest-risk-distribution`

4. LiveTradingPageComponent
   - `live-running-portfolios`
   - `live-order-log-table`
   - `live-positions-overview`

5. RiskControlPageComponent
   - `risk-var-gauge`
   - `risk-beta-line`
   - `risk-concentration-bars`
   - `risk-rule-list`
   - `risk-intercept-log`

6. TraceabilityPageComponent
   - `trace-timeline`
   - `trace-step-card`
   - `trace-explainability-panel`

---

## 5. 动态交互设计（首版可演示）

## 5.1 全局交互基线

- 全页面支持基础 Loading Skeleton（首次加载 300~800ms 模拟）
- 关键按钮具备 hover/active/disabled 状态
- 列表/表格至少支持 1 项筛选或排序
- 图表在窗口 resize 时自适应

## 5.2 页面交互清单

### A. 中枢调度面板

- 收益曲线时间维度切换（当日/近一周/近一月）
- 策略排行项点击后联动右侧详情区（或弹层）
- AI 决策流支持“展开证据”交互
- 风控预警数字变化时高亮动画

### B. 策略生成画布

- 左侧对话发送后，右侧画布新增/更新节点（mock 规则驱动）
- 节点可选中（高亮边框）
- 模板按钮（动量/均值回归）一键替换画布
- “运行回测”按钮触发到回测页并带策略参数（query/state）

### C. 智能回测系统

- 回测区间、基准切换驱动图表重绘
- 成交历史支持分页或“查看全部”抽屉
- 指标卡支持 Tooltip 解释（如夏普、索提诺）

### D. 实盘交易系统

- 组合卡片状态切换（Active/Paused/Stopped）
- “一键停止全部”触发确认弹窗 + 状态批量更新
- 成交日志自动滚动/定时追加 mock 新记录

### E. 风险控制中心

- VaR、Beta 图表定时刷新模拟实时波动
- 规则阈值支持编辑（弹层表单）
- 风险日志按等级过滤（All/Blocked/Warning/Info）

### F. 全流程追溯

- 时间轴步骤点击后右侧详情切换
- SHAP 条形支持按绝对值排序
- 关联新闻支持折叠/展开全文
- 导出按钮先实现前端“生成中”流程（占位）

---

## 6. 图表与可视化技术方案

## 6.1 图表库

优先复用原型思路：ECharts（Angular 中封装组件使用）

建议新增：
- `EchartsPanelComponent`（统一 init / setOption / dispose / resize）

图表页面对应：
- Dashboard：收益折线
- Backtest：策略 vs 基准折线 + 风险分布饼图
- RiskControl：VaR 仪表 + Beta 曲线

## 6.2 数据驱动层

新增 `quant-mock-data.service.ts`：
- 提供页面数据流（`signal` 或 `BehaviorSubject`）
- 提供定时更新逻辑（实盘/风控页面）
- 提供交互 action（如切换周期、更新规则）

---

## 7. 数据模型与状态管理（建议）

按领域定义类型文件（`features/prototype/quant/models`）：

- `dashboard.models.ts`
- `strategy-canvas.models.ts`
- `backtest.models.ts`
- `live-trading.models.ts`
- `risk-control.models.ts`
- `traceability.models.ts`

状态管理建议：
- 页面内局部状态：Angular `signal`
- 跨页面跳转上下文（例如策略画布 -> 回测）：轻量 service 缓存 + 路由参数

---

## 8. 视觉复刻与主题对齐策略

## 8.1 复刻优先级

1. 布局网格与信息层级
2. 卡片/按钮/表格密度与间距
3. 色彩语义（蓝=主动作，绿=收益，红=风险）
4. 动效（脉冲、hover、状态过渡）

## 8.2 与现有主题融合

- 保持 `zyfront-desktop` 现有深色背景基调
- 将原型 `glass-card` 映射为可复用 SCSS mixin/class
- 统一字号阶梯（10/12/14/16/20）与圆角（6/8/12）

---

## 9. 实施分阶段计划（WBS）

## 阶段 0：设计与基建（0.5~1 天）

- 创建 quant 路由骨架与空页面
- 搭建 shared 组件与样式变量
- 封装 ECharts 基础组件

**产出**：6 页面可路由访问的空壳 + 通用组件底座

## 阶段 1：核心页面复刻（2~3 天）

优先完成高价值主链路：
1. Dashboard
2. Strategy Canvas
3. Backtest

**产出**：从策略构建到回测的演示闭环

## 阶段 2：运营监控页面（1.5~2 天）

4. Live Trading
5. Risk Control
6. Traceability

**产出**：运行监控、风险与追溯的完整演示闭环

## 阶段 3：联调与体验打磨（1 天）

- 页面跳转上下文联动
- 关键动效、空态、异常态
- 代码整理与样式统一

**产出**：可演示、可扩展、结构清晰的 6 页面原型实现

---

## 10. 验收标准（Definition of Done）

每个页面完成需满足：

1. 路由可达、无白屏、无阻塞错误
2. 主结构与原型一致度 ≥ 90%（布局/层级/关键视觉）
3. 至少 3 个有效动态交互可演示
4. 图表正常渲染并支持 resize
5. 样式与现有主题不冲突（无明显割裂）
6. 代码通过基础 lint（仅修复本次改动引入问题）

整体验收需满足：
- 6 页面可通过导航互相访问
- 关键主链路连通：策略生成 -> 回测 -> 实盘/风控/追溯

---

## 11. 风险与应对

1. **风险：现有壳层导航容量有限**
   - 应对：quant 内部二级导航，降低对全局壳层侵入

2. **风险：页面信息密度高，初版复杂度超预期**
   - 应对：先保主区块，次要细节（如全部日志）延后

3. **风险：图表组件重复初始化导致性能问题**
   - 应对：统一 ECharts 封装，生命周期集中管理

4. **风险：样式冲突（全局 vs 页面局部）**
   - 应对：尽量使用页面作用域 class，避免过多 `::ng-deep`

---

## 12. 下一步执行建议

按以下顺序开始开发最稳妥：

1. 建立 quant 路由与页面骨架
2. 先完成 Dashboard（可最快验证主题与组件策略）
3. 完成 Strategy Canvas，并打通到 Backtest 的跳转上下文
4. 再补齐 Live/Risk/Traceability 三页
5. 最后统一交互细节、空态、loading、lint

---

## 13. 页面-原型映射清单（追踪）

- `index.html` -> `quant/dashboard`
- `strategy_gen.html` -> `quant/strategy-canvas`
- `backtest.html` -> `quant/backtest`
- `live_trading.html` -> `quant/live-trading`
- `risk_control.html` -> `quant/risk-control`
- `traceability.html` -> `quant/traceability`

> 该文档为实施主计划。后续进入编码阶段时，可按每页再拆分为「任务清单 + 组件清单 + 交互清单 + 自测清单」。
