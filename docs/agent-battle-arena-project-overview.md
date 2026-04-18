📋 Agent Battle Arena - 项目概述与视觉风格设计文档

文档版本: 1.0

所属项目: Agent Battle Arena - 像素大战风格多智能体协作可视化系统

创建日期: 2026-04-16

更新日期: 2026-04-16

一、项目概述

1.1 项目基本信息

项目名称: Agent Battle Arena - 像素大战辩论系统

核心概念: 将多个AI Agent的辩论/协作过程可视化为复古像素风格的街机对战游戏

视觉风格: 8-bit像素艺术 + 街机游戏 + 赛博朋克配色

技术栈建议: HTML5 Canvas / WebGL + CSS3 + JavaScript/TypeScript + 像素字体

1.2 设计目标

可视化多智能体交互: 将抽象的Agent协作过程转化为直观的视觉体验

复古街机美学: 致敬80年代经典街机游戏，唤起怀旧情感

实时反馈: 提供即时的视觉反馈，增强用户参与感

可扩展架构: 支持多种协作模式（对抗/协作/流水线/脑暴/竞赛）

1.3 目标用户

AI系统开发者

多智能体系统研究人员

技术产品经理

对AI协作过程感兴趣的技术爱好者

二、核心视觉风格定义

2.1 色彩系统

2.1.1 主色调

主色调:

├── 背景色: \#0D0D1A (深空黑)

├── 面板色: \#1A1A2E (暗夜蓝)

├── 边框色: \#4A4A6A (金属灰)

└── 高光色: \#FFFFFF (纯白)

2.1.2 Agent专属色

Agent专属色:

├── 🔴 RED Agent: \#FF4444 (火焰红)

├── 🔵 BLUE Agent: \#44AAFF (电光蓝) 

├── 🟢 GREEN Agent: \#44FF88 (毒液绿)

├── 🟡 GOLD Agent: \#FFCC00 (闪电金)

└── 🟣 PURPLE Agent: \#AA44FF (虚空紫)

2.1.2a GREEN Agent (毒液绿) 详细色板

主色: \#44FF88 (毒液绿)

亮色: \#88FFAA (荧光绿) - 用于高光和发光效果

暗色: \#22AA55 (深绿) - 用于阴影和边框

强调色: \#AAFF00 (酸橙绿) - 用于特效和强调

背景光: rgba(68, 255, 136, 0.2) - 用于环境光晕

渐变组合:

