
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

  private readonly onRefreshStateEvent = (e: Event) => {
    const detail = (e as CustomEvent<{ isRefreshing: boolean }>).detail;
    this.isRefreshingPrices.set(detail.isRefreshing);
  };

  ngOnInit(): void {
    window.addEventListener('portfolio:refreshState', this.onRefreshStateEvent);
  }

  ngOnDestroy(): void {
    window.removeEventListener('portfolio:refreshState', this.onRefreshStateEvent);
  }

  protected async logout(): Promise<void> {
    await this.authService.logout();
    await this.router.navigate(['/login']);
  }

  protected refreshPrices(): void {
    window.dispatchEvent(new CustomEvent('portfolio:refreshPrices'));
  }

}
