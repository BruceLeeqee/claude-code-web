# Agent Team 实现指南

## 1. 系统架构概述

Agent Battle Arena 项目采用现代化的多智能体协作架构，通过前端界面与后端服务的紧密配合，实现智能体团队的创建、管理和协作。

### 核心组件
- **前端界面**：Agent Battle Arena 可视化控制台
- **后端服务**：MultiAgentOrchestratorService 多智能体编排服务
- **技能系统**：SkillIndexService 技能管理服务
- **状态管理**：基于 RxJS 的响应式状态管理

## 2. 创建 Agent Team

### 2.1 通过前端界面创建

1. **进入协作页面**：在应用中导航到「协作」页面
2. **切换到监控视图**：点击顶部导航栏的「系统监控」标签
3. **创建团队**：
   - 在「AGENT 资源使用」表格中，点击「新建Agent」按钮
   - 填写团队名称、智能体数量等信息
   - 点击「创建团队」按钮

### 2.2 通过 API 创建

使用 `MultiAgentOrchestratorService` 的 `createTeam` 方法创建团队：

```typescript
import { MultiAgentOrchestratorService } from './core/multi-agent/multi-agent.orchestrator.service';

// 注入服务
constructor(private orchestrator: MultiAgentOrchestratorService) {}

// 创建团队
async createAgentTeam() {
  const teamConfig = {
    name: 'Team Alpha',
    prompt: '你是 Team Alpha 的领导智能体，负责协调团队完成任务',
    teamName: 'alpha',
    model: 'claude-3-opus-20240229'
  };
  
  const team = await this.orchestrator.createTeam(teamConfig, 4); // 创建包含4个智能体的团队
  console.log('Team created:', team);
}
```

## 3. 智能体编排

### 3.1 手动编排

1. **添加智能体**：
   - 在监控视图中，点击「新建Agent」按钮
   - 填写智能体名称、角色、提示词等信息
   - 选择后端模式（in-process、tmux 或 iterm2）

2. **配置智能体**：
   - 在智能体列表中，点击智能体对应的操作按钮
   - 调整智能体的资源分配
   - 设置智能体的优先级

### 3.2 自主编排

系统支持基于任务需求的自主编排，通过以下步骤实现：

1. **定义任务**：明确任务目标和要求
2. **设置编排策略**：选择合适的编排算法
3. **执行自主编排**：系统会根据任务需求自动分配智能体

```typescript
// 示例：自主编排智能体
async autoOrchestrateAgents(task: string) {
  // 分析任务需求
  const taskRequirements = this.analyzeTaskRequirements(task);
  
  // 基于需求分配智能体
  const agents = await this.orchestrator.spawnTeammates({
    teamName: 'auto-team',
    taskRequirements,
    autoOrchestrate: true
  });
  
  return agents;
}
```

## 4. 角色绑定

### 4.1 预定义角色

系统支持以下预定义角色：
- **架构师**：负责系统设计和架构规划
- **分析师**：负责数据分析和市场趋势研究
- **开发者**：负责代码实现和功能开发
- **测试员**：负责质量保证和测试

### 4.2 绑定角色

1. **通过前端界面**：
   - 在监控视图的智能体列表中，选择智能体
   - 点击「编辑」按钮
   - 从角色下拉菜单中选择合适的角色

2. **通过 API**：

```typescript
// 绑定角色到智能体
async assignRole(agentId: string, role: string) {
  await this.orchestrator.updateTeammate(agentId, {
    role,
    prompt: this.getRolePrompt(role)
  });
}

// 获取角色对应的提示词
private getRolePrompt(role: string): string {
  const rolePrompts = {
    '架构师': '你是一名资深系统架构师，擅长设计可扩展的系统架构...',
    '分析师': '你是一名数据分析师，擅长分析市场趋势和数据模式...',
    '开发者': '你是一名全栈开发者，擅长快速实现功能和解决技术问题...',
    '测试员': '你是一名QA测试专家，擅长发现和报告系统缺陷...'
  };
  return rolePrompts[role] || '你是一名通用智能体...';
}
```

## 5. 任务分配

### 5.1 手动分配任务

1. **通过前端界面**：
   - 在监控视图中，选择目标智能体
   - 点击「分配任务」按钮
   - 输入任务描述和截止时间
   - 点击「确认分配」按钮

2. **通过 API**：

```typescript
// 分配任务给智能体
async assignTask(agentId: string, task: string, deadline?: string) {
  await this.orchestrator.sendMessage(agentId, `任务：${task}${deadline ? `\n截止时间：${deadline}` : ''}`);
}
```

### 5.2 批量分配任务

```typescript
// 批量分配任务
async assignTasksToTeam(teamName: string, tasks: Array<{ agentId: string; task: string }>) {
  for (const { agentId, task } of tasks) {
    await this.orchestrator.sendMessage(agentId, `任务：${task}`);
  }
}
```

## 6. 协作模式设置

### 6.1 支持的协作模式

- **对抗模式 (Battle)**：智能体之间相互竞争
- **协作模式 (Coop)**：智能体之间相互配合
- **流水线 (Pipeline)**：智能体按顺序处理任务
- **脑暴模式 (Storm)**：智能体集体 brainstorm
- **竞赛模式 (Contest)**：智能体参与竞赛

