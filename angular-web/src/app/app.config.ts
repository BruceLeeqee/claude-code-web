import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideClaudeCore } from './core/claude-core.providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    ...provideClaudeCore({
      defaultSessionId: 'web-default',
      api: {
        baseUrl: 'https://api.anthropic.com',
        defaultModel: {
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-latest',
          temperature: 0.2,
          maxTokens: 4096,
        },
      },
    }),
  ],
};
