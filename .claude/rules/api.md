---
paths:
  - "app/api/**"
  - "middleware.ts"
---

# Regla API

## Propósito
Garantizar endpoints seguros, predecibles, validados y compatibles con el runtime de Cloudflare Workers.

## Cuándo se activa
Al crear o modificar rutas en `app/api/` o el middleware de la aplicación.

## Reglas obligatorias
1. Toda entrada (body, query, params, headers relevantes) se valida contra su contrato antes de usarse.
2. Toda salida cumple su contrato.
3. Autenticación y resolución de tenant ocurren antes de cualquier lógica; los endpoints públicos se declaran explícitamente.
4. La autorización se comprueba por recurso y por tenant, nunca solo por sesión.
5. El handler orquesta; la lógica de negocio vive en `lib/`.
6. Métodos HTTP declarados explícitamente; los no soportados responden 405.
7. Códigos de estado correctos y formato de error uniforme definido como contrato.
8. Los errores al cliente son genéricos: sin stack traces, consultas ni detalles internos.
9. Solo APIs compatibles con Workers; sin dependencias de Node no soportadas por el runtime.
10. Sin estado en memoria entre peticiones; el estado persiste en Supabase, KV o R2.
11. Límites de tamaño de payload y timeouts definidos en toda llamada externa.
12. Rate limiting en endpoints públicos, de autenticación y de IA.
13. Mutaciones críticas idempotentes.
14. Respuestas de NEX en streaming.
15. CORS restrictivo; sin comodines en orígenes con credenciales.
16. Logging estructurado con identificador de petición; sin PII ni contenido de prompts.
17. Un cambio incompatible de contrato requiere una nueva versión del endpoint.

## Checklist
- [ ] Entrada y salida validadas contra contratos.
- [ ] Autenticación, tenant y autorización por recurso verificados.
- [ ] Métodos, códigos de estado y formato de error correctos.
- [ ] Compatible con el runtime de Workers.
- [ ] Timeouts, límites de payload y rate limiting aplicados.
- [ ] Logs sin PII.
- [ ] Sin cambios incompatibles de contrato no versionados.

## Definición de terminado
Verificación de `AGENTS.md` §7.9 en verde, tests de validación, autorización y aislamiento entre tenants
en verde, checklist completo y `/security-review` ejecutado si el endpoint es público o maneja datos sensibles.

## Referencias
- Acceso a datos, IA, contratos y secretos: `AGENTS.md` §7.2–7.4 y §7.6.
- Presupuestos de latencia: `framework/standards/performance.md`.
