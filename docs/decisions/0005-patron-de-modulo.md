# ADR-0005: Construir los módulos de negocio con una vista común configurada por módulo

| Campo | Valor |
|-------|-------|
| **Estado** | Aceptado |
| **Fecha** | 2026-10-23 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | módulo · ui |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
La navegación declara 10 secciones y 8 de ellas devuelven 404. `kyn-module` exige un ADR del patrón de módulo antes
del primer módulo. Todavía no existen autenticación, tenancy ni capa de datos, por lo que los módulos se construyen
con datos simulados que deberán sustituirse por datos reales sin rehacer la interfaz.

## Problema
¿Qué estructura comparten los módulos de negocio para ser consistentes, mantenibles y fáciles de conectar a datos reales?

## Criterios de decisión
- Diseño idéntico entre módulos.
- Separación entre presentación, datos y textos.
- Sustitución de datos simulados por datos reales sin tocar la vista.

## Opciones consideradas

### Opción A: Vista común configurada por módulo
- **Ventajas:** una sola implementación de hero, KPIs, tarjetas, tabla y acciones; añadir un módulo es añadir datos y textos.
- **Inconvenientes:** módulos con necesidades muy distintas requerirán vistas propias.
- **Coste y esfuerzo:** bajo.

### Opción B: Páginas a medida por módulo
- **Ventajas:** libertad visual por módulo.
- **Inconvenientes:** mucho código duplicado y riesgo de inconsistencias.
- **Coste y esfuerzo:** alto.

## Decisión
Opción A, con esta estructura:

| Pieza | Ubicación |
|-------|-----------|
| Ruta del módulo | `app/(app)/<módulo>/page.tsx` |
| Vista común | `components/module/ModuleView.tsx` |
| Contrato de datos del módulo | `lib/contracts/module.ts` |
| Datos del módulo (hoy simulados) | `lib/modules/<módulo>/data.ts` |
| Registro de módulos | `lib/modules/registry.ts` |
| Textos del módulo | `lib/i18n/messages/<idioma>.ts` → `modules.<módulo>` |

Un módulo que necesite una vista propia la crea en `app/(app)/<módulo>/_components/` y sigue consumiendo el mismo contrato.

## Consecuencias
- **Positivas:** 8 módulos consistentes; datos reales conectables sustituyendo `data.ts` por consultas vía `lib/db/`.
- **Negativas:** el contrato común limita la variedad visual.
- **Riesgos y mitigaciones:** datos simulados confundidos con reales, mitigado con un aviso visible de datos de demostración en cada módulo.

## Impacto en el framework
- **Reglas no negociables (`AGENTS.md` §7) afectadas:** ninguna; cumple §7.4 y §7.5.
- **RULES afectadas:** ninguna.
- **Skills afectados:** `kyn-module` (este ADR satisface su paso 3).
- **Módulos afectados:** Sales, Marketing, Clients, Properties, Automation, Finance, Analytics, Settings.

## Plan de implementación
1. Crear el contrato, la vista común y el registro.
2. Crear los datos simulados y las rutas de los 8 módulos.
3. Añadir el test de completitud del registro.

## Plan de reversión
Sustituir la vista común por páginas propias; los datos y textos se conservan.

## Verificación
- Las 8 rutas de módulo responden 200 con hero, KPIs, tarjetas, tabla y acciones.
- El test del registro comprueba que cada módulo tiene datos y textos completos.

## Revisión
Al conectar el primer módulo a datos reales.

## Referencias
- `.claude/skills/kyn-module/SKILL.md`
- `docs/modules/README.md`
