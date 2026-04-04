/**
 * Angular 应用入口：启动根组件并挂载全局 providers（路由、Claude 核心等）。
 */
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
