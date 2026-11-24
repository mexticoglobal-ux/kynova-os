# ADR-0037: Paquetes comerciales: suscripción, periodos y asignaciones de consumo sobre el presupuesto existente

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto (diseño para revisar; sin migraciones, sin facturación, sin proveedor de pagos) |
| **Fecha** | 2026-11-26 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | datos · tenancy · coste · ia · seguridad · concurrencia |
| **Sustituye a** | — (amplía ADR-0036) |
| **Sustituido por** | — |

## Contexto
ADR-0036 limita el consumo de IA por empresa y **mes UTC** (`ai_budget_periods`), con reservas atómicas, un tope de llamadas y la regla «sin asignación, presupuesto 0». Eso sirve para una prueba, no para vender un paquete: el paquete tiene **su propio periodo** (desde la fecha de inicio hasta la misma fecha del mes siguiente), un plan contratado, pagos, mejoras, rebajas y cancelaciones, y el consumo debe liquidarse contra el periodo en que se reservó aunque termine después de renovar.

**Reglas comerciales aprobadas (2026-11-26):**
- Periodo de la fecha de inicio a la misma fecha del mes siguiente, conservando la **fecha ancla** y las reglas de meses cortos (29, 30, 31) documentadas en STATE.
- **Zona horaria fijada en la suscripción**; renovación a las 00:00 locales; cambiar el perfil no mueve el periodo.
- **Pago fallido:** no se concede otra asignación; se conservan datos, historial y trabajo manual.
- **Mejora:** exige aceptar el precio y el consumo adicional. **Rebaja:** en la próxima renovación. **Cancelación:** detiene la renovación y mantiene lo pagado hasta el final del periodo.
- **El consumo incluido no se acumula.** Las recargas tienen condiciones independientes, todavía pendientes.

**No decidido y no inventado aquí:** precios, prestaciones, margen, proveedor de pagos y cantidades. El paquete de US$149 es un ejemplo, no un catálogo aprobado.

## Problema
¿Dónde se guardan suscripción, versión del plan, ancla, periodos y asignaciones, y cómo se conceden y se consumen sin duplicar saldo, sin que el cambio de mes UTC lo altere y sin que ningún intento facturable salga sin reserva?

## Criterios de decisión
- Reutilizar ADR-0036 (reserva atómica, liquidación real, tope de llamadas) antes de crear mecanismos nuevos.
- Todo lo comercial se **persiste y asigna desde el servidor**; el navegador nunca fija plan, periodo ni cantidades.
- **Idempotencia por construcción** (restricciones únicas), no por cuidado del código.
- RLS por empresa; el cliente solo ve sus prestaciones y su saldo, nunca costes internos ni margen.
- Nada de proveedor de pagos, precios ni cantidades en este ADR.

## Decisión

### 1. Dónde se persiste (migración futura; todas con `tenant_id` y RLS; escritura solo `service_role`)
| Tabla | Contenido |
|---|---|
| `plan_versions` (catálogo de la plataforma, inmutable al publicarse) | código y versión del plan, vigencia y **prestaciones visibles** (`entitlements`). Los valores son de la decisión comercial. |
| `subscriptions` | empresa, `plan_version_id`, **`anchor_date` (original, inmutable)**, **`timezone` (fija)**, `status` (`active`, `past_due`, `cancel_at_period_end`, `ended`), `pending_plan_version_id` (rebaja en la próxima renovación). **Una suscripción viva por empresa** (índice único parcial). |
| `billing_periods` | `subscription_id`, `period_index` (0, 1, 2…), `starts_at` y `ends_at` (`timestamptz` calculados en el servidor), `plan_version_id` **con el que se concedió**. **`unique (subscription_id, period_index)`.** |
| `payment_events` (bandeja de entrada, sin proveedor fijado) | `provider`, `external_event_id`, **`payment_id`** (la identidad del pago o del cobro en el proveedor), tipo, huella del contenido, **estado** (`received`, `pending`, `applied`, `ignored`, `rejected`), motivo y `period_index` esperado. **`unique (provider, external_event_id)`** (deduplica el evento). |
| `ai_allocation_grants` (libro **solo de añadir**) | `period_id`, `kind` (`included`, `upgrade_delta`, `top_up`), **`provider`, `payment_id` y `concept`** (qué se concedió: p. ej. el periodo incluido *n*), importes por clase de función. **`unique (provider, payment_id, concept)`** (un pago concede un concepto **una sola vez**, lleguen los eventos que lleguen) y **`unique (period_id) where kind = 'included'`** (un solo incluido por periodo). |

