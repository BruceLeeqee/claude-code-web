import { Injectable } from '@angular/core';
import { RouteReuseStrategy, DetachedRouteHandle, ActivatedRouteSnapshot } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class CustomRouteReuseStrategy implements RouteReuseStrategy {
  private storedRoutes = new Map<string, DetachedRouteHandle>();

  private shouldReuse(route: ActivatedRouteSnapshot): boolean {
    const routePath = this.getRoutePath(route);
    return routePath === 'workbench';
  }

  private getRoutePath(route: ActivatedRouteSnapshot): string {
    if (route.routeConfig?.path) {
      return route.routeConfig.path;
    }
    if (route.parent) {
      return this.getRoutePath(route.parent);
    }
    return '';
  }

  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return this.shouldReuse(route);
  }

  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    const path = this.getRoutePath(route);
    if (handle && path) {
      this.storedRoutes.set(path, handle);
    }
  }

  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    const path = this.getRoutePath(route);
    return !!path && !!this.storedRoutes.get(path);
  }

  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const path = this.getRoutePath(route);
    return path ? this.storedRoutes.get(path) ?? null : null;
  }

  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    return future.routeConfig === curr.routeConfig;
  }
}
