import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected username = '';
  protected password = '';
  protected errorMessage = '';
  protected isSubmitting = false;

  protected async submit(): Promise<void> {
    if (this.isSubmitting) {
      return;
    }

    const username = this.username.trim();
    const password = this.password;

    if (!username || !password) {
      this.errorMessage = 'Introduce usuario y contrasena.';
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = '';

    try {
      await this.authService.login(username, password);
      const redirectToParam = this.route.snapshot.queryParamMap.get('redirectTo') || '/';
      const redirectTo = redirectToParam.startsWith('/') ? redirectToParam : '/';
      await this.router.navigateByUrl(redirectTo);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.errorMessage = 'Usuario o contrasena incorrectos.';
      } else {
        this.errorMessage = 'No se pudo iniciar sesion. Intentalo de nuevo.';
      }
    } finally {
      this.isSubmitting = false;
    }
  }
}
