---
paths:
  - "lib/**"
  - "config/**"
  - "types/**"
  - "package.json"
  - "tsconfig.json"
  - "next.config.*"
  - "wrangler.jsonc"
  - "docs/decisions/**"
---

# Regla Arquitectura

## Propósito
Preservar una arquitectura modular, coherente y evolutiva durante toda la vida de KYNOVA OS.

## Cuándo se activa
Al tocar la capa compartida (`lib/`), configuración, tipos globales, dependencias, configuración de plataforma o ADRs.

## Reglas obligatorias
1. Dirección de dependencias: `app/` → módulos → `lib/contracts/`; la infraestructura (`lib/db/`, `lib/ai/`) solo se consume desde servidor.
2. `lib/contracts/` no depende de ninguna otra capa del proyecto.
3. Un módulo no importa internals de otro; la comunicación entre módulos es solo por contratos.
4. Los tipos que cruzan capas viven en `lib/contracts/`; `types/` contiene solo tipos globales de entorno y UI.
5. La configuración de aplicación se centraliza en `config/`; sin valores de configuración dispersos.
6. Cada responsabilidad tiene una única ubicación; no se duplican utilidades, tipos, esquemas ni constantes.
7. Reutilizar antes que extender; extender antes que crear; crear exige justificar por qué lo existente no sirve.
8. Ninguna carpeta de primer nivel, dependencia relevante ni cambio de plataforma sin ADR.
9. Los ADRs vigentes se respetan; para cambiarlos se crea un ADR nuevo que los sustituya.
10. Todo el código de servidor es compatible con el runtime de Cloudflare Workers y no guarda estado entre peticiones.
11. Nombres: componentes React en `PascalCase`; el resto de archivos y carpetas en minúsculas con `kebab-case`.
12. Sin código muerto, comentado o duplicado en los cambios.
13. Toda deuda técnica aceptada se registra en `docs/STATE.md`.
14. Las abstracciones se introducen solo cuando existen al menos dos usos reales.

## Checklist
- [ ] Dirección de dependencias respetada.
- [ ] Sin imports entre internals de módulos.
- [ ] Sin duplicación de utilidades, tipos, esquemas ni constantes.
- [ ] Tipos compartidos en `lib/contracts/`.
- [ ] ADR creado o actualizado si hubo decisión estructural.
- [ ] Compatible con Workers y sin estado entre peticiones.
- [ ] Convenciones de nombres cumplidas.
- [ ] Deuda técnica registrada.

## Definición de terminado
Typecheck, lint, tests y build en verde; checklist completo; ninguna regla no negociable de `AGENTS.md` §7
vulnerada; los ADRs y `docs/STATE.md` reflejan el estado real del código.
