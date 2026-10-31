# KYNOVA OS

Sistema operativo empresarial construido con Next.js 15 y desplegado en Cloudflare Workers mediante OpenNext. NEX y los módulos de negocio usan datos de demostración; consulta `docs/STATE.md` para ver el estado actual del proyecto.

## Desarrollo local

Requiere Node.js 22 o posterior.

```bash
npm ci
npm run dev
```

## Cloudflare Workers

El build y la vista previa local usan el entorno `preview` (`kynova-os-preview`):

```bash
npm run build:worker
npm run preview
```

`npm run deploy` publica en el Worker de Preview. `npm run deploy:production` apunta al Worker `kynova-os` y está protegido: úsalo solo con aprobación explícita para un despliegue de producción.

La validación continua en GitHub Actions ejecuta el build para Cloudflare Workers, typecheck, lint, tests y el chequeo de la canaria del spike. No despliega Workers.

## Spike de Supabase

La prueba temporal de autenticación y aislamiento RLS usa datos ficticios y variables locales en `.dev.vars`. Sigue [`docs/supabase-spike/README.md`](docs/supabase-spike/README.md); nunca subas `.dev.vars` ni uses datos reales.
