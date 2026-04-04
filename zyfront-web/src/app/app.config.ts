/**
 * 应用级配置：注册路由与 Claude Core（API、默认会话、代理到本地 bridge）。
 */
import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideClaudeCore } from './core/zyfront-core.providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
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
