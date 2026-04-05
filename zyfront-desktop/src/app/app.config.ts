/**
 * 应用级配置：注册路由与 Claude Core（API、默认会话、代理到本地 bridge）。
 */
import { ApplicationConfig } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { NZ_ICONS } from 'ng-zorro-antd/icon';
import {
  ApiOutline,
  AppstoreOutline,
  CodeOutline,
  DeploymentUnitOutline,
  FileOutline,
  FileTextOutline,
  FolderOpenOutline,
  FolderOutline,
  RobotOutline,
  SearchOutline,
  SettingOutline,
  TeamOutline,
  ThunderboltOutline,
} from '@ant-design/icons-angular/icons';

import { routes } from './app.routes';
import { provideClaudeCore } from './core/zyfront-core.providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimations(),
    {
      provide: NZ_ICONS,
      useValue: [
        ApiOutline,
        SearchOutline,
        SettingOutline,
        CodeOutline,
        FileTextOutline,
        FileOutline,
        FolderOutline,
        FolderOpenOutline,
        RobotOutline,
        DeploymentUnitOutline,
        TeamOutline,
        ThunderboltOutline,
        AppstoreOutline,
      ],
    },
    ...provideClaudeCore({
      defaultSessionId: 'web-default',
      api: {
        // MiniMax Anthropic-compatible endpoint
        baseUrl: 'https://api.minimaxi.com/anthropic',
        defaultModel: {
          provider: 'minimax',
          model: 'MiniMax-M2.7',
          temperature: 0.2,
          maxTokens: 4096,
        },
      },
    }),
  ],
};
