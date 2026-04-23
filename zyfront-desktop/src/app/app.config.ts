/**
 * 应用级配置：注册路由与 Claude Core（API、默认会话、代理到本地 bridge）。
 */
import { ApplicationConfig } from '@angular/core';
import { RouteReuseStrategy } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { NZ_ICONS } from 'ng-zorro-antd/icon';
import {
  ApiOutline,
  AppstoreOutline,
  BorderOutline,
  BranchesOutline,
  CheckOutline,
  ClockCircleOutline,
  CloseOutline,
  CodeOutline,
  DatabaseOutline,
  DeploymentUnitOutline,
  DoubleRightOutline,
  FileOutline,
  FileTextOutline,
  FolderOpenOutline,
  FolderOutline,
  Loading3QuartersOutline,
  LineChartOutline,
  MinusOutline,
  PauseOutline,
  PlusOutline,
  ReloadOutline,
  RobotOutline,
  SafetyOutline,
  SearchOutline,
  SettingOutline,
  StepBackwardOutline,
  StepForwardOutline,
  TeamOutline,
  ThunderboltOutline,
} from '@ant-design/icons-angular/icons';

import { routes } from './app.routes';
import { provideClaudeCore } from './core/zyfront-core.providers';
import { CustomRouteReuseStrategy } from './core/route-reuse.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    { provide: RouteReuseStrategy, useClass: CustomRouteReuseStrategy },
    provideAnimations(),
    {
      provide: NZ_ICONS,
      useValue: [
        ApiOutline,
        BorderOutline,
        BranchesOutline,
        CheckOutline,
        ClockCircleOutline,
        CloseOutline,
        DatabaseOutline,
        Loading3QuartersOutline,
        LineChartOutline,
        MinusOutline,
        PauseOutline,
        PlusOutline,
        ReloadOutline,
        SafetyOutline,
        SearchOutline,
        SettingOutline,
        StepBackwardOutline,
        StepForwardOutline,
        CodeOutline,
        FileTextOutline,
        FileOutline,
        FolderOutline,
        FolderOpenOutline,
        RobotOutline,
        DeploymentUnitOutline,
        DoubleRightOutline,
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
          provider: 'anthropic',
          model: 'MiniMax-M2.7',
          temperature: 0.2,
          maxTokens: 4096,
        },
      },
    }),
  ],
};
