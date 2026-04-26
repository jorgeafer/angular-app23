# MiCartera

Aplicacion Angular para visualizar una cartera financiera desde Excel y enriquecer la ficha de detalle con datos Morningstar a traves de un backend interno.

## Desarrollo

Frontend Angular con proxy al backend:

```bash
npm run start:ui
```

Backend Morningstar interno:

```bash
npm run start:api
```

Arranque conjunto:

```bash
npm run start:full
```

La app Angular queda en `http://localhost:4200/` y el backend en `http://localhost:3000/`.

## Backend Morningstar

El backend expone:

```bash
GET /api/health
GET /api/morningstar/assets?assetType=fund|equity&idType=isin|ticker|symbol|performanceId&id=<valor>
GET /api/yahoo/assets?assetType=fund|equity&idType=isin|ticker|symbol|performanceId&id=<valor>
```

Por defecto usa proveedor `mock`, configurable con variables de entorno.

Ejemplo de configuracion:

```bash
copy .env.example .env
```

Variables relevantes:

```bash
API_PORT=3000
MORNINGSTAR_PROVIDER=mock
MORNINGSTAR_BASE_URL=
MORNINGSTAR_API_KEY=
MORNINGSTAR_API_TOKEN=
MORNINGSTAR_TIMEOUT_MS=10000
MORNINGSTAR_FUND_VIEW_IDS=
MORNINGSTAR_EQUITY_VIEW_IDS=
YAHOO_ALLOW_INSECURE_TLS=false
AUTH_USERNAME=admin
AUTH_PASSWORD=admin1234
AUTH_SESSION_TTL_MS=43200000
AUTH_COOKIE_NAME=portfolio_session
AUTH_SECURE_COOKIES=false
```

## Login de acceso

La aplicacion ahora exige autenticacion antes de mostrar la cartera o los detalles.

- El frontend redirige a `/login` si no existe una sesion valida.
- El backend protege todos los endpoints bajo `/api`, salvo `/api/health` y `/api/auth/*`.
- La sesion se guarda en una cookie `HttpOnly` con expiracion configurable.

Credenciales por defecto en desarrollo si no defines variables de entorno:

```bash
usuario: admin
contrasena: admin1234
```

Conviene cambiarlas en tu `.env` antes de usarlo fuera de local.

## Modos de proveedor

- `mock`: devuelve respuestas simuladas para desarrollo local.
- `dws`: conecta con Morningstar Direct Web Services usando `POST /direct-web-services/v1/investments`, JWT Bearer y listas de `viewId` configurables.

## Morningstar Direct Web Services

Para una conexion real con DWS:

```bash
MORNINGSTAR_PROVIDER=dws
MORNINGSTAR_BASE_URL=https://<tu-host-morningstar>
MORNINGSTAR_API_TOKEN=<jwt-o-token>
MORNINGSTAR_FUND_VIEW_IDS=viewId1,viewId2,viewId3
MORNINGSTAR_EQUITY_VIEW_IDS=viewId1,viewId2,viewId3
```

Notas:

- `MORNINGSTAR_BASE_URL` debe apuntar al host base de tu tenant/region.
- El backend llama a `POST /direct-web-services/v1/investments`.
- Los `viewId` dependen de tu configuracion/licencia en Morningstar.
- El backend intenta normalizar la respuesta real a un contrato comun para Angular mediante heuristicas de mapeo.

## TODO de backend real

- Ajustar los `viewId` exactos para fondos y acciones disponibles en tu tenant Morningstar.
- Afinar el mapeo de campos una vez veamos payloads reales de tu entorno.
- Resolver identificadores alternativos para acciones cuando no haya ISIN.

## Yahoo Finance

La ficha de detalle puede enriquecerse tambien desde Yahoo Finance usando el endpoint interno:

```bash
GET /api/yahoo/assets
```

Notas:

- El backend resuelve simbolos a partir de `isin`, `ticker` o `symbol`.
- Para algunos entornos Windows puede ser necesario:

```bash
YAHOO_ALLOW_INSECURE_TLS=true
```

solo si tu runtime local falla por certificados al acceder a Yahoo. Es una opcion de desarrollo y no deberia activarse en produccion.

## Build

```bash
npm run build
```

## Tests

```bash
npm test
```

## Reinicio local

En Windows puedes reiniciar backend y frontend con una sola orden:

```bash
npm run restart:local
```

Ese script:

- libera los puertos `3000` y `4200`
- aparta un posible `portfolio.db-journal` atascado
- arranca API y UI otra vez
- valida que ambos endpoints respondan

## Deploy automatico a AWS

El repositorio incluye un workflow de GitHub Actions en `.github/workflows/deploy-main.yml`.

Cada push a `main`:

- conecta por SSH a la EC2
- hace `git pull`
- ejecuta `npm ci`
- ejecuta `npm run build`
- reinicia `pm2`
- recarga `nginx`

Configura en GitHub antes de activarlo:

- secret `EC2_HOST`
- secret `EC2_USER`
- secret `EC2_SSH_PRIVATE_KEY`
- secret `EC2_HOST_FINGERPRINT`
- variable `EC2_APP_DIR`

Valor esperado de `EC2_APP_DIR` en tu despliegue actual:

```bash
/home/ubuntu/angular-app23
```
