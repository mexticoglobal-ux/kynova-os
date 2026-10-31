# ADR-0006: Persistir los perfiles de empresa en Supabase (Postgres + RLS + Auth) y aislar cada empresa por tenant

| Campo | Valor |
|-------|-------|
| **Estado** | Aceptado, condicionado al Go del spike (2026-10-31; ver "Adenda") |
| **Fecha** | 2026-10-28 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | datos · tenancy · seguridad · plataforma |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
- **Hoy no existe persistencia, autenticación ni tenancy** (D7). `wrangler.jsonc` no tiene bindings de datos y `package.json` no tiene dependencias de base de datos. El Business Assessment v0 vive solo en memoria, por diseño.
- **El Blueprint describe un Core que el código no tiene.** Afirma que ya existen autenticación, roles y CRM base; en este repositorio no hay nada de eso (verificado en el código).
- **No verificado:** que esa capacidad exista en una línea de trabajo paralela (por ejemplo, el ZIP de la Entrega 15). No se ha abierto el ZIP ni se ha confirmado ninguna otra línea. Es una hipótesis, no un hecho, y este ADR no depende de ella; si se confirmara, se revisaría antes de aprobar.
- El Blueprint define el Business DNA como "un perfil permanente por empresa" (Fase 2), lo que exige guardar datos por empresa.
- Invariantes ya aprobados: RLS por tenant (`AGENTS.md` §7.1), acceso solo por `lib/db/` con tipos generados (§7.3), secretos solo en Wrangler o GitHub (§7.6) y aprobación explícita en producción (§7.11). `docs/DOMAIN.md`: el Tenant es la unidad de aislamiento y todo dato de negocio pertenece a uno solo.
- Plataforma: Workers vía OpenNext con `nodejs_compat`, entornos `preview` y `production`; producción sin desplegar (D23). WSL sin distribución (D19): no hay Docker local. Las páginas estáticas actuales se sirven con `s-maxage` largo (D21); las respuestas con datos de usuario no pueden heredarlo.
- Piloto previsto: Nova Marketing Studio, como una empresa más.

## Problema
¿Dónde y cómo se guardan los perfiles de empresa y sus evaluaciones, con qué autenticación y con qué garantía de que una empresa nunca accede a datos de otra?

## Criterios de decisión
- Cumplir los invariantes aprobados sin modificarlos.
- Aislamiento garantizado por la base de datos, no solo por disciplina del código.
- Autenticación segura sin construirla desde cero.
- Compatible con Workers y OpenNext (hoy **no verificado**, ver el spike).
- Ruta gradual que permita un piloto reversible, sin datos reales hasta tener los controles.

## Opciones consideradas

### Opción A: Supabase (Postgres + RLS + Auth)
- **Ventajas:** RLS nativo, por lo que cumple §7.1 tal como está escrito. Autenticación incluida (enlace o código por correo; MFA y SSO disponibles para fases posteriores, según el plan contratado). Migraciones y tipos generados ya permitidos en `.claude/settings.json`. Postgres estándar, portable. Ya previsto en el stack (`CLAUDE.md`).
- **Inconvenientes:** proveedor y cuenta nuevos. Latencia entre Workers y la región de Supabase. Una clave secreta que custodiar. Sin Docker local (D19): se usa un proyecto remoto de desarrollo. **La compatibilidad de la sesión SSR con OpenNext sobre Workers no está verificada.**
- **Coste y esfuerzo:** medio.

### Opción B: Cloudflare D1 (SQLite) con autenticación propia o de librería
- **Ventajas:** misma plataforma, sin proveedor adicional, baja latencia, binding nativo y migraciones con Wrangler.
- **Inconvenientes:** D1 no tiene RLS: el aislamiento dependería de filtrar `tenant_id` en cada consulta del código (un olvido filtra datos) y obligaría a modificar §7.1 con otro ADR. D1 no incluye autenticación: sesiones, recuperación de acceso y MFA habría que construirlos o integrar una librería, que también tendría que pasar por un spike en Workers. Peor encaje para análisis relacional futuro (KYNOVA Score, agregados). La variante "una D1 por empresa" da aislamiento físico, pero exige enlazar cada base en el despliegue y no escala bien: descartada.
- **Coste y esfuerzo:** medio-alto.