Las fechas **no** se guardan como «la próxima renovación»: se derivan de la ancla con una **función pura** (`private.period_bounds(anchor, tz, n)`, con espejo en TypeScript y una tabla de casos: 29, 30 y 31, bisiestos y cambios de horario). El periodo *n* empieza a las 00:00 locales del día ancla (recortado al último día de un mes corto) y termina donde empieza el *n + 1*.

### 2. Un pago confirmado concede una única asignación
Una función `grant_period_from_payment` (`security definer`, solo `service_role`) que el servidor llama **después de verificar la firma del evento** (la verificación depende del proveedor, aún sin elegir):
1. `insert into payment_events … on conflict (provider, external_event_id) do nothing`: un evento **repetido** se reconoce y no hace nada más. Pero un mismo pago suele generar **varios eventos distintos** (creado, confirmado, factura pagada, actualizado…): por eso la deduplicación del evento **no basta**; la que garantiza el consumo es la **identidad del pago y el concepto concedido** (paso 4).
2. `select … for update` de la suscripción: **serializa** los eventos concurrentes de una empresa.
3. Calcula el índice esperado (último + 1). Un evento con un índice mayor queda **pendiente**, no se salta periodos.
4. `insert into billing_periods … on conflict (subscription_id, period_index) do nothing returning`: **solo quien inserta continúa**; crea el grant `included` y las filas de presupuesto en la misma transacción, con `(provider, payment_id, concept)`.
La **restricción única es el árbitro final**: dos eventos **distintos del mismo pago**, dos pagos distintos que apunten al mismo periodo, o el mismo evento mil veces en paralelo, producen **una** asignación (si el segundo pago es un cobro duplicado real, queda `ignored` con su motivo y se marca para reembolso: decisión comercial pendiente). Un evento que no concede nada (reembolso, contracargo, actualización) **nunca crea un grant**. **Eventos adelantados, pendientes y desordenados** (nada se abandona):
- **Fuera de orden o adelantado** (índice mayor que el esperado): se guarda como `pending` con su `period_index`; **no salta periodos** ni concede nada todavía.
- **Cómo se retoma:** (a) al terminar **cada concesión** se ejecuta, en la **misma transacción**, `apply_pending_payment_events(subscription)`, que aplica **en orden** (por `period_index` y luego por llegada) los pendientes que ya son el siguiente esperado, y se repite hasta que no quede ninguno aplicable; (b) cada evento entrante dispara el mismo drenaje; (c) un **trabajo de mantenimiento** del servidor (como `expire_ai_reservations`) reintenta los pendientes periódicamente, de modo que un fallo en medio no los deja varados.
- **Ya aplicado o antiguo** (índice menor que el esperado, o mismo `(provider, payment_id, concept)`): `ignored`, con motivo.
- **No aplicable** (suscripción cancelada o terminada, plan inexistente): `rejected`, con motivo, **visible** y no borrado.
- **Nunca se descarta en silencio:** todo evento termina en `applied`, `ignored` o `rejected`; un `pending` que supera un plazo (por definir) genera una **alerta** para revisión manual en lugar de quedar abandonado. Si falta el pago del periodo *n*, el del *n + 1* espera: no se conceden dos periodos de golpe.

Pago fallido: la suscripción pasa a `past_due`, **no se crea periodo ni grant**; el periodo vigente sigue hasta su `ends_at`. Cancelación: `cancel_at_period_end` y no se concede el siguiente. Rebaja: la concesión del periodo siguiente usa `pending_plan_version_id`. Mejora: una función registra la **aceptación** (quién, el precio y el consumo adicional mostrados) y el consumo extra se concede como `upgrade_delta` **solo con el pago confirmado**, por el mismo camino.

