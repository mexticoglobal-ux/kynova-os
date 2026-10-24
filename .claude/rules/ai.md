---
paths:
  - "lib/ai/**"
  - "prompts/**"
  - "app/api/nex/**"
---

# Regla IA

## Propósito
Garantizar que NEX y toda capacidad de IA sean seguras, intercambiables entre proveedores, medibles y controladas en coste.

## Cuándo se activa
Al crear o modificar la capa de IA (`lib/ai/`), prompts de producto (`prompts/`), sus evals o la API de NEX.

## Reglas obligatorias
1. Ningún SDK de proveedor se importa fuera de `lib/ai/`.
2. Modelos y parámetros se definen en el registro de configuración de `lib/ai/`, no en el código que los consume.
3. Los prompts viven en `prompts/`, versionados; sin prompts de producto embebidos en el código.
4. Todo prompt tiene evals en `prompts/evals/`; ningún cambio de prompt se acepta sin evals en verde.
5. Instrucciones del sistema separadas de los datos de usuario, documentos y resultados de herramientas.
6. Todo contenido externo al prompt se trata como no confiable frente a inyección de instrucciones.
7. La salida del modelo se valida contra su contrato y se sanea antes de mostrarse o usarse.
8. La salida del modelo nunca se ejecuta como código, consulta o comando.
9. Un prompt nunca mezcla datos de distintos tenants.
10. Se envía al modelo el mínimo de datos personales necesario.
11. Las herramientas de NEX operan con mínimo privilegio y dentro del tenant del usuario.
12. Toda acción de NEX con efectos requiere confirmación explícita del usuario.
13. Timeouts, reintentos acotados y proveedor de respaldo definidos para cada capacidad.
14. Límites de tokens por petición y presupuesto de uso por tenant.
15. Se registra modelo, tokens, latencia, coste y tenant; nunca el contenido sensible.
16. Caché del gateway solo para peticiones deterministas y sin datos privados.

## Checklist
- [ ] Modelo tomado del registro de configuración.
- [ ] Prompt versionado en `prompts/` con evals actualizados y en verde.
- [ ] Datos de usuario separados de las instrucciones.
- [ ] Salida validada contra contrato y saneada.
- [ ] Aislamiento por tenant y minimización de datos personales verificados.
- [ ] Acciones con efectos sujetas a confirmación.
- [ ] Timeouts, respaldo, límites de tokens y registro de uso configurados.

## Definición de terminado
Verificación de `AGENTS.md` §7.9 y evals en verde con el proveedor principal y el de respaldo, checklist
completo y `/security-review` ejecutado si se añaden herramientas o acciones con efectos.

## Referencias
- Acceso a modelos vía `lib/ai/` y AI Gateway: `AGENTS.md` §7.2.
- NEX en el dominio: `docs/DOMAIN.md` §3.
- Selección de modelos, versionado de prompts, evals y autonomía: `framework/standards/ai.md`.