**Descartadas sin análisis detallado:** guardar en `localStorage` (sin tenancy ni multidispositivo), KV o R2 (no relacionales, sin aislamiento declarativo) y un proveedor de autenticación externo con D1 (dos proveedores y aún sin RLS).

## Decisión
**Opción A, condicionada al resultado del spike de autenticación.** Supabase aporta base de datos, aislamiento y autenticación con los invariantes ya aprobados. Si el spike da No-Go, este ADR se revisa antes de implementar nada.

### Autenticación
- Supabase Auth. Acceso inicial por correo con enlace o código, sin contraseñas. MFA y SSO diferidos.
- **Diseño objetivo, sujeto al spike:** sesión por cookies en servidor, con el JWT del usuario reenviado a la base para que RLS se aplique en cada consulta. La compatibilidad con OpenNext sobre Workers **no se da por resuelta**.
- La pertenencia usuario ↔ empresa ↔ rol vive en `memberships`. Roles iniciales: propietario y miembro. Roles finos requieren un ADR posterior.

### Spike de autenticación (obligatorio antes de implementar)
Son dos preguntas distintas y ninguna está resuelta. Se prueban con datos ficticios, en `npm run preview` (workerd local) y en el Worker de Preview.

**A. Integración del cliente en el runtime de Workers.** ¿Se empaqueta y ejecuta el cliente de Supabase en el Worker que genera OpenNext, con `nodejs_compat`?
1. El build de OpenNext termina sin errores y el Worker queda dentro del límite del plan en uso (hoy ≈ 1,3 MiB comprimido).
2. Una consulta autenticada desde un Route Handler devuelve solo las filas de la empresa del usuario de prueba.
3. Sin errores de runtime ni APIs de Node no soportadas en los logs.
4. La clave secreta no aparece en ningún paquete del cliente (revisión del build).

**B. Sesión SSR mediante cookies.** ¿Funciona leer y escribir la sesión en Server Components, Route Handlers y, si hiciera falta, middleware?
1. El acceso por enlace o código inicia sesión y deja cookies `HttpOnly`, `Secure` y `SameSite`.
2. La sesión persiste entre navegaciones y recargas en el servidor.
3. La renovación del token funciona. Si requiere middleware, se demuestra que funciona en OpenNext sobre Workers con la versión de Next.js del proyecto; si no, se documenta la alternativa.
4. Cerrar sesión, una cookie caducada o una manipulada devuelven 401 o redirección, nunca datos.
5. Ninguna respuesta con datos de usuario se sirve desde una caché compartida (`Cache-Control: private, no-store`), a la vista de D21.
6. Mismo comportamiento en `npm run preview` y en el Worker de Preview.

**Resultado:** un informe breve con Go, No-Go o Go con alternativa. Un No-Go detiene la implementación y obliga a revisar este ADR (otra estrategia de sesión o reconsiderar la Opción B).

### Aislamiento entre empresas
1. Toda tabla de negocio lleva `tenant_id` no nulo, RLS habilitado y políticas por operación, creadas en la misma migración (`.claude/rules/data.md`).
2. Política base: denegar por defecto; una fila solo es visible o editable si su `tenant_id` pertenece a las membresías activas del usuario.
3. **Permisos mínimos además de RLS.** RLS no basta: en tablas, vistas y funciones se parte de ningún privilegio y se concede solo lo necesario.
   - **Tablas:** sin privilegios por defecto para los roles de la API (`anon`, `authenticated`); `GRANT` explícito por operación y, cuando aplique, por columna.
   - **Vistas:** no deben saltarse RLS. Se ejecutan con los permisos de quien consulta (`security_invoker`, a verificar con la versión de Postgres del proyecto) o no se exponen por la API.
   - **Funciones:** las `SECURITY DEFINER` y las llamadas por RPC se revisan una a una, con `search_path` fijo y `EXECUTE` revocado a `PUBLIC` y `anon`, concedido solo a quien corresponda. Las funciones auxiliares de las políticas viven en un esquema no expuesto.
