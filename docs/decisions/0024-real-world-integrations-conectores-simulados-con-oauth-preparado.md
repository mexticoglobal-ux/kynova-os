# ADR-0024: Real World Integrations: conectores con una sola interfaz, OAuth preparado y adaptadores simulados

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-12 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | integraciones · oauth · secretos · multiempresa · agentes |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
Los Agentes IA deben poder trabajar sobre las herramientas que ya usan los clientes (correo, calendarios, archivos, WhatsApp, redes y video). El Centro de Integraciones (ADR-0010) cubre canales, pagos y un calendario con un modelo de conexión por proveedor, pero no estos doce servicios, ni OAuth, ni sincronización, ni el camino Agente → Worker → Conector → Proveedor. Se busca dejar la arquitectura lista para conectar cada proveedor en un sprint propio, **sin volver a tocarla** y sin conectar ninguna API real todavía.

## Decisión
1. **Un contrato y un reductor** (`lib/contracts/platform/connectors.ts`, `reduceConnectors`), puro, determinista y multiempresa. Reutiliza los estados y las transiciones de conexión de `integrations.ts` y el modelo de permisos (`Grant`) de `connection.ts`; no toca KOE, el AI Gateway, el Runtime, el Backend Core, el Financial Router, las plantillas ni el Architect. Se numera 0024 por indicación del sprint (el 0023 queda reservado).
2. **Doce conectores, una interfaz** (`ConnectorAdapter`): Gmail, Outlook, Google Calendar, Microsoft Calendar, Google Drive, OneDrive, WhatsApp Business, Facebook Pages, Instagram Business, LinkedIn Company, YouTube y TikTok Business. Cada uno declara proveedor, endpoint de OAuth, permisos (lectura y escritura), tipos de sincronización y qué verificar. **Los endpoints, nombres de permisos y requisitos de revisión son valores de referencia** tomados de la documentación pública conocida: se verifican en el sprint de cada proveedor. Todos los adaptadores son **simulados** (`connected: false`; responden `notConnected`).
3. **Cuatro estados para las personas:** Connected, Disconnected, Pending Authorization y Error, sobre los estados de la plataforma (`degraded` se muestra como Error, `revoked` como Disconnected).
4. **OAuth preparado, nunca credenciales a mano:** una persona inicia el flujo (PKCE `S256`, `state` de un solo uso, vigente 10 minutos y atado a la empresa, retorno solo `https` o `localhost`); el callback lo cierra. Los tokens **no viven en el estado**: solo una referencia `secret:oauth-<id>` (el mismo formato de `connection.ts`) hacia una bóveda que se construirá con el Backend Core. Al desconectar, la referencia pasa a la auditoría para que la bóveda borre el token.
5. **Secrets Manager:** el `client id` y el `client secret` de cada familia (Google, Microsoft, Meta, LinkedIn, TikTok) se leen **solo por nombre** del Secrets Manager existente (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_*`, `META_APP_ID/SECRET`, `LINKEDIN_*`, `TIKTOK_CLIENT_KEY/SECRET`); el contrato solo pregunta si están configurados (`SecretsView.has`) y nunca ve los valores. Sin ellos, el flujo no arranca y el mensaje manda a Wrangler. Las URL de autorización no llevan el `client_id`: el servicio lo añade desde el Secrets Manager.
6. **Cada empresa autoriza solo sus cuentas:** una conexión por empresa y app, un `state` solo sirve a la empresa que lo inició y una cuenta externa pertenece a una empresa a la vez (se libera al desconectar).
7. **Agente IA → Worker → Conector → Proveedor:** una acción solo la pide un Worker activo de la empresa; un agente, una persona o el sistema no pueden pedírsela al conector. Leer exige un permiso concedido por el proveedor y encendido por una persona; lo que sale de la plataforma (enviar, publicar, escribir) **nunca es automático**: queda esperando a una persona (Nivel 3) y un Worker no puede aprobarlo. Todo empieza apagado.
8. **Sincronización** de correos, eventos, archivos, mensajes, videos, publicaciones, leads y comentarios: solo cuentas y cursores, **nunca contenido**. Un acceso vencido falla como reintentable y se recupera al renovarlo; fallas repetidas llevan la conexión a Error y piden autorizar de nuevo.
9. **Salud** por grupo (Google, Microsoft, Meta, YouTube, WhatsApp, LinkedIn, TikTok y Drive), de plataforma (un proveedor caído lo está para todos) y por empresa, con la forma de los chequeos del Backend Core para que un puente la lleve después.
10. **Pantalla Connected Apps** (`/platform/connected-apps`): aplicación, estado, última sincronización, permisos, empresa, botones Conectar y Desconectar y la salud por proveedor. Corre el mismo reductor en el navegador, simulada: no persiste ni contacta a nadie.
11. **Auditoría, Event Bus y RLS:** cada evento aceptado deja una entrada append-only con la forma que el conector del Backend Core ya lee (probado con `Connector`, sin cambiarlo); 5 tablas futuras por empresa, sin columna de token, validadas con `auditPolicies`. Sin migración.

## Consecuencias
- **Pendiente, cada uno con su aprobación:** (a) la bóveda de tokens cifrados (Backend Core) y el servicio que intercambia el código; (b) un puente en `bridges.ts` para llevar el reductor y la salud al Event Bus y a `/api/health`; (c) la migración con RLS; (d) cada proveedor real, uno por sprint, con su revisión de app (Google, Meta, LinkedIn y TikTok la exigen para los permisos que se necesitan) y sus secretos en Wrangler; (e) hilar el estado de los Workers de KOE al entorno del conector.
- **Límites:** los Agentes IA ya no tienen un camino directo, pero el Worker que los atiende todavía no invoca al conector (se verá al conectar el primero); la pantalla es una simulación local con una empresa de ejemplo; no hay renovación programada ni webhooks.
- **No hecho a propósito:** ninguna API real, ningún token real, ninguna credencial en el repositorio.

## Referencias
ADR-0009, ADR-0010, ADR-0014, ADR-0019/0020, `lib/contracts/platform/connectors.test.ts`.
