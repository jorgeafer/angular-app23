import { Routes } from '@angular/router';
import { AssetDetailComponent } from './pages/asset-detail.component';
import { LoginComponent } from './pages/login.component';
import { PortfolioHomeComponent } from './pages/portfolio-home.component';
import { authGuard, loginGuard } from './services/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
    canMatch: [loginGuard]
  },
  {
    path: '',
    component: PortfolioHomeComponent,
    canActivate: [authGuard],
    data: {
      pageTitle: 'Mi cartera',
      pageEyebrow: 'Cartera financiera',
      portfolioKey: 'main',
      detailRoutePrefix: '/activo',
      showDevaLink: true,
      allowedSections: ['FONDOS', 'ACCIONES']
    }
  },
  {
    path: 'deva',
    component: PortfolioHomeComponent,
    canActivate: [authGuard],
    data: {
      pageTitle: 'Cartera de Deva',
      pageEyebrow: 'Fondos de Deva',
      portfolioKey: 'deva',
      detailRoutePrefix: '/deva/activo',
      showMainLink: true,
      allowedSections: ['FONDOS']
    }
  },
  {
    path: 'activo/:id',
    component: AssetDetailComponent,
    canActivate: [authGuard],
    data: {
      portfolioKey: 'main',
      backRoute: '/'
    }
  },
  {
    path: 'deva/activo/:id',
    component: AssetDetailComponent,
    canActivate: [authGuard],
    data: {
      portfolioKey: 'deva',
      backRoute: '/deva'
    }
  },
  {
    path: '**',
    redirectTo: ''
  }
];
