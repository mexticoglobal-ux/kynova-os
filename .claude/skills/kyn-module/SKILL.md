---
name: kyn-module
description: Crea o extiende de punta a punta un módulo de negocio de KYNOVA OS (Dashboard, Sales, Marketing, Clients, Properties, Automation, Finance, Analytics, Settings u otros nuevos) — alcance, contratos, API, integración con datos e IA, interfaz, navegación y documentación del módulo. Úsalo siempre que una tarea añada una sección, pantalla o funcionalidad de negocio que abarque más de una capa, aunque el usuario solo diga "crea la página de ventas", "añade clientes", "módulo", "sección" o "funcionalidad".
---

# kyn-module

## Propósito
Construir módulos de negocio completos, aislados entre sí, coherentes en estructura y listos para crecer.

## Cuándo usarlo
- Crear un módulo nuevo.
- Añadir una funcionalidad que cruce UI, API y lógica de un módulo existente.
- Reestructurar un módulo para alinearlo con el patrón estándar.

## Cuándo NO usarlo
- Ajustes visuales o de texto en una sola vista (workflow W1 con la regla UI).
- Cambios solo de esquema: usar `kyn-data`.
- Cambios solo de NEX o prompts: usar `kyn-ai`.
- Componentes compartidos sin relación con un módulo concreto.

## Entradas
- Nombre del módulo y objetivo de negocio.
- Casos de uso principales y usuarios que los ejecutan.
- Entidades de datos y operaciones necesarias.
- Capacidades de NEX requeridas, si las hay.
- Estado actual: `docs/STATE.md`, `docs/modules/<módulo>.md`, `docs/DOMAIN.md`, ADRs vigentes y `config/site.ts`.

## Procedimiento
1. Clasificar: módulo nuevo o funcionalidad multicapa es **L**; extensión dentro de un patrón existente es **M**.
2. Leer `docs/STATE.md`, `docs/modules/<módulo>.md`, `docs/DOMAIN.md` y los ADRs relevantes.
3. Verificar que existe el ADR del patrón de módulo; si no existe, redactarlo antes del primer módulo con esta estructura:
   rutas e interfaz en `app/<módulo>/` con componentes privados del módulo junto a ellas,
   lógica de servidor en `lib/modules/<módulo>/` y contratos en `lib/contracts/<módulo>/`.
4. Buscar componentes, contratos, funciones y módulos existentes reutilizables.
5. Definir el alcance: casos de uso incluidos y excluidos, entidades, operaciones, permisos y dependencias con otros módulos.
6. Presentar el brief con alcance, capas afectadas, Skills implicados y orden de construcción; esperar aprobación si es L o hay banderas.
7. Construir en este orden y verificar al cerrar cada capa:
   1. Datos: aplicar `kyn-data` si hay persistencia nueva.
   2. Contratos: esquemas de entrada, salida y errores en `lib/contracts/<módulo>/`.
   3. Lógica de servidor: casos de uso en `lib/modules/<módulo>/`, accediendo solo por `lib/db/` y `lib/ai/`.
   4. API: rutas del módulo validadas contra contratos, con autenticación, tenant y autorización por recurso.
   5. IA: aplicar `kyn-ai` si el módulo incorpora capacidades de NEX.
   6. Interfaz: páginas y componentes en `app/<módulo>/` con estados de carga, vacío y error.
8. Registrar o actualizar la entrada del módulo en `config/site.ts`.
9. Comunicar con otros módulos solo mediante contratos; nunca importar sus internals.
10. Añadir tests de la lógica de servidor, de la API y de aislamiento entre tenants.
11. Crear o actualizar `docs/modules/<módulo>.md` con objetivo, casos de uso, entidades, contratos, permisos y dependencias.
12. Ejecutar typecheck, lint, tests y build.
13. Entregar el cierre a `kyn-ship`.

## Checklist
- [ ] Clasificación correcta y aprobación obtenida cuando aplica.
- [ ] ADR del patrón de módulo existente y respetado.
- [ ] Reutilización evaluada.
- [ ] Alcance incluido y excluido definido.
- [ ] Capas construidas en orden: datos, contratos, servidor, API, IA, interfaz.
- [ ] Contratos completos en `lib/contracts/<módulo>/`.
- [ ] Sin imports de internals de otros módulos.
- [ ] Autenticación, tenant y autorización por recurso en la API.
- [ ] Estados de carga, vacío y error en la interfaz.
- [ ] Navegación actualizada en `config/site.ts`.
- [ ] Tests de servidor, API y aislamiento entre tenants.
- [ ] `docs/modules/<módulo>.md` actualizado.

## Definición de terminado
Todos los casos de uso del alcance funcionan de punta a punta, typecheck, lint, tests y build en verde,
las reglas de UI, API, arquitectura y seguridad cumplidas, los Skills `kyn-data` y `kyn-ai` cerrados
cuando se usaron, y la documentación del módulo refleja el estado real.

## Salida
- Módulo en `app/<módulo>/`, `lib/modules/<módulo>/` y `lib/contracts/<módulo>/`.
- Entrada de navegación en `config/site.ts`.
- Tests del módulo.
- `docs/modules/<módulo>.md` creado o actualizado.
- ADR del patrón de módulo si se creó.
- Resumen para `kyn-ship`: casos de uso entregados, capas modificadas, Skills aplicados, resultados de verificación y pendientes.