4. **Clave secreta (service role).** Nunca llega al navegador: ni en variables `NEXT_PUBLIC_*`, ni en el paquete del cliente, ni en logs, ni en respuestas. Vive solo en servidor, como secreto de Wrangler. **No se usa para consultar en nombre de un usuario**, porque se salta RLS: las consultas de usuario usan siempre el JWT del usuario. Solo se emplea en tareas administrativas internas, acotadas y auditadas.
5. Todo acceso pasa por `lib/db/`. El cliente para flujos de usuario no puede construirse con la clave secreta.
6. **Pruebas obligatorias de aislamiento y permisos**, con dos empresas de prueba: ninguna puede leer, crear, modificar ni borrar datos de la otra; el rol `anon` no accede a ninguna tabla; un usuario sin membresía recibe cero filas; insertar o actualizar con un `tenant_id` ajeno es rechazado; las vistas y funciones expuestas no devuelven datos de otra empresa.
7. `workspace_id` queda reservado (nulo) en v1; el aislamiento de seguridad es por tenant (`docs/DOMAIN.md` §5).

### Datos del Business Profile (v1)
Solo lo que el usuario aporta, con valores cerrados. Clasificación: **Confidencial**. Sin datos personales de los clientes finales de la empresa.

| Entidad | Contenido | Notas |
|---------|-----------|-------|
| `tenants` | id, nombre, estado, fecha de alta | Unidad de aislamiento |
| `memberships` | usuario, tenant, rol | Base de las políticas RLS |
| `business_profiles` | tenant (único), nombre comercial, país, idioma, sector, tamaño del equipo, canal principal, gestión de clientes, principal problema, objetivo, versión del cuestionario, autoría y fechas | Un perfil vigente por empresa; los seis campos de respuesta son los del Assessment v0 |
| `assessment_runs` (fase posterior) | respuestas, módulos recomendados con su evidencia, versión de las reglas, fecha | Instantáneas inmutables para comparar y auditar |

Reglas: se guarda solo por acción explícita del usuario (el aviso "no se guarda" se sustituye por uno que diga qué se guarda). Sin textos libres en v1. NEX solo usa lo que está en el perfil. La exportación y el borrado del perfil se implementan y verifican antes de cualquier dato real; sus plazos y alcance están **pendientes de decisión**. Los campos del Blueprint que el Assessment v0 no recoge (modelo de ingresos, madurez digital, uso de IA) quedan fuera y requieren ampliar el cuestionario.

### Datos en Preview y en el piloto
- **Desarrollo y Preview usan solo datos ficticios:** dos empresas de prueba con nombres inventados, usuarios de prueba con buzones controlados por el equipo (no de terceros) y perfiles generados con valores del cuestionario. El seed contiene solo datos ficticios (`.claude/rules/data.md`). Nunca se copian datos reales a estos entornos.
- **No se usan datos reales de Nova Marketing Studio** hasta que estén implementados y verificados, con evidencia: (1) autenticación, (2) aislamiento entre dos empresas, (3) exportación del perfil y (4) borrado del perfil. Hasta entonces, cualquier prueba con personas de Nova usa datos ficticios.
- El entorno donde vivirían los datos reales del piloto **no se decide aquí** y Preview no lo es por defecto.

### Región, retención y eliminación (pendientes de decisión)
- **Región de Supabase:** sin decidir. Es una decisión técnica y contractual; elegirla no demuestra por sí sola cumplimiento normativo. Los requisitos legales aplicables requieren un análisis aparte, antes de cualquier dato real.
- **Retención:** plazos para el perfil y para las instantáneas de evaluaciones, sin decidir.
- **Eliminación:** qué se borra, quién puede pedirlo, si hay plazo de gracia y cuánto tardan en desaparecer los datos de las copias de seguridad, sin decidir.

