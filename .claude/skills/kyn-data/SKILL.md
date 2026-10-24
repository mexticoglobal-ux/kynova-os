---
name: kyn-data
description: Diseña y ejecuta cambios en la capa de datos de KYNOVA OS en Supabase — tablas, columnas, relaciones, migraciones, políticas RLS por tenant, seeds, tipos generados y acceso desde lib/db/. Úsalo siempre que una tarea cree o cambie esquema, almacene un dato nuevo, toque permisos de acceso a datos o aislamiento entre tenants, aunque el usuario solo diga "guardar", "tabla", "campo", "base de datos", "migración" o "RLS".
---

# kyn-data

## Propósito
Evolucionar el modelo de datos de forma segura, aislada por tenant, reversible y trazable.

## Cuándo usarlo
- Crear, modificar o eliminar tablas, columnas, relaciones, índices o restricciones.
- Crear o cambiar políticas RLS o roles de acceso.
- Añadir o cambiar funciones de acceso en `lib/db/`.
- Preparar seeds de desarrollo.
- Como primer paso de `kyn-module` cuando el módulo necesita persistencia.

## Cuándo NO usarlo
- Leer o consultar datos existentes sin cambiar el esquema ni el acceso.
- Cambios solo de UI, de API sin persistencia nueva o de prompts.
- Aplicar migraciones a producción: corresponde a `kyn-ship` con aprobación explícita.

## Entradas
- Necesidad de negocio y entidades implicadas.
- Patrones de acceso: quién lee, crea, actualiza y borra cada entidad, y con qué filtros.
- Alcance de tenant de cada entidad.
- Sensibilidad de los datos y requisitos de retención.
- Estado actual: `docs/STATE.md`, ADRs de datos vigentes y esquema existente.

## Procedimiento
1. Confirmar clasificación mínima **L** y workflow **W3**; trabajar en modo plan hasta la aprobación.
2. Leer `docs/STATE.md`, los ADRs relevantes de datos y `docs/DOMAIN.md` para las entidades implicadas.
3. Inspeccionar el esquema actual en modo solo lectura; buscar tablas, columnas o funciones existentes reutilizables.
4. Diseñar el cambio: entidades, columnas, tipos, relaciones, restricciones, índices y `tenant_id`.
5. Diseñar las políticas RLS por operación y por rol, partiendo de denegar todo.
6. Si el cambio es destructivo, dividirlo en fase de expansión y fase de contracción en migraciones separadas.
7. Definir el plan de reversión de cada migración.
8. Redactar el ADR si el cambio es estructural.
9. Presentar el brief con diseño, políticas, plan de reversión y ADR; esperar aprobación.
10. Crear una migración nueva por cada cambio lógico con esquema, restricciones, índices y RLS juntos.
11. Aplicar las migraciones sobre una base local limpia.
12. Regenerar los tipos de `lib/db/`.
13. Crear o actualizar las funciones de acceso en `lib/db/` y, si los datos cruzan capas, los esquemas de `lib/contracts/`.
14. Añadir o actualizar tests de aislamiento entre tenants para cada operación permitida y denegada.
15. Actualizar seeds solo con datos ficticios.
16. Ejecutar typecheck, lint, tests y build.
17. Ejecutar `/security-review`.
18. Actualizar `docs/DOMAIN.md` si surgieron conceptos de dominio nuevos.
19. Entregar el cierre a `kyn-ship`.

## Checklist
- [ ] Clasificación L, modo plan y aprobación obtenida.
- [ ] Reutilización evaluada antes de crear estructuras nuevas.
- [ ] Toda tabla nueva tiene `tenant_id`, RLS y políticas por operación.
- [ ] Migraciones nuevas, atómicas y con plan de reversión.
- [ ] Cambios destructivos divididos en expansión y contracción.
- [ ] Índices y restricciones definidos.
- [ ] Migraciones aplicadas sobre base local limpia.
- [ ] Tipos regenerados; ninguno editado a mano.
- [ ] Acceso solo por `lib/db/`; contratos actualizados si aplica.
- [ ] Tests de aislamiento entre tenants en verde.
- [ ] ADR creado si el cambio es estructural.
- [ ] `/security-review` sin hallazgos altos o críticos abiertos.

## Definición de terminado
Migraciones aplicadas limpias en local, tipos regenerados, tests de aislamiento en verde, typecheck,
lint, tests y build en verde, `/security-review` sin hallazgos altos o críticos, ADR y `docs/DOMAIN.md`
actualizados cuando aplica, y nada aplicado a producción.

## Salida
- Migraciones nuevas en `supabase/migrations/`.
- Tipos regenerados y funciones de acceso en `lib/db/`.
- Esquemas actualizados en `lib/contracts/` si aplica.
- Tests de aislamiento entre tenants.
- ADR en `docs/decisions/` si aplica.
- Resumen para `kyn-ship`: cambios de esquema, políticas, plan de reversión, resultados de verificación y orden de despliegue requerido.
