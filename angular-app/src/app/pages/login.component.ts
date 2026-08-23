import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected username = '';
  protected password = '';
  protected errorMessage = '';
  protected isSubmitting = false;

  protected passkeyAvailable = false;
  protected passkeyRegistered = false;
  protected showRegisterPasskey = false;
  protected isPasskeyLoading = false;

  async ngOnInit(): Promise<void> {
    this.passkeyAvailable = await this.authService.passkeySupported();
    if (this.passkeyAvailable) {
      this.passkeyRegistered = await this.authService.passkeyRegistered();
    }
  }

  protected async submit(): Promise<void> {
    if (this.isSubmitting) return;

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

      // After successful password login, offer passkey registration if not yet set up
      if (this.passkeyAvailable && !this.passkeyRegistered) {
        this.showRegisterPasskey = true;
        this.isSubmitting = false;
        return;
      }

      await this.redirectAfterLogin();
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

  protected async loginWithPasskey(): Promise<void> {
    if (this.isPasskeyLoading) return;
    this.isPasskeyLoading = true;
    this.errorMessage = '';
    try {
      await this.authService.loginWithPasskey();
      await this.redirectAfterLogin();
    } catch {
      this.errorMessage = 'La autenticacion biometrica fallo. Intenta con usuario y contrasena.';
    } finally {
      this.isPasskeyLoading = false;
    }
  }

  protected async setupPasskey(): Promise<void> {
    this.isPasskeyLoading = true;
    this.errorMessage = '';
    try {
      await this.authService.registerPasskey();
      this.passkeyRegistered = true;
      this.showRegisterPasskey = false;
      await this.redirectAfterLogin();
    } catch {
      this.errorMessage = 'No se pudo configurar Face ID. Puedes hacerlo mas tarde.';
      this.showRegisterPasskey = false;
      await this.redirectAfterLogin();
    } finally {
      this.isPasskeyLoading = false;
    }
  }

  protected async skipPasskeySetup(): Promise<void> {
    this.showRegisterPasskey = false;
    await this.redirectAfterLogin();
  }

  private async redirectAfterLogin(): Promise<void> {
    const redirectToParam = this.route.snapshot.queryParamMap.get('redirectTo') || '/';
    const redirectTo = redirectToParam.startsWith('/') ? redirectToParam : '/';
    await this.router.navigateByUrl(redirectTo);
  }
}