### Ruta gradual hasta el piloto
| Fase | Alcance | Puerta de salida |
|------|---------|------------------|
| 0. Aprobación | Aprobar este ADR y las decisiones pendientes que bloquean (región, retención y eliminación, entorno de datos reales); proyectos Supabase de desarrollo y preview con datos ficticios; secretos en Wrangler y GitHub; `.mcp.json` solo lectura | ADR aceptado |
| 1a. Spike de autenticación | Los criterios A y B anteriores, sin datos de negocio | Informe Go o No-Go |
| 1b. Núcleo sin producto | Solo con Go: migraciones de `tenants`, `memberships` y `business_profiles` con RLS y permisos mínimos; `lib/contracts/` y `lib/db/`; tipos generados; inicio de sesión en Preview | Pruebas de aislamiento y permisos en verde; `/security-review` sin hallazgos altos |
| 2. Guardar el Assessment | Botón "Guardar en mi perfil" con sesión iniciada (opt-in); sin sesión sigue en memoria; precarga del perfil; exportación y borrado del perfil; avisos y traducciones en 8 idiomas | Flujo probado en escritorio y móvil; exportación y borrado verificados |
| 3. Piloto con datos reales | Solo si se cumplen las cuatro condiciones y en el entorno aprobado. Nova Marketing Studio se da de alta como una empresa normal, por invitación (1–3 usuarios), sin reglas, opciones ni datos propios en el código | Opinión de los usuarios sobre la claridad de las recomendaciones; sin hallazgos de seguridad abiertos |
| 4. Producción | Tras resolver D23 y D21: proyecto de producción, copias con recuperación a un punto en el tiempo (su retención condiciona la eliminación efectiva), despliegue con aprobación, más empresas | Aprobación explícita (§7.11) |

## Consecuencias
- **Positivas:** aislamiento garantizado por la base. Autenticación probada. Invariantes intactos. Fases reversibles. Ningún dato real antes de tener los controles.
- **Negativas:** proveedor y coste nuevos. Dependencia de red entre Workers y Supabase. Más entornos que mantener. Hasta la Fase 2 nada se guarda.
- **Riesgos y mitigaciones:**

| Riesgo | Mitigación |
|--------|------------|
| Una política RLS mal escrita o permisos demasiado amplios filtran datos | Denegar por defecto, permisos mínimos, pruebas de aislamiento y permisos en CI y revisión de seguridad |
| Fuga de la clave secreta o uso para consultar por un usuario | Solo secreto de Wrangler, jamás en el cliente; el cliente de usuario no admite esa clave; rotación |
| Autenticación incompatible con OpenNext sobre Workers (no verificada) | Spike con criterios y Go/No-Go; no se implementa antes |
| Latencia entre Workers y Supabase | Región cercana (pendiente de decisión), consultas por lote; Hyperdrive solo con otro ADR |
| Sin Docker local (D19) | Proyecto remoto de desarrollo; `supabase db push` bajo aprobación |
| Línea de trabajo paralela o ZIP con autenticación (no verificado) | No se asume; se confirma antes de aprobar |
| Los controles técnicos o la región se toman por cumplimiento normativo | Análisis legal aparte antes de datos reales |

## Impacto en el framework
- **Reglas no negociables (`AGENTS.md` §7) afectadas:** ninguna se modifica; cumple §7.1, §7.3, §7.6 y §7.11.
- **RULES afectadas:** `data` y `security` se aplican íntegras.
- **Skills afectados:** `kyn-data` primero y después `kyn-module`.
- **Módulos afectados:** Settings (membresías y perfil) y NEX (Assessment persistido).
- **Dependencias nuevas justificadas por este ADR, solo si el spike da Go:** `@supabase/supabase-js` y `@supabase/ssr`.

## Plan de implementación
La ruta gradual anterior. Cada fase es una tarea L (flujo W3) con su propio brief y aprobación.

## Plan de reversión
Hasta la Fase 2 basta con eliminar los proyectos de desarrollo y preview: el Assessment v0 en memoria sigue funcionando. Con datos reales, se exportan los perfiles y se migran a otro Postgres estándar.

