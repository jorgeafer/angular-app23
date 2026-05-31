import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly username = this.authService.username;
  protected readonly showLogout = computed(() => this.authService.isAuthenticated());

  protected async logout(): Promise<void> {
    await this.authService.logout();
    await this.router.navigate(['/login']);
  }

  protected openQuickAdd(): void {
    const currentRoute = this.router.routerState.root.firstChild?.component?.name || '';
    if (currentRoute.includes('PortfolioHome')) {
      window.dispatchEvent(new CustomEvent('portfolio:openAddModal'));
    }
  }
}