├── 光束渐变: linear-gradient(90deg, \#44FF88, \#88FFAA)

├── 能量渐变: linear-gradient(180deg, \#AAFF00, \#44FF88)

└── 阴影渐变: linear-gradient(135deg, \#44FF88, \#22AA55)

像素艺术调色板 (4色限制):

├── 高光: \#CCFFDD

├── 主色: \#44FF88

├── 阴影: \#22AA55

└── 轮廓: \#116633

2.1.2b GOLD Agent (闪电金) 详细色板

主色: \#FFCC00 (闪电金)

亮色: \#FFEE55 (亮金色) - 用于高光和发光效果

暗色: \#CC9900 (深金色) - 用于阴影和边框

强调色: \#FFAA00 (琥珀金) - 用于特效和强调

背景光: rgba(255, 204, 0, 0.2) - 用于环境光晕

渐变组合:

├── 光束渐变: linear-gradient(90deg, \#FFCC00, \#FFEE55)

├── 能量渐变: linear-gradient(180deg, \#FFEE55, \#FFCC00)

└── 阴影渐变: linear-gradient(135deg, \#FFCC00, \#CC9900)

像素艺术调色板 (4色限制):

├── 高光: \#FFF8CC

├── 主色: \#FFCC00

├── 阴影: \#CC9900

└── 轮廓: \#996600

2.1.2c PURPLE Agent (虚空紫) 详细色板

主色: \#AA44FF (虚空紫)

亮色: \#CC88FF (亮紫色) - 用于高光和发光效果

暗色: \#7722CC (深紫色) - 用于阴影和边框

强调色: \#FF44FF (洋红紫) - 用于特效和强调

背景光: rgba(170, 68, 255, 0.2) - 用于环境光晕

渐变组合:

├── 光束渐变: linear-gradient(90deg, \#AA44FF, \#CC88FF)

├── 能量渐变: linear-gradient(180deg, \#FF44FF, \#AA44FF)

└── 阴影渐变: linear-gradient(135deg, \#AA44FF, \#7722CC)

像素艺术调色板 (4色限制):

├── 高光: \#EEDDFF

├── 主色: \#AA44FF

├── 阴影: \#7722CC

└── 轮廓: \#441188

2.1.3 特效色

特效色:

├── 光束: 对应Agent颜色的渐变发光

├── 爆炸: \#FFFFFF → \#FFFF00 → \#FF8800 → \#FF0000

└── 文字: \#00FF00 (终端绿) + 扫描线效果

2.2 字体规范

标题字体: \'Press Start 2P\', cursive (Google Fonts)

正文字体: \'VT323\', monospace (Google Fonts)

字号层级:

├── 大标题: 32px

├── 小标题: 16px

├── 正文: 14px

└── 像素数字: 24px (得分、血量等)

2.3 像素美学原则

1. 所有图像使用 image-rendering: pixelated

2. 边框使用 4px 实线 + 阴影营造3D像素感

3. 动画使用逐帧或低帧率(12fps)保持复古感

4. 使用有限调色板(每元素不超过4种颜色)

5. 所有图标使用 16x16 或 32x32 像素网格

三、响应式设计规范

3.1 响应式断点

桌面端 (≥1440px): 完整4-Agent布局

平板端 (768-1439px): 3-Agent布局，侧边栏收起

移动端 (\<768px): 2-Agent布局，垂直堆叠

3.2 布局比例

整体布局比例: 16:9 宽屏比例

├── Header: 80px

├── Agent Cluster: 上边缘弧形排列

├── Battle Stage: 中央 60%区域

└── Control Panel: 底部 120px

四、里程碑规划

里程碑1: 基础视觉系统 (M1)

目标: 建立完整的视觉风格体系 交付物:

 色彩系统CSS变量定义

 像素字体引入与配置

 基础UI组件样式（按钮、面板、边框）

 响应式布局框架

验收标准: 所有基础视觉元素可在不同分辨率下正确显示

里程碑2: 角色视觉设计 (M2)

目标: 完成6种像素角色的视觉设计 交付物:

 PACMAN吃豆人精灵图设计

 INVADER太空侵略者精灵图设计

 FROGGER青蛙精灵图设计

 DONKEY KONG大金刚精灵图设计

 TETRIS俄罗斯方块精灵图设计

 GHOST幽灵精灵图设计

验收标准: 每个角色包含待机、攻击、受伤、超级模式等状态动画

里程碑3: 特效系统 (M3)

目标: 实现完整的视觉特效体系 交付物:

 粒子系统基础框架

 爆炸特效动画

 光束发射特效

 得分浮动动画

 CRT扫描线效果

验收标准: 特效运行帧率稳定在60fps

五、参考资源

5.1 像素艺术工具

Aseprite (专业像素画软件)

Pixilart (在线像素画)

Lospec (像素调色板库)

5.2 字体资源

Google Fonts: Press Start 2P, VT323

5.3 灵感参考

电影《像素大战》(Pixels, 2015)

游戏《太空侵略者》《吃豆人》视觉风格

现代参考: agar.io, slither.io 的简洁竞技UI

六、文档关联

本文档与以下设计文档相关联:

02-layout-and-components.md - 布局与组件设计

03-animation-and-effects.md - 动画与特效规范

04-interaction-design.md - 交互设计

05-collaboration-visualization.md - 多智能体协作可视化

06-system-architecture.md - 系统架构与监控

07-implementation-guide.md - 实现指南与里程碑
