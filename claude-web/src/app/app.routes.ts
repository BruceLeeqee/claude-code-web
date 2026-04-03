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
    path: '**',
    redirectTo: '',
  },
];