## Verificación
- Informe del spike con Go, No-Go o alternativa.
- Pruebas de aislamiento y de permisos mínimos en verde.
- Revisión del build: la clave secreta no está en ningún paquete del cliente.
- Exportación y borrado del perfil probados con datos ficticios.
- Tipos regenerados; lint, typecheck, tests y build en verde.
- `/security-review` sin hallazgos altos o críticos abiertos.

## Decisiones pendientes de aprobación
1. Supabase (Opción A) como base y autenticación, frente a D1, condicionado al Go del spike.
2. Criterios de éxito del spike (A y B) y qué hacer ante un No-Go.
3. Acceso inicial por correo con enlace o código, sin contraseñas; MFA y SSO después.
4. Roles iniciales (propietario y miembro) y un tenant por empresa; workspace diferido.
5. **Región de Supabase:** pendiente, con análisis legal aparte.
6. **Retención y eliminación:** plazos, alcance y tratamiento de las copias de seguridad, pendientes.
7. **Entorno para datos reales del piloto:** pendiente; Preview solo con datos ficticios.
8. Alcance del perfil v1 (las seis respuestas más nombre comercial, país e idioma) y guardado opt-in.
9. Verificar la existencia de una línea de trabajo paralela o del ZIP de la Entrega 15 (no verificado).

## Adenda 2026-10-31: aceptación condicionada y núcleo previo al Go

**Decidido (Jeffrey Hernandez, al aprobar el plan de la Fase 1b):**
- Se aceptan las decisiones 1 a 4 y 8: Supabase como Opción A, criterios del spike y plan ante un No-Go, acceso por correo sin contraseñas, roles propietario y miembro con un tenant por empresa, y perfil v1 con guardado opt-in.
- Las decisiones 5 a 7 (región, retención y eliminación, entorno de datos reales) siguen pendientes. **Solo bloquean datos reales**, no el desarrollo ni las pruebas con datos ficticios. La 9 sigue sin verificar.
- **Estado del código: "Implementado, pendiente de Go".** El núcleo de la Fase 1b se escribe antes de que el spike se valide contra un proyecto Supabase real porque es inerte sin `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`. No se considera validado, ni se usa con datos reales, ni se despliega a producción hasta cumplir los criterios A y B (incluidos A1 y B4: un JWT vigente puede seguir aceptándose tras revocar la sesión; sin validar). Un No-Go obliga a revisar este ADR.

**Autorizado por esta adenda (`AGENTS.md` §7.7):**
- Carpeta de primer nivel `supabase/`: migraciones, `seed.sql` ficticio y pruebas SQL en `supabase/tests/`. Las migraciones solo se aplican a proyectos de desarrollo desechables, desde el editor SQL, nunca con `supabase db push` sin aprobación.
- Un job de GitHub Actions con un Postgres efímero que aplica la migración y ejecuta las pruebas de aislamiento y permisos mínimos. El esquema `auth` simulado de ese job no es el de Supabase: que pase demuestra el SQL, no la integración. La misma batería debe ejecutarse también en el proyecto de desarrollo.
- Endpoint `/api/profile` (lectura y escritura del perfil de la empresa del usuario), sin pantallas nuevas ni textos en 8 idiomas: la interfaz pertenece a la Fase 2.

**Compromisos que se mantienen:** consultas solo con el JWT del usuario (nunca clave secreta), tipos de base de datos generados y no escritos a mano (`lib/db/database.types.ts` se genera cuando exista el proyecto; entretanto las filas se validan con los contratos), sin DELETE del perfil en v1 y sin datos reales de Nova.

## Revisión
Tras el spike, al cerrar el piloto, o antes si se necesita SSO, varias regiones o roles por workspace.

## Referencias
- `AGENTS.md` §7, `.claude/rules/data.md`, `.claude/rules/security.md`, `.claude/skills/kyn-data/SKILL.md`
- `docs/DOMAIN.md` §4–5, `docs/modules/nex.md`, `docs/modules/settings.md`
- `docs/decisions/0002-opennext-cloudflare-workers.md`
- `docs/blueprints/README.md` y los dos blueprints (solo lectura)