### 3. Reservar cada intento antes de ejecutarlo y liquidar contra su periodo
- **Cada intento facturable** (reintento, respaldo, imagen, vídeo, **paso de una automatización**) tiene su **propia reserva previa**, con clave idempotente `(id de la petición, nº de intento)`. Se sustituye el tope fijo `maxProviderCalls = 1` por una comprobación `beforeAttempt` en el ejecutor que reserva y, si se rechaza, **no ejecuta**. Registrar después no basta.
- La reserva guarda el **`period_id` activo en ese instante**. La liquidación usa **el periodo de la reserva** (ya es así hoy con `period_start`): un intento que termina después de renovar **no toca** el periodo nuevo. Si un periodo cerrado se excede, queda como **sobrecoste interno** visible (`overage_micros`), nunca como cargo al periodo nuevo ni al cliente (decisión pendiente si se absorbe o se avisa).
- Reservas vencidas o retenidas siguen contando **en su periodo original** hasta conciliarse (ADR-0036).
- **Primera prueba de IA: se conserva el límite de UN intento por petición** (`maxAttempts = 1`, sin reintentos ni respaldo, tope de 30 llamadas). La capacidad futura de reservar por intento es **solo capacidad**: no habilita reintentos. Cuántos intentos admite cada función es una **política por función** (`max_attempts_per_request`), con valor 1 hasta que otra decisión aprobada y medida lo cambie; mientras tanto las guardas actuales (`maxProviderCalls = 1`) siguen vigentes y se mantienen sus pruebas.

### 4. Límites por empresa y por función; el mes UTC deja de intervenir
- Las cifras viven **por `period_id` comercial**, no por mes UTC: `private.ai_budget_period()` se sustituye por `private.active_period(tenant, now())`. El cambio de mes UTC **no concede saldo** ni **bloquea** un periodo comercial: ya no es una clave. **El presupuesto UTC de pruebas solo se usa con habilitación explícita de la empresa de prueba:** una tabla `ai_test_enablements (tenant_id, habilitado_por, motivo, desde, caduca)` que escribe solo el servidor. `active_period` recurre al mes UTC **únicamente** si existe una habilitación vigente para esa empresa; **una empresa sin suscripción y sin habilitación no recibe acceso automático** (no hay periodo activo y la reserva responde `no_budget`). Hoy el acceso depende de que la plataforma asigne un presupuesto UTC a mano; la habilitación hace esa decisión explícita, auditable y con caducidad. Se retira cuando haya suscripciones reales.
- **Por función:** una tabla hija `ai_budget_class_limits (period_id, class, limit_micros, max_calls, reservado, gastado…)` actualizada **en la misma transacción** que el total (orden de bloqueo fijo: total y luego clase), de modo que la reserva exige **ambos** límites.
- **Frecuencia y concurrencia:** `max_concurrent` (reservas vivas) y una ventana de ráfaga por clase, **nulos por defecto** (sin límite) hasta medirlos: permiten el uso concentrado legítimo y solo frenan abuso y errores.
- **Fin de periodo:** sin grant del periodo siguiente **no hay periodo activo** y `reserve` responde `no_budget` (comportamiento ya existente): la generación se detiene y **datos, historial y trabajo manual siguen** (la ruta cae al texto por reglas).

### 5. Incluido, recargas, costes internos y publicidad
- **Incluido vs recarga:** `kind` del grant. Las **recargas** tienen vigencia y orden de consumo propios (**pendientes**); mientras no estén decididas no se crea el tipo `top_up`.
- **Prestaciones visibles vs costes internos vs margen:** las prestaciones están en `plan_versions.entitlements` (lo que ve el cliente); el **coste real** está en `ai_usage_attempts` (lo informa el proveedor; se añadirá `cost_basis`: real o estimado) y en una tabla versionada de **precios del proveedor**; el **margen objetivo** vive en una tabla **solo de la plataforma** (`plan_economics`) sin acceso para tenants. El cliente consulta una vista con su saldo en la **unidad visible** (pendiente de decidir), sin importes internos.
- **Presupuesto publicitario:** **libro aparte** (`ad_budgets` con importe, duración y alcance **aceptados** por la persona), sin función que lo mezcle con el de IA.
- **Coste real, estimación y margen de reserva:** la reserva guarda su **margen** y se registra lo liberado al liquidar; nada estimado se presenta como real.

## Opciones consideradas
- **A. Ampliar `ai_budget_periods` con `period_id` comercial y tablas nuevas de suscripción (elegida):** reutiliza reservas, liquidación y tope; cambia la clave del periodo.
- **B. Un servicio de facturación externo que decida el saldo:** menos código propio, pero acopla el límite a un proveedor no elegido y a la red en cada reserva.
- **C. Mantener el mes UTC y prorratear:** simple, pero contradice la regla aprobada de periodo por ancla.

