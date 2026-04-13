/**
 * 应用路由：原型多页面组件化（Angular + ng-zorro）。
 */
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'workbench',
  },
  {
    path: 'workbench',
    loadComponent: () =>
      import('./features/prototype/workbench/workbench.page').then((m) => m.WorkbenchPageComponent),
  },
  {
    path: 'prototype',
    loadComponent: () =>
      import('./features/prototype/prototype-shell.component').then((m) => m.PrototypeShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'skills' },
      {
        path: 'models',
        loadComponent: () =>
          import('./features/prototype/models/models.page').then((m) => m.ModelsPrototypePageComponent),
      },
      {
        path: 'graph',
        loadComponent: () => import('./features/prototype/graph/graph.page').then((m) => m.GraphPrototypePageComponent),
      },
      {
        path: 'collaboration',
        loadComponent: () =>
          import('./features/prototype/collaboration/collaboration.page').then((m) => m.CollaborationPrototypePageComponent),
      },
      {
        path: 'skills',
        loadComponent: () => import('./features/prototype/skills/skills.page').then((m) => m.SkillsPrototypePageComponent),
      },
      {
        path: 'plugins',
        loadComponent: () => import('./features/prototype/plugins/plugins.page').then((m) => m.PluginsPrototypePageComponent),
      },
      {
        path: 'quant',
        loadComponent: () => import('./features/prototype/quant/quant-shell.component').then((m) => m.QuantShellComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
          {
            path: 'dashboard',
            loadComponent: () =>
              import('./features/prototype/quant/pages/quant-dashboard.page').then((m) => m.QuantDashboardPageComponent),
          },
          {
            path: 'strategy-canvas',
            loadComponent: () =>
              import('./features/prototype/quant/pages/quant-strategy-canvas.page').then(
                (m) => m.QuantStrategyCanvasPageComponent,
              ),
          },
          {
            path: 'backtest',
            loadComponent: () => import('./features/prototype/quant/pages/quant-backtest.page').then((m) => m.QuantBacktestPageComponent),
          },
          {
            path: 'live-trading',
            loadComponent: () =>
              import('./features/prototype/quant/pages/quant-live-trading.page').then((m) => m.QuantLiveTradingPageComponent),
          },
          {
            path: 'risk-control',
            loadComponent: () =>
              import('./features/prototype/quant/pages/quant-risk-control.page').then((m) => m.QuantRiskControlPageComponent),
          },
          {
            path: 'traceability',
            loadComponent: () =>
              import('./features/prototype/quant/pages/quant-traceability.page').then((m) => m.QuantTraceabilityPageComponent),
          },
        ],
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'workbench',
  },
];
