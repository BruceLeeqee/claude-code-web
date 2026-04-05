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
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings.page').then((m) => m.SettingsPageComponent),
  },
  {
    path: 'prototype',
    loadComponent: () =>
      import('./features/prototype/prototype-shell.component').then((m) => m.PrototypeShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'models' },
      {
        path: 'models',
        loadComponent: () => import('./features/prototype/models/models.page').then((m) => m.ModelsPrototypePageComponent),
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
    ],
  },
  {
    path: '**',
    redirectTo: 'workbench',
  },
];
