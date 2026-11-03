---
paths:
  - "app/api/**"
  - "middleware.ts"
  - "lib/**"
  - "supabase/**"
  - "wrangler.jsonc"
  - ".mcp.json"
  - ".github/**"
  - "next.config.*"
  - "package.json"
---

# Regla Seguridad

## Propósito
Proteger los datos de los clientes, las credenciales y la plataforma con controles por defecto y mínimo privilegio.

## Cuándo se activa
Al tocar API, middleware, lógica de servidor, datos, configuración de plataforma, CI, MCP o dependencias.

## Reglas obligatorias
1. Secretos solo en Wrangler secrets, GitHub secrets o variables de entorno locales no versionadas.
2. Ningún secreto en código, logs, prompts, mensajes de error, commits ni configuración versionada.
3. Todo endpoint no público exige autenticación; la autorización se valida por recurso y por tenant.
4. Toda entrada externa se valida; toda salida hacia HTML, URLs o consultas se codifica o parametriza.
5. Cabeceras de seguridad obligatorias: CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` y protección de framing.
6. Cookies de sesión `HttpOnly`, `Secure` y `SameSite`.
7. Protección CSRF en toda mutación basada en cookies.
8. Webhooks entrantes verificados por firma y con protección frente a repetición.
9. Rate limiting en autenticación, endpoints públicos y endpoints de IA.
10. Mínimo privilegio en tokens, bindings de Cloudflare, roles de Supabase y servidores MCP.
11. Workflows de GitHub con permisos mínimos declarados y acciones de terceros fijadas a un commit.
12. Dependencias nuevas revisadas: mantenidas, con licencia compatible y sin vulnerabilidades altas o críticas conocidas.
13. El lockfile se versiona y se respeta.
14. Errores genéricos al cliente; el detalle queda solo en logs internos sin PII.
15. Las acciones sensibles (permisos, pagos, exportaciones, borrados) quedan auditadas.
16. Toda tarea con bandera de seguridad o datos ejecuta `/security-review` antes de cerrarse.

## Checklist
- [ ] Sin secretos expuestos en ningún artefacto.
- [ ] Autenticación y autorización por recurso y tenant verificadas.
- [ ] Entrada validada y salida codificada.
- [ ] Cabeceras, cookies y CSRF correctos donde aplique.
- [ ] Rate limiting y verificación de webhooks donde aplique.
- [ ] Mínimo privilegio en tokens, bindings, roles y MCP.
- [ ] Dependencias nuevas revisadas.
- [ ] Acciones sensibles auditadas.

## Definición de terminado
Checklist completo; `/security-review` sin hallazgos altos o críticos abiertos; typecheck, lint, tests y
build en verde; cualquier riesgo aceptado queda registrado como deuda en `docs/STATE.md`.
