# 40 · Company Integrations Framework (Entrega 15)

Un solo lugar para saber, por empresa, qué plataformas están conectadas. **Esta entrega no conecta nada**: no hay APIs reales, OAuth, sincronización, cron ni simulaciones.

## Qué es
`src/platform/integrations/` define contratos, estados, capacidades y configuración **no secreta**. No depende de Real Estate, Marketing, CRM, Blueprints, Business Profile ni AI Employees; todos ellos dependen de él.

- **Conectores definidos (11)**: Google Business Profile, Google Analytics 4, Google Search Console, Meta Business, Facebook Pages, Instagram Business, Google Calendar, Gmail / Google Workspace, Shopify, Cloudflare, MakaWallet. Ninguno tiene adaptador todavía (`available: false`).
- **Estados permitidos**: Sin configurar · Pendiente · Conectada · Error · Disponible próximamente. Un conector sin adaptador siempre se muestra «Disponible próximamente»; no se puede configurar.
- **Estado por empresa**: tabla `ci_integrations` (migración 2400), una fila por empresa y conector, sin DELETE. `credential_ref` es solo una referencia a una futura bóveda de secretos; nunca se guarda un token ni un secreto.
- **Agregar plataformas** (TikTok, YouTube, LinkedIn, X, Stripe, HubSpot, Slack, Notion, Dropbox, OneDrive, Zapier…): una definición más en el catálogo. El Core y el framework no cambian.

## Contratos para otros sistemas
- `state(actor)` → mapa `conector → estado`.
- `requirements(state, needs)` → `{ ready, missing:[{key,status}] }`. Solo «Conectada» está lista; sin estado no se asume nada.
- `employeeCheck(state, employeeKey)` + `EMPLOYEE_NEEDS`: cada AI Employee que necesita una plataforma (Marketing Manager → Meta; SEO → Search Console; Analytics → GA4…) pregunta antes de trabajar y dice exactamente qué falta.
- `report(actor, key, status, lastSyncAt)`: gancho para los futuros adaptadores. No está expuesto por la API.

## Company Health (solo reglas, sin IA)
`health.ts` es una función pura. Pesos: Perfil 25 · DNA 20 · Integraciones 20 · Equipo IA 20 · Blueprint 15. Integraciones = (conectadas + ½ pendientes) / disponibles. Si todavía no existe ningún conector disponible, esa área **no aplica** y su peso se reparte entre las demás (se explica en pantalla). Niveles: 🟢 Excelente ≥90 · 🟢 Saludable ≥75 · 🟡 Requiere atención ≥55 · 🟠 Riesgo ≥35 · 🔴 Crítico.
Es explicable: cada área muestra `% × peso = puntos` y los puntos perdidos, ordenados de mayor a menor.
La composición (`src/composition/company-health.ts`) es el único archivo que lee Business Profile, Blueprint, AI Employees e integraciones juntos. Una fuente ilegible cuenta 0 %, nunca una suposición.

## Pantallas
- `/app/integrations`: tabla Nombre · Estado · Última sincronización · Health · Tipo · Configurar, y el estado de cada AI Employee. Se añadió sobre la pantalla del Integrations Hub existente, que no se modificó.
- Mission Control: tarjetas «Estado de integraciones» y «Company Health».
- `/app/business-profile`: secciones Perfil · DNA · Integraciones · Health.

## CEO AI
Consulta el estado: `ex.ig.*` («No puedo recomendar mejoras SEO porque Search Console no está conectado», «No existen métricas de Analytics», «Google Business todavía no está configurado») y marca como `blocked` el trabajo que necesita datos reales de una plataforma no conectada. Sin el puerto, no afirma nada.

## API (`/api/v1/company-integrations`)
`GET /` · `PUT /{connector}` (409 `coming_soon` si no existe) · `GET /health` · `GET /employees`. CSRF en mutaciones. El acceso usa el módulo `integrations`.

## Límites
Sin OAuth, tokens, sincronización ni cron. Hoy ningún conector puede quedar «Conectada»; los estados Pendiente / Conectada / Error existen en el contrato y en los tests con un catálogo de prueba, y se activarán cuando exista un adaptador.
