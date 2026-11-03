---
paths:
  - "supabase/**"
  - "lib/db/**"
---

# Regla Datos

## Propósito
Garantizar un modelo de datos íntegro, aislado por tenant, evolutivo y seguro en Supabase.

## Cuándo se activa
Al crear o modificar migraciones, políticas RLS, seeds, configuración de Supabase o la capa de acceso `lib/db/`.

## Reglas obligatorias
1. Toda tabla de negocio tiene `tenant_id` no nulo y políticas RLS explícitas por operación.
2. RLS y políticas se crean en la misma migración que crea la tabla.
3. Las migraciones aplicadas son inmutables; todo cambio va en una migración nueva.
4. Una migración contiene un único cambio lógico y documenta su plan de reversión.
5. Cambios destructivos (eliminar o renombrar) se hacen en dos fases: expandir y después contraer.
6. Convenciones: `snake_case`, tablas en plural, claves primarias UUID, `created_at` y `updated_at` en toda tabla.
7. Índices en claves foráneas, en `tenant_id` y en columnas de filtrado frecuente.
8. Integridad en la base de datos: claves foráneas, `NOT NULL` y restricciones de dominio.
9. Los tipos de `lib/db/` se regeneran tras cada migración.
10. Sin SQL construido por concatenación.
11. La clave de servicio solo se usa en servidor y nunca para eludir RLS en flujos iniciados por usuarios.
12. Datos sensibles minimizados y protegidos.
13. Los seeds contienen solo datos ficticios.

## Checklist
- [ ] Toda tabla nueva tiene `tenant_id`, RLS y políticas por operación.
- [ ] Migración nueva, atómica y con plan de reversión.
- [ ] Sin cambios destructivos en una sola fase.
- [ ] Convenciones de nombres, claves y timestamps cumplidas.
- [ ] Índices y restricciones definidos.
- [ ] Tipos regenerados.
- [ ] Tests de aislamiento entre tenants añadidos o actualizados.

## Definición de terminado
La migración se aplica limpia sobre una base local nueva, tipos regenerados, tests de aislamiento entre
tenants y verificación de `AGENTS.md` §7.9 en verde, checklist completo y `/security-review` ejecutado.

## Referencias
- Tenancy, acceso por `lib/db/`, secretos y aprobación en producción: `AGENTS.md` §7.1, §7.3, §7.6 y §7.11.
- Clasificación L + ADR para cambios de datos: `AGENTS.md` §5.
- Modelado, ciclo de vida y consultas: `framework/standards/data.md`.
