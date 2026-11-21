# Cómo ejecutar `migraciones-aplicadas.sql` en Supabase (solo lectura)

> Para: Jeffrey. **Objetivo:** saber con certeza qué migraciones del repositorio están aplicadas en el proyecto de desarrollo, sin cambiar nada. El archivo solo tiene consultas `SELECT`: no crea, modifica ni borra tablas, funciones ni datos, y no lee datos de empresas (solo nombres de objetos).
> No hay que pegar claves ni contraseñas en ningún sitio, ni enviármelas.

## 0. Antes de empezar: confirmar que es el proyecto correcto

1. Abra el panel de Supabase del proyecto de **desarrollo desechable** (no el de producción, si existiera).
2. En la URL del navegador aparece `…/dashboard/project/<ref>`. Anote ese `<ref>`; también está en **Project Settings › General › Reference ID**.
3. Compárelo con el que usa la aplicación: abra `.env.local` en su equipo y mire **solo** la línea `NEXT_PUBLIC_SUPABASE_URL` (tiene la forma `https://<ref>.supabase.co`). Esa URL es pública, pero no copie ninguna otra línea del archivo. **Si el `<ref>` no coincide, deténgase y avíseme.**

## 1. Ejecutar

1. En el panel: **SQL Editor › New query**.
2. Abra [docs/backend/migraciones-aplicadas.sql](migraciones-aplicadas.sql) y copie su contenido completo en la consulta nueva.
3. **Ejecute cada parte por separado** (el editor solo muestra el resultado de la última sentencia si ejecuta todo de una vez): seleccione con el ratón el texto de una parte (desde su línea `-- PARTE n` hasta el `;` final) y pulse **Run** (Ctrl+Enter). Con texto seleccionado, Supabase ejecuta solo la selección.
4. Orden y qué esperar:

| Parte | Qué muestra | Cuántas filas |
|---|---|---|
| 0 (opcional, está comentada) | El registro de la CLI de Supabase. Quite los `--` de la segunda línea para ejecutarla. Si da «relation does not exist», **no es un error**: significa que las migraciones no se aplicaron con la CLI | 0 a 8 |
| **1** | Resumen por migración: `completa`, `ausente` o `PARCIAL: revisar` | **8** |
| 2 | Detalle por objeto, los que faltan (`existe = false`) primero | 109 |
| 3 | Tablas de `public` que no pertenecen a ninguna migración (por ejemplo restos del spike) | las que haya |
| 4 | Columnas que añaden dos migraciones de mejora | 6 |
| 5 | Columnas del tope de llamadas (solo existen si `20261118000100` está aplicada) | 0 o 2 |

## 2. Cómo leer el resultado (parte 1)

| `estado` | Significado | Qué hacer |
|---|---|---|
| `completa` | Existen todos los objetos que esa migración crea | Se da por aplicada (la parte 4 confirma las dos migraciones de «mejora») |
| `ausente` | No existe ninguno | No está aplicada |
| `PARCIAL: revisar` | Existen algunos | **No aplicar nada**; mirar la parte 2 y avisarme: puede ser una migración a medias o pegada a mano |

Un caso esperable: `20261102000000` sale `completa` aunque solo esté `tenancy_core`, porque no crea objetos nuevos; la **parte 4** (columnas `status`, `updated_at`, `role`, `created_at`, `slug`) es la que la distingue. `20261118000100` (presupuesto de IA) debe salir `ausente` y la parte 5 debe dar 0 filas; si sale otra cosa, avíseme antes de continuar.

## 3. Qué enviarme (sin claves)

- El **Reference ID** del proyecto (no la URL con claves).
- La tabla de la **parte 1** (8 filas), en texto o captura.
- De la **parte 2**, solo las filas con `existe = false` (si hay).
- Las partes **3, 4 y 5**.
- Si ejecutó la parte 0: sus filas.

## 4. Qué NO hacer

- No ejecutar ningún archivo de `supabase/migrations/` ni de `supabase/tests/`, ni el `seed.sql`.
- No activar «RLS», no cambiar roles, no crear usuarios, no tocar Authentication ni SMTP desde esta tarea.
- No pegar `.env.local`, `.dev.vars`, claves `anon` / `service_role` ni tokens.
- No usar el resultado para aplicar migraciones por su cuenta: eso lo decidimos juntos después de ver las partes 1 a 5.

## 5. Qué pasa después (no ahora)

Con el resultado se decide, con aprobación explícita, **qué migraciones faltan y en qué orden**. Hoy no se aplica nada, no se asigna presupuesto de IA, no se despliega Preview y no se carga ninguna clave de proveedor.

> Verificación hecha en el repositorio: la consulta se probó en un PostgreSQL 16 local desechable (8 migraciones aplicadas → las 8 `completa`; solo `tenancy_core` → las seis siguientes `ausente`). **No se ha ejecutado en ningún Supabase.** Las partes 4 y 5 se añadieron después; la parte 5 se valida en la misma ejecución local de esta sesión.