## Consecuencias
- **Positivas:** una sola mecánica de reserva y liquidación; idempotencia garantizada por la base; el cierre de periodo no depende de cron; sin saldo acumulado por diseño.
- **Negativas:** migración que toca la clave de `ai_budget_periods`; el ejecutor debe reservar por intento (más llamadas a la base).
- **Riesgos y mitigaciones:** eventos desordenados → índice esperado y cola pendiente; doble concesión → restricciones únicas y pruebas con sesiones paralelas; horario de verano → función pura con casos.

## Impacto en el framework
- **Reglas no negociables (`AGENTS.md` §7) afectadas:** tenancy (1), datos (3), secretos (6: el secreto del proveedor de pagos aún no existe), producción (11: nada se aplica sin aprobación).
- **RULES afectadas:** `data.md` y `ai.md` (límites de tokens y presupuesto por tenant).
- **Skills afectados:** `kyn-data` (migración, RLS, pruebas de aislamiento) y `kyn-ai`.
- **Módulos afectados:** `lib/ai/` (reserva por intento), `lib/db/` (acceso), Ajustes/Facturación (saldo visible, después).

## Plan de implementación (solo local, en este orden; ninguno es facturación real)
1. **Función de periodos** en TypeScript y SQL con su tabla de casos (29, 30, 31, bisiestos, 00:00 locales y cambios de horario). Sin base remota.
2. **Migración** de `plan_versions`, `subscriptions`, `billing_periods`, `payment_events`, `ai_allocation_grants` y `grant_period_from_payment`; pruebas SQL en PostgreSQL local: el mismo evento N veces y N eventos del mismo periodo en paralelo dan **una** asignación; fallo de pago sin grant; cancelación; rebaja en la siguiente renovación. Los eventos se simulan con datos de prueba.
3. **`reserve_ai_budget` por periodo activo** con retroceso al mes UTC solo para empresas sin suscripción, y límites por clase; pruebas: un intento que liquida tras renovar afecta al periodo original, y el cambio de mes UTC no concede ni bloquea.
4. **`beforeAttempt` por intento** en el ejecutor y en los pasos de automatización, con la ruta de texto como primera.
5. Después, y con aprobación: saldo visible (solo lectura), alertas y la conexión del proveedor de pagos.

## Plan de reversión
Antes de aplicar a una base remota: eliminar las tablas nuevas y volver a la clave por mes UTC. Después de conceder periodos reales, la reversión exige una migración de datos; por eso nada se aplica hasta aprobar este ADR.

## Verificación
- Pruebas SQL reales (como las de ADR-0036) con concurrencia: una asignación por (suscripción, periodo) pase lo que pase.
- Pruebas de que un intento sin reserva no se ejecuta y de que ninguna función de asignación o liquidación es ejecutable por `authenticated`.
- Pruebas de aislamiento: una empresa no ve suscripciones, periodos ni saldos de otra, y nunca ve costes internos ni margen.

## Decisiones que siguen faltando
**Proveedor de pagos** y semántica de sus eventos (firma, reintentos, reembolsos, contracargos y qué hacer con un grant ya concedido) · **unidad visible** del consumo (dinero, créditos o tareas) y **clases de función** que cuentan · precios, prestaciones, reparto por clase y margen objetivo (no antes de medir **tareas completas**) · **condiciones de las recargas** (vigencia, orden de consumo, reembolso) · **qué se hace con un exceso** en un periodo ya cerrado · **gracia** ante un pago retrasado y prueba gratuita · **prorrateo** en mejoras y cómo se muestra la aceptación · umbrales de **frecuencia/concurrencia** y de **alertas** (a medir) · impuestos y términos legales · cómo se informa al cliente cuando la generación se agota.

## Revisión
Antes de escribir la primera migración, y cuando se elija el proveedor de pagos.

## Referencias
- ADR-0036 (presupuesto persistente, reservas, tope de llamadas, frontera de confianza).
- `docs/STATE.md`: apuntes del 2026-11-25 sobre el control de consumo por paquete, la renovación (ancla y meses cortos) y publicación orgánica o con presupuesto.
- `lib/contracts/platform/billing-catalog.ts` y `billing-center.ts` (catálogo y cambios de plan **simulados en memoria**: no son la fuente persistente).
