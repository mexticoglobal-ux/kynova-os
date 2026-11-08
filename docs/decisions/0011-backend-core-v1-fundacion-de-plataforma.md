# ADR-0011: El Backend Core v1 es una capa de contratos y utilidades sin conexiones, sobre la que se conectará todo

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-07 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | plataforma · datos · tenancy · seguridad · api |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
La base de datos ya tiene migraciones con tenancy, RLS por empresa, funciones de negocio y un registro de auditoría (ADR-0006, ADR-0010), y los módulos de la plataforma son contratos y simulaciones locales. Falta la capa que une ambas cosas: cómo se configura cada entorno, dónde viven los secretos, cómo publican eventos y auditoría los módulos, cómo se organizan los archivos, qué política de RLS le toca a cada tabla nueva y cómo se observa el sistema. Esa capa debe existir **antes** de conectar proveedores de IA, mensajería o pagos, y antes de activar datos reales (que siguen bloqueados por las puertas del ADR-0006 y por la aprobación de producción de `AGENTS.md` §7.11).

## Problema
¿Cómo se construye el Backend Core de modo que todo lo demás (los módulos, KOE, los proveedores) pueda conectarse encima sin cambiar lo que ya funciona ni activar nada todavía?

## Criterios de decisión
- No romper el inicio de sesión, el middleware, las migraciones ni los módulos actuales.
- Ningún secreto en el código; ninguna llamada externa; ninguna dependencia nueva.
- Todo aislado por empresa desde el diseño.
- Verificable con pruebas, sin base de datos real.
- KOE no se modifica: solo podrá leer.

## Opciones consideradas

### Opción A: Escribir ya las migraciones y activar el RLS de las tablas nuevas
- **Ventajas:** el esquema real existe desde ahora.
- **Inconvenientes:** exige validar contra Supabase real (bloqueado), fija columnas antes de que los módulos se conecten y activa políticas sin pruebas de aislamiento sobre datos.
- **Coste y esfuerzo:** alto, con riesgo de rehacer.

### Opción B: Contratos y utilidades puras en `lib/backend/`, con un solo cliente perezoso en `lib/db/`
- **Ventajas:** se prueba sin red; fija las reglas (eventos, auditoría, políticas, rutas de archivos, entorno) antes del esquema; no toca nada de lo existente.
- **Inconvenientes:** hay que mantener los contratos alineados con las migraciones (lo hace una prueba).
- **Coste y esfuerzo:** medio.

## Decisión
**Opción B.** `lib/backend/` contiene el Environment Manager, el Secrets Manager, los ayudantes de cifrado y hash (Web Crypto, sin dependencias), el Event Bus interno, la auditoría central encadenada, la arquitectura de Storage, los contratos de las once áreas de datos, las políticas de RLS **escritas y auditadas pero no activadas**, la arquitectura de Auth (sesión, rutas protegidas, permisos por módulo), la observabilidad (logs, trazas, salud, métricas) y los bloques de rendimiento (arranque perezoso, pool, caché). `lib/db/core-clients.ts` es el único lugar donde el núcleo construye un cliente de Supabase, y lo hace de forma perezosa. Una vista de solo lectura (`koeView`) es lo único que KOE podrá usar.

Reglas que quedan fijadas y probadas:
- Una entidad que ya existe en `supabase/migrations` se marca `existing` y una nueva `planned`; una prueba lo compara con el SQL.
- Las políticas planeadas copian los tipos de protección que ya aplican las migraciones (`read`, `rw`, `rw_delete`, `admin` sobre `private.is_member`, `can_write` e `is_admin`); ninguna se aplica ni aparece en una migración.
- Ninguna credencial se guarda: una llave o un secreto de webhook es un hash; un evento nunca lleva una credencial; un log solo oculta datos sensibles.
- El Event Bus solo registra: nada lo consume todavía, y KOE lo leerá por empresa y por cursor.
- La auditoría central solo crece y cada registro se encadena al anterior de su empresa.
- Ningún módulo importa todavía el Backend Core.

## Consecuencias
- **Positivas:** los módulos, KOE y los proveedores tendrán un solo punto de conexión; las reglas de aislamiento y de secretos están probadas antes del primer dato real; no cambia ningún comportamiento actual.
- **Negativas:** hasta conectarlo, parte de lo construido no lo usa nadie. Los contratos de columnas son una primera versión que se ajustará al escribir las migraciones.
- **Riesgos y mitigaciones:** que un contrato se desalinee del SQL, mitigado con las pruebas que lo comparan; que alguien active el RLS sin pasar por su propia decisión, mitigado con `RLS_STATE` y la prueba que exige que ninguna migración contenga las políticas planeadas.

## Referencias
ADR-0006 (persistencia y aislamiento), ADR-0009 (autonomía por niveles), ADR-0010 (arquitectura de datos), `docs/platform/README.md` §21.
