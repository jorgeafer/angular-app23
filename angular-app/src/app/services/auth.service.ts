import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

type AuthResponse = {
  authenticated: boolean;
  username?: string;
  token?: string;
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private static readonly TOKEN_KEY = 'portfolio_token';

  private readonly http = inject(HttpClient);
  private readonly authState = signal<{ checked: boolean; authenticated: boolean; username: string | null }>({
    checked: false,
    authenticated: false,
    username: null
  });
  private restorePromise: Promise<boolean> | null = null;

  readonly isReady = computed(() => this.authState().checked);
  readonly isAuthenticated = computed(() => this.authState().authenticated);
  readonly username = computed(() => this.authState().username);

  getToken(): string | null {
    return localStorage.getItem(AuthService.TOKEN_KEY);
  }

  async ensureSession(): Promise<boolean> {
    const currentState = this.authState();

    if (currentState.checked) {
      return currentState.authenticated;
    }

    if (!this.getToken()) {
      this.clearState();
      return false;
    }

    if (!this.restorePromise) {
      this.restorePromise = firstValueFrom(this.http.get<AuthResponse>('/api/auth/session'))
        .then((response) => {
          this.setAuthenticatedState(response.username ?? null);
          return true;
        })
        .catch(() => {
          this.clearState();
          return false;
        })
        .finally(() => {
          this.restorePromise = null;
        });
    }

    return this.restorePromise;
  }

  async login(username: string, password: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<AuthResponse>('/api/auth/login', { username, password })
    );

    if (response.token) {
      localStorage.setItem(AuthService.TOKEN_KEY, response.token);
    }

    this.setAuthenticatedState(response.username ?? username.trim() ?? null);
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post<AuthResponse>('/api/auth/logout', {}));
    } finally {
      this.clearState();
    }
  }

  markUnauthenticated(): void {
    this.clearState();
  }

  private setAuthenticatedState(username: string | null): void {
    this.authState.set({
      checked: true,
      authenticated: true,
      username
    });
  }

  private clearState(): void {
    localStorage.removeItem(AuthService.TOKEN_KEY);
    this.authState.set({
      checked: true,
      authenticated: false,
      username: null
    });
  }
}
