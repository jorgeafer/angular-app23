
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly username = this.authService.username;
  protected readonly showLogout = computed(() => this.authService.isAuthenticated());
  protected readonly isRefreshingPrices = signal(false);
  protected readonly showPasskeySetup = signal(false);
  protected readonly isRegisteringPasskey = signal(false);

  private readonly onRefreshStateEvent = (e: Event) => {
    const detail = (e as CustomEvent<{ isRefreshing: boolean }>).detail;
    this.isRefreshingPrices.set(detail.isRefreshing);
  };

  ngOnInit(): void {
    window.addEventListener('portfolio:refreshState', this.onRefreshStateEvent);
    this.checkPasskeySetup();
  }

  ngOnDestroy(): void {
    window.removeEventListener('portfolio:refreshState', this.onRefreshStateEvent);
  }

  private async checkPasskeySetup(): Promise<void> {
    try {
      const registered = await this.authService.passkeyRegistered();
      this.showPasskeySetup.set(!registered);
    } catch {
      // silently ignore
    }
  }

  protected async setupPasskey(): Promise<void> {
    if (this.isRegisteringPasskey()) return;
    this.isRegisteringPasskey.set(true);
    try {
      await this.authService.registerPasskey();
      this.showPasskeySetup.set(false);
    } catch (err: unknown) {
      const body = (err as { error?: { error?: string } })?.error;
      const msg = body?.error || (err as { message?: string })?.message || String(err);
      console.error('Passkey registration failed:', err);
      alert(`Error al registrar la llave de acceso:\n${msg}`);
    } finally {
      this.isRegisteringPasskey.set(false);
    }
  }

  protected async logout(): Promise<void> {
    await this.authService.logout();
    await this.router.navigate(['/login']);
  }

  protected refreshPrices(): void {
    window.dispatchEvent(new CustomEvent('portfolio:refreshPrices'));
  }

}
