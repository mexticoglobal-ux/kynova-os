# Cómo ejecutar `migraciones-aplicadas.sql` en Supabase (solo lectura)

> Para: Jeffrey. **Objetivo:** saber qué migraciones del repositorio están aplicadas en el proyecto de desarrollo, sin cambiar nada. La consulta solo tiene `SELECT`: no crea, modifica ni borra tablas, funciones ni datos, y no lee datos de empresas (solo nombres de objetos). No pegue claves ni contraseñas en ningún sitio.
> La consulta completa se entrega en la respuesta de la sesión (para pegarla sin abrir archivos); el mismo texto está en [migraciones-aplicadas.sql](migraciones-aplicadas.sql).

## 0. Confirmar el proyecto

El proyecto configurado localmente tiene el **Reference ID `hrridjfbrkewpengrmmh`** (leído solo de la URL pública). En el panel de Supabase, **Project Settings › General › Reference ID** (o la URL `…/dashboard/project/<ref>`) debe mostrar exactamente ese valor. **Si no coincide, no ejecute nada y avíseme.**

## 1. Ejecutar

1. **SQL Editor › New query**.
2. Pegue la consulta completa (una sola) y pulse **Run** (Ctrl+Enter).
3. Debe devolver **8 filas**, una por migración.

## 2. Cómo leer el resultado

| Columna | Valores | Significado |
|---|---|---|
| `objetos` | `objetos completos` / `objetos ausentes` / `PARCIAL: revisar` | Lo que **existe ahora** en la base (tablas, funciones y columnas que esa migración crea) |
| `registro_cli` | `registrada` / `no registrada` / `no hay registro de la CLI` | Lo que **dice haber aplicado** el registro de la CLI de Supabase. Es otra cosa: una migración pegada a mano tiene objetos pero no registro |
| `faltan` | lista de objetos | Qué objetos no existen (vacía si están todos) |

- `objetos completos` + `no registrada` o `no hay registro de la CLI`: el esquema está, pero nadie lo registró (típico de migraciones pegadas a mano). Se da por **presente**, no por «registrada».
- `PARCIAL`: no se aplica nada; avíseme (puede ser una migración a medias).
- `20261102000000` (mejora de `tenancy_core`) sale `objetos completos` en una base que solo tenga `tenancy_core`, porque no crea objetos nuevos; se distingue por sus columnas (`tenants.status`, `updated_at`, `memberships.role`, `created_at`, `updated_at`).
- Lo esperable hoy: `20261118000100` (presupuesto de IA) en `objetos ausentes`. Si aparece otra cosa, avíseme antes de continuar.

## 3. Qué enviarme (sin claves)

La tabla de 8 filas (texto o captura) y el Reference ID que muestra el panel.

## 4. Qué NO hacer

- No ejecutar nada de `supabase/migrations/`, `supabase/tests/` ni `seed.sql`.
- No cambiar RLS, roles, usuarios, Authentication ni SMTP.
- No pegar `.env.local`, `.dev.vars`, claves `anon` / `service_role` ni tokens.
- No aplicar migraciones por su cuenta: se decide juntos después de ver el resultado.

> Verificación hecha en el repositorio, en PostgreSQL 16.16 local (no en Supabase): con las 8 migraciones y sin registro → 8 «objetos completos / no hay registro de la CLI»; con un registro simulado de 2 versiones → solo esas 2 «registrada»; con solo `tenancy_core` → las 6 siguientes «objetos ausentes».
