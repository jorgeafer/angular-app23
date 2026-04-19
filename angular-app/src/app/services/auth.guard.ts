import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router, UrlSegment } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const isAuthenticated = await authService.ensureSession();

  return isAuthenticated
    ? true
    : router.createUrlTree(['/login'], {
        queryParams: { redirectTo: state.url }
      });
};

export const loginGuard: CanMatchFn = async (_route, segments: UrlSegment[]) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const isAuthenticated = await authService.ensureSession();
  const attemptedUrl = `/${segments.map((segment) => segment.path).join('/')}`.replace(/\/+$/, '') || '/';

  return isAuthenticated
    ? router.createUrlTree([attemptedUrl === '/login' ? '/' : attemptedUrl])
    : true;
};
