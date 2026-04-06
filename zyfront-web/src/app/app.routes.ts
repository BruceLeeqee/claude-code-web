/**
 * 应用路由：默认进入聊天页，另有设置页、自检页与技能管理页。
 */
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/chat/chat.page').then((m) => m.ChatPageComponent),
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPageComponent),
  },
  {
    path: 'self-check',
    loadComponent: () => import('./features/self-check/self-check.page').then((m) => m.SelfCheckPageComponent),
  },
  {
    path: 'skills',
    loadComponent: () => import('./features/skills/skills.page').then((m) => m.SkillsPageComponent),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
