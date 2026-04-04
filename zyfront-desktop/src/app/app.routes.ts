/**
 * 应用路由：默认进入聊天页，另有设置与自检页。
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
    path: '**',
    redirectTo: '',
  },
];