### 6.2 设置协作模式

1. **通过前端界面**：
   - 在右侧面板的「协作模式切换」部分
   - 点击对应模式的按钮进行切换

2. **通过 API**：

```typescript
// 设置协作模式
async setCollaborationMode(mode: 'battle' | 'coop' | 'pipeline' | 'storm' | 'contest') {
  await this.orchestrator.setMode(mode);
}
```

## 7. 技能绑定

### 7.1 技能管理

技能存储在 Vault 的 `agent-skills` 目录中，每个技能包含：
- 技能名称
- 技能描述
- 技能执行步骤
- 技能示例

### 7.2 绑定技能到智能体

1. **通过前端界面**：
   - 在监控视图的「技能与插件配置中心」
   - 选择目标智能体
   - 从技能库中选择要绑定的技能
   - 点击「绑定」按钮

2. **通过 API**：

```typescript
import { SkillIndexService } from './core/skill-index.service';

// 注入服务
constructor(private skillIndex: SkillIndexService) {}

// 绑定技能到智能体
async bindSkillToAgent(agentId: string, skillId: string) {
  const skill = await this.skillIndex.readSkillMd({
    contentPath: `03-AGENT-TOOLS/01-Skills/${skillId}/SKILL.md`,
    scope: 'vault'
  });
  
  if (skill.ok) {
    await this.orchestrator.sendMessage(agentId, `技能：${skillId}\n${skill.content}`);
  }
}
```

### 7.3 创建自定义技能

```typescript
// 创建自定义技能
async createCustomSkill(name: string, description: string) {
  const result = await this.skillIndex.createSkillInVault({ name, desc: description });
  if (result.ok) {
    console.log('Skill created:', result.id);
  }
}
```

## 8. 监控与管理

### 8.1 实时监控

- **系统负载**：CPU、内存、网络、GPU 使用情况
- **智能体状态**：运行状态、资源使用、任务进度
- **团队状态**：团队整体健康状况、协作强度

### 8.2 故障处理

1. **智能体重启**：
   - 在监控视图中，选择状态异常的智能体
   - 点击「重启」按钮

2. **团队重置**：
   - 在监控视图中，点击「重置团队」按钮
   - 确认重置操作

3. **资源告警**：
   - 在监控视图中，点击「资源告警设置」按钮
   - 配置告警阈值和通知方式

## 9. 最佳实践

### 9.1 团队配置

- **小团队**（2-4个智能体）：适合简单任务，响应速度快
- **中团队**（5-8个智能体）：适合中等复杂度任务，平衡效率和多样性
- **大团队**（9+个智能体）：适合复杂任务，提供全方位解决方案

### 9.2 技能组合

- **通用技能**：所有智能体都应具备的基础技能
- **专业技能**：特定角色需要的专业技能
- **互补技能**：不同智能体之间的技能互补

### 9.3 协作策略

- **明确目标**：确保所有智能体理解任务目标
- **合理分工**：根据智能体的角色和技能分配任务
- **定期同步**：设置定期同步机制，确保团队协作顺畅
- **持续优化**：根据任务执行情况，持续优化团队配置和协作策略

## 10. 示例场景

### 10.1 软件开发项目

1. **创建团队**：架构师、分析师、开发者、测试员
2. **设置协作模式**：流水线模式
3. **分配任务**：
   - 架构师：设计系统架构
   - 分析师：分析需求和技术可行性
   - 开发者：实现功能
   - 测试员：测试功能和性能
4. **绑定技能**：
   - 架构师：系统设计、技术选型
   - 分析师：需求分析、市场研究
   - 开发者：代码实现、调试
   - 测试员：功能测试、性能测试

### 10.2 市场分析项目

1. **创建团队**：市场分析师、数据分析师、报告撰写者
2. **设置协作模式**：协作模式
3. **分配任务**：
   - 市场分析师：收集市场数据
   - 数据分析师：分析数据趋势
   - 报告撰写者：生成分析报告
4. **绑定技能**：
   - 市场分析师：市场调研、竞争对手分析
   - 数据分析师：数据分析、可视化
   - 报告撰写者：报告撰写、演示

## 11. 故障排除

### 11.1 常见问题

1. **智能体启动失败**：
   - 检查后端服务状态
   - 检查网络连接
   - 检查资源配额

2. **技能绑定失败**：
   - 检查技能文件是否存在
   - 检查技能文件格式是否正确
   - 检查智能体权限

3. **协作模式切换失败**：
   - 检查当前任务状态
   - 检查系统资源
   - 重启团队

### 11.2 日志与调试

- **系统日志**：查看系统监控面板的日志输出
- **智能体日志**：在监控视图中查看每个智能体的详细日志
- **网络日志**：检查网络连接和数据传输情况

## 12. 总结

Agent Battle Arena 项目提供了一个强大、灵活的多智能体协作平台，通过游戏化的方式，为用户提供了直观、生动的智能体管理界面。通过本指南，您可以了解如何创建和管理智能体团队，如何设置协作模式，如何绑定技能，以及如何优化团队配置以提高协作效率。

随着项目的不断发展，我们将持续改进和扩展功能，为用户提供更加丰富和强大的多智能体协作体验。