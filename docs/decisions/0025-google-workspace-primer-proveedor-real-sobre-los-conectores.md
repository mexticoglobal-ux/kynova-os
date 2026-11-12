# ADR-0025: Google Workspace, el primer proveedor real sobre la arquitectura de conectores

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-12 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | integraciones · google · oauth · workers · multiempresa · seguridad |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
El Sprint 40 dejó la arquitectura de conectores (ADR-0024) con adaptadores simulados. Este sprint conecta el primer proveedor real, Google Workspace (Gmail, Google Calendar y Google Drive), **sin modificar** KOE, el AI Gateway, el Runtime, el Backend Core, el Financial Router, las plantillas, el Architect ni la arquitectura de conectores (`connectors.ts`).

## Decisión
1. **Una capa real, como `lib/ai/`:** `lib/integrations/google/` es el único lugar que habla con Google. Solo `core.ts` llama a la red (`fetch` inyectado, sin SDK). No importa el Backend Core ni la base de datos: el cifrado y el Secrets Manager se le **entregan** (`Cipher`, `SecretsAccess`), así que se cablea en la raíz de composición (una ruta), no aquí.
2. **OAuth real:** PKCE `S256`, `state` de un solo uso atado a la empresa, intercambio del código con el verificador de **esa** autorización (se borra aunque falle), `refresh token` obligatorio (sin él se rechaza y no se guarda nada), renovación automática (cinco minutos antes de vencer, y una vez ante un 401), renovación anticipada (`renewDue`) y revocación (en Google y en la bóveda, y la bóveda se vacía aunque Google no responda).
3. **Credenciales:** el `client id` y el `client secret` de KYNOVA se leen **solo por nombre y propósito** del Secrets Manager (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`); nunca están en un estado, una fila de la bóveda, un registro ni la vista. Los tokens viven **cifrados** en una bóveda (`TokenVault`, con la referencia como contexto del cifrado) y el estado solo guarda `secret:oauth-<id>`.
4. **Scopes mínimos:** la capa pide solo los scopes del manifiesto del Sprint 40 que la empresa elige (lectura y escritura por separado, todo apagado al inicio) y verifica que Google los concedió antes de cada operación. **Hallazgo:** con ese manifiesto no se pueden autorizar los **borradores** de Gmail ni **crear/cambiar etiquetas** (Google exige `gmail.compose` o `gmail.modify`). Las funciones existen y están probadas, pero la operación responde `scopeInsufficient` sin llamar a Google; habilitarlas exige ampliar el manifiesto (cambio en `connectors.ts`, con aprobación). Drive crea, mueve y comparte solo lo que KYNOVA creó (`drive.file`), y lee todo con `drive.readonly`.
5. **Gmail:** buscar, leer, adjuntos, etiquetas (lectura), enviar y responder en el mismo hilo (Re:, In-Reply-To y References del original), con cada encabezado validado contra saltos de línea, direcciones validadas, asunto no ASCII codificado y adjuntos como multipart. **Calendar:** leer, crear, actualizar y cancelar eventos con invitados, disponibilidad y horarios libres. **Drive:** buscar (consulta escapada), leer, crear carpetas, subir, mover y compartir con **una persona** (nunca «cualquiera», nunca propietario).
6. **Worker → Connector → Google:** `GoogleWorkspace.request` pasa **siempre** por `reduceConnectors` (`action.request`): solo un Worker activo de la empresa; leer necesita el permiso encendido y corre al instante; todo lo que sale de la plataforma queda esperando a una persona (`approve`), y un Worker no puede aprobar. Un agente de IA nunca llega a Google.
7. **Multiempresa:** una conexión por empresa y app, tokens separados por referencia, un `state` solo sirve a la empresa que lo inició y **una cuenta de Google pertenece a una sola empresa** (si otra empresa la autoriza, se rechaza y los tokens recién obtenidos se revocan en Google).
8. **Sincronización real** de correo, eventos y archivos (cuentas, cursores y el último elemento como identificador opaco, **nunca contenido**); solo un éxito real mueve la última sincronización.
9. **Connected Apps:** nuevo panel «Google Workspace» con cuenta, estado, última sincronización, último correo, último evento, último archivo y **Health Score** (0–100: estado 40, renovación 20, frescura de la sincronización 20, tasa de éxito reciente 20; una caída de Google resta). La pantalla sigue siendo una simulación local con datos de ejemplo.
10. **Pruebas contra un Google simulado** (`fake-google.ts`): responde lo que Google respondería y verifica lo que Google verificaría (token, vencimiento, scopes, credenciales de la app y verificador PKCE).

## Consecuencias
- **Honestidad sobre lo probado:** **ninguna llamada se ha hecho a Google real.** Las URL, los nombres de scopes y los formatos de respuesta son los de la documentación pública conocida y se confirman en la primera conexión real; hacerla exige crear la aplicación en Google Cloud (pantalla de consentimiento, redirección, credenciales) y **la verificación de Google para los scopes restringidos de Gmail y Drive** (puede incluir una evaluación de seguridad externa). Sin eso, la conexión real solo funciona con usuarios de prueba.
- **Límites que la arquitectura de conectores impone (no se tocó):** el reductor simula el resultado de una escritura aprobada y de una sincronización, y no tiene un evento para un **fallo real** del proveedor; por eso el resultado real vive en el registro de ejecuciones y la actividad de esta capa (sin contenido), y una revocación real se muestra como «Error / autorizar de nuevo» desde la actividad. Se recomienda un evento `connection.fail` en un sprint aparte.
- **Pendiente con aprobación propia:** (a) las rutas `start` y `callback` y su cableado con el Backend Core (cifrado, Secrets Manager con la lista de nombres de Google, sesión y empresa), lo que además exige actualizar las guardas de importación del Backend Core; (b) la bóveda persistente (tabla cifrada con RLS); (c) un planificador que llame a `renewDue` y a `sync`; (d) hilar el estado de los Workers de KOE al entorno; (e) ampliar el manifiesto si se quieren borradores y etiquetas; (f) subida reanudable para archivos de más de 5 MB.
- **No hecho a propósito:** ninguna credencial, token ni llamada real; ninguna migración.

## Referencias
ADR-0009, ADR-0016 (mismo patrón que `lib/ai/`), ADR-0024, `lib/integrations/google/google.test.ts`.
