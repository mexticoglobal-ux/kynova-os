# ADR-0010: Modelo de conversaciones y datos de prospectos — identidad única de contacto, embudo por relaciones, aislamiento por `tenant_id` y adaptadores de canal

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-06 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | datos · tenancy · seguridad · plataforma · módulo · integraciones |
| **Sustituye a** | — |
| **Sustituido por** | — |
| **Se apoya en** | ADR-0006 (persistencia y aislamiento), `AGENTS.md` §7, `docs/DOMAIN.md`, `docs/modules/sales.md` y `clients.md`. Considera la Constitución y **ADR-0009 (ambos aún propuestos, sin fusionar)** |

> **Este ADR no escribe código ni migraciones.** Fija la arquitectura para revisarla **antes** de la primera línea de persistencia. Detalle en [`docs/architecture/`](../architecture/): [modelo ER](../architecture/er-model.md) · [catálogo de datos](../architecture/data-catalog.md) · [multiempresa](../architecture/multitenancy.md) · [flujo comercial](../architecture/commercial-lifecycle.md) · [migraciones](../architecture/migrations.md) · [escalabilidad](../architecture/scalability.md) · [integraciones](../architecture/integrations.md).

## Contexto
- El MVP Comercial 1.1 demuestra el recorrido completo **en memoria**: chat guiado → Business Audit → clasificación → recomendación → resumen ejecutivo → Pipeline → solicitud de reunión aprobada → Dashboard. Nada se guarda (`docs/mvp/ARQUITECTURA-PIPELINE.md`).
- ADR-0006 aprobó Supabase (Postgres + RLS + Auth) y el aislamiento por tenant, y definió cuatro puertas antes de usar **datos reales** (autenticación, aislamiento, exportación y borrado verificados), más decisiones pendientes de región, retención y análisis legal. Existen hoy `tenants`, `memberships` y `business_profiles` (+ `spike_items`, del spike) en un proyecto **desechable**.
- ADR-0006 **excluyó** los datos personales de los clientes finales de una empresa. Este ADR los introduce (contactos, mensajes): es un cambio de clasificación que exige tratarlos como **datos personales** desde el diseño. Las decisiones C12 (aviso de IA), C13 (datos de clientes finales) y C14 (reglas de plataformas) de la revisión de la Constitución **siguen sin análisis legal**.
- El producto exige: multiempresa desde el inicio, un embudo Prospecto → Lead → Oportunidad → Cliente, canales futuros (WhatsApp, Facebook, Instagram, correo, formularios), pagos futuros (Stripe, PayPal, MakaPay, MakaWallet, SINPE) y **millones de registros**.
- Restricciones vigentes: RLS por tenant (§7.1), acceso solo por `lib/db/` con tipos generados (§7.3), contratos en `lib/contracts/` (§7.4), secretos fuera del repositorio (§7.6), nada de carpetas ni dependencias relevantes sin ADR (§7.7), producción solo con aprobación (§7.11). Sin Docker local (D19); `database.types.ts` sin generar (D31); hook de verificación roto (D4); producción sin desplegar (D23).

## Problema
¿Cómo se modelan y guardan los prospectos, las conversaciones y el embudo comercial de forma **aislada por empresa, auditable, preparada para millones de registros y para nuevos canales y pagos**, sin construir ahora lo que depende de decisiones aún abiertas?

## Criterios de decisión
1. Aislamiento **garantizado por la base**, incluso ante errores de código.
2. Una sola fuente de verdad para cada persona y su historial.
3. Cada transición comercial es explícita, auditable y respeta los niveles de autonomía.
4. Crece a cientos de millones de filas sin rediseñar.
5. Un canal o una pasarela nuevos **no cambian el núcleo**.
6. Datos personales tratados con minimización, consentimiento, exportación y borrado.
7. Migraciones seguras y reversibles; verificación en CI.
8. Mínimo de piezas nuevas: sin dependencias ni infraestructura hasta que haya necesidad medida.

## Opciones consideradas

### Decisión 1 — Identidad: ¿cómo se representan prospecto, lead, oportunidad y cliente?
| Opción | Ventajas | Inconvenientes |
|--------|----------|----------------|
| **A. Una identidad (`contacts`) y relaciones (`leads`, `opportunities`, `customers`)** | Sin duplicados ni copias al "convertir"; historial único; un lead puede reabrirse; un cliente puede tener varias oportunidades | Requiere mantener `lifecycle_stage` derivada (una función única) |
| B. Una tabla por etapa (prospectos, leads, clientes) | Simple de explicar | Duplica personas, pierde historial al mover, reglas de unicidad cruzadas, difícil deduplicar entre canales |
| C. Una sola tabla con una columna `stage` | Menos tablas | Mezcla atributos de entidades distintas; no admite varias oportunidades ni episodios de interés |

### Decisión 2 — Multiempresa
| Opción | Ventajas | Inconvenientes |
|--------|----------|----------------|
| **A. Esquema compartido + `tenant_id` + RLS + FK compuestas** | Una migración para todos; RLS ya aprobada; escala a miles de empresas | La garantía depende de políticas y pruebas (se mitiga con FK compuestas y matriz generada) |
| B. Un esquema por empresa | Aislamiento lógico más fuerte | Cada migración × N; el catálogo de Postgres crece con N × tablas |
| C. Un proyecto por empresa | Aislamiento físico | N despliegues, copias y costos; no encaja en autoservicio |

### Decisión 3 — Escritura del tráfico público (sin usuario autenticado)
| Opción | Ventajas | Inconvenientes |
|--------|----------|----------------|
| **A. Clave de servidor sin privilegios sobre tablas, solo `EXECUTE` en funciones `ingest_*` que resuelven el tenant** | Cumple ADR-0006 (`service_role` sigue sin privilegios sobre tablas); superficie mínima y revisable | **A verificar en un spike** que el cliente pueda restringirse así |
| B. Rol propio con JWT firmado por el Worker | Aislamiento por rol | Gestión de claves de firma; verificar compatibilidad con la gestión de claves del proyecto |
| C. Conexión directa (Hyperdrive/pooler) con un rol limitado | Flexible para cargas pesadas | Requiere su propio ADR (ADR-0006) y más infraestructura |

### Decisión 4 — Almacenamiento de mensajes (la tabla más grande)
| Opción | Ventajas | Inconvenientes |
|--------|----------|----------------|
| **A. Tabla relacional particionada por mes + archivo a R2** | Una sola base; RLS y transacciones; retención por desprendimiento; sin infraestructura nueva | Unicidad global imposible (se compensa con `inbound_dedup` y `idempotency_key`); sin FK hacia la tabla |
| B. Almacén aparte (columnar o de búsqueda) | Escala analítica extrema | Otra pieza que operar, sin RLS ni transacción con el resto |
| C. Una tabla por empresa | Aislamiento | Explosión de objetos; migraciones × N |

### Decisión 5 — Integraciones
| Opción | Ventajas | Inconvenientes |
|--------|----------|----------------|
| **A. Adaptadores + eventos normalizados + `inbound_events` + `outbox` idempotentes** | Un canal nuevo no cambia el núcleo; reprocesable; seguro | Más piezas conceptuales que un webhook directo |
| B. Tratar cada canal dentro de su pantalla o ruta | Rápido al inicio | Lógica de negocio repetida por canal; difícil de auditar |
| C. Plataforma de integración externa (iPaaS) | Rápido de conectar | Datos personales y credenciales en un tercero; costo; menos control |

### Decisión 6 — Auditoría
| Opción | Ventajas | Inconvenientes |
|--------|----------|----------------|
| **A. Dos capas: `action_log` (acciones, con nivel y amparo) y `audit_log` (cambios de datos por trigger)** | Responde "qué hizo NEX y por qué" y "quién cambió este campo" por separado | Más escritura en las tablas auditadas |
| B. Solo registro de aplicación | Simple | Se puede olvidar; no cubre cambios directos |
| C. Solo triggers de fila | Completo para datos | No explica la intención ni la autorización |

## Decisión
**Opción A en las seis decisiones**, con estas especificaciones (detalle en los documentos de arquitectura):

1. **Identidad.** `contacts` es la persona; `contact_identities` reconoce a la misma persona entre canales (único por tenant, tipo, proveedor y valor normalizado). **Prospecto** = contacto sin lead abierto; **Lead** = episodio de interés (uno abierto por contacto); **Oportunidad** = venta concreta con importe, etapa, responsable y próxima acción; **Cliente** = relación vigente creada o ampliada al ganar una oportunidad. Nada se borra ni se copia al avanzar. Las transiciones son funciones únicas, y `contacts.lifecycle_stage` solo la mantienen ellas.
2. **Multiempresa.** `tenant_id` no nulo en toda tabla de negocio, inmutable, primero en los índices; `workspace_id` nulo reservado; **FK compuestas `(tenant_id, id)`** para que una fila no pueda apuntar a otra empresa; RLS con cuatro formas de política y denegar por defecto; **prueba de catálogo y matriz de aislamiento generada** en CI. Un tenant puede **extraerse a su propio proyecto** sin renumerar (ids globales).
3. **Escritura pública.** Solo mediante funciones `ingest_*` que fijan el tenant ellas mismas; la clave de servidor **no consulta tablas**. Los procesos internos usan funciones `system_*` con la misma restricción. El mecanismo exacto se valida en un **spike** antes de M3.
4. **Volumen.** Particiones **mensuales desde el primer día** solo en `messages`, `inbound_events`, `action_log`, `audit_log` y `payment_events`; UUIDv7 en tablas de volumen; `inbound_dedup` e `idempotency_key` para la unicidad que las particiones no dan; retención por desprendimiento y archivo a R2; rollups (`metrics_daily`) para el Dashboard.
5. **Integraciones.** Contratos normalizados (`NormalizedInbound`, `OutboundIntent`, `NormalizedPayment`); cada proveedor es un adaptador; entrada con **firma verificada, idempotencia y respuesta inmediata**; salida por **outbox transaccional** que **exige amparo** (aprobación o autorización). Secretos **por referencia** (`secret_ref`), nunca en la base. **Solo el chat web existe**; los demás canales y los pagos quedan declarados, no implementados.
6. **Auditoría.** `action_log` (en la misma transacción que la acción; sin registro no hay acción) y `audit_log` (trigger genérico con columnas personales redactadas); ambos **solo anexan**.
7. **Autonomía en el embudo.** Crear registros internos (contacto, conversación, lead, evaluación) es **nivel 1**. **Primer contacto saliente, crear una oportunidad, avanzarla, ganarla y crear o ampliar un cliente son nivel 3**: NEX propone, una persona confirma. Todo con `approval_requests`. Las tablas de acuerdos y autorizaciones del Nivel 2 se crean **desactivadas** hasta que ADR-0009 se acepte.
8. **Datos del cliente como datos.** Catálogo, preguntas frecuentes, reglas de calificación, horario y mensajes viven en `pack_versions`, **versionados y aprobados por la empresa** y validados por `lib/contracts/`; nada propio de una empresa en el código (ADR-0006).
9. **Datos personales.** Minimización; `consent_records` (aviso, opt-in) por contacto y canal; exportación y **anonimización** (no borrado físico) por una función única que deja evidencia; la retención de las copias condiciona el borrado efectivo (ADR-0006).
10. **Migraciones.** Una migración por cambio lógico con esquema, permisos y RLS juntos; expansión y contracción; sin bloqueos largos; verificación en CI con base efímera, matriz de aislamiento y tipos generados; **grupos M0–M7** en orden (M0 prerrequisitos, M1 fundamentos, M2 CRM, M3 conversaciones, M4 evaluación y paquetes, M5 gobierno, M6 analítica, M7 pagos).

## Consecuencias
- **Positivas:** el aislamiento no depende de la disciplina del código; una persona, un historial; auditoría que explica la intención y los cambios; el modelo admite un canal o un método de pago nuevo sin tocar el núcleo; el volumen tiene una ruta clara (partición, retención, archivo, extracción); el flujo del MVP se traslada casi uno a uno.
- **Negativas:** **37 tablas** (34 nuevas) y funciones propias: mayor superficie para mantener y revisar. Las FK compuestas y las particiones complican algunas migraciones. La unicidad global en tablas particionadas exige tablas auxiliares. Las pruebas de aislamiento y de carga son un costo fijo.
- **Riesgos y mitigaciones:**

| Riesgo | Mitigación |
|--------|------------|
| Una política RLS o un privilegio filtra datos | Denegar por defecto, FK compuestas, prueba de catálogo y matriz generada en CI, `/security-review` por grupo |
| RLS por membresía demasiado lenta a escala | Patrón `(select …)` con índice; **puerta de carga** (10 M contactos, 200 M mensajes); alternativa documentada (reclamaciones en el JWT) |
| El mecanismo de ingesta sin privilegios sobre tablas no es viable | Spike previo; alternativas B y C documentadas |
| Datos personales de terceros sin base legal | **Análisis legal antes de datos reales**; aviso y consentimiento; nada real en Preview |
| Una partición ausente rompe la ingesta | Creación anticipada, alerta y partición por defecto |
| Diseño demasiado grande para el momento | Se construye por grupos; **M0–M3 con el chat web** bastan para el piloto; pagos y canales externos quedan fuera hasta su ADR |
| Especificaciones de MakaPay, MakaWallet y SINPE desconocidas | El contrato `NormalizedPayment` es genérico; cada adaptador se define con su documentación **antes** de construirse |
| La autonomía de NEX se amplía sin base | Tablas del Nivel 2 desactivadas hasta aceptar ADR-0009; el nivel lo decide el código y ante la duda es 3 |

## Impacto en el framework
- **Reglas no negociables (`AGENTS.md` §7) afectadas:** ninguna se modifica. Cumple §7.1 (tenancy), §7.3 (acceso por `lib/db/`), §7.4 (contratos), §7.6 (secretos por referencia) y §7.11 (sin escritura externa sin aprobación).
- **RULES afectadas:** `data` aplica íntegra; se propone **añadir** a `.claude/rules/data.md`: FK compuestas, prueba de catálogo y política de particiones. `security` aplica íntegra.
- **Skills afectados:** `kyn-data` (cada grupo de migración), `kyn-module` (Sales y Clients), `kyn-ai` (NEX solo con el contexto del tenant).
- **Módulos afectados:** Sales, Clients, NEX, Dashboard, Settings (integraciones) y, más adelante, Finance.
- **Documentos a actualizar al aceptar:** `docs/DOMAIN.md` (Contacto, Identidad de contacto, Oportunidad, Aprobación, Paquete del cliente), `docs/modules/sales.md`, `clients.md` y `nex.md`, y la sección de datos de `docs/STATE.md`.
- **Dependencias nuevas:** ninguna decidida. Posibles, cada una con su justificación **al momento**: `pg_trgm` (extensión), `pg_cron` y, si hiciera falta, `pg_partman`.

## Plan de implementación
Cada grupo es una **tarea L (W3)** con brief, `/security-review` y aprobación; ninguno antes de aceptar este ADR.
1. **Revisión y aceptación de este ADR** y de sus decisiones pendientes (abajo).
2. **Spikes previos** (sin datos de negocio): (a) ingesta con una clave sin privilegios sobre tablas; (b) rendimiento de RLS con carga sintética; (c) creación y desprendimiento de particiones; (d) ¿`uuidv7()` nativo en el proyecto?
3. **M0** prerrequisitos (tipos generados, CI con base efímera, hook) → **M1** → **M2** → **M3** (con el chat web) → **M4** → **M5** → **M6**. **M7 pagos** solo con su ADR.
4. En paralelo, **no se escribe persistencia** de la interfaz hasta M2–M3; el MVP sigue en memoria.
5. Puertas de ADR-0006 antes de datos reales: autenticación, aislamiento, exportación y borrado verificados; región, retención y análisis legal decididos; entorno de datos reales aprobado (Preview no lo es).

## Plan de reversión
- **Antes de datos reales:** se descartan las migraciones del proyecto desechable; el MVP en memoria sigue funcionando.
- **Con datos reales:** reversión **hacia adelante** (migración correctiva); la exportación por tenant permite migrar a otro Postgres estándar. Cada grupo documenta su propia reversión. El punto sin retorno práctico es el primer dato real en un entorno aprobado.

## Verificación
- Revisión de Jeffrey **antes** de escribir persistencia.
- Los tres spikes con informe Go/No-Go.
- Por grupo: matriz de aislamiento y prueba de catálogo en verde; invariantes del embudo probados; ingesta idempotente; append-only a prueba; exportación y borrado verificados; puerta de carga cumplida.

## Decisiones pendientes (para Jeffrey)
| # | Decisión | Recomendación |
|---|----------|---------------|
| P1 | **Región de Supabase** y residencia de datos | Decidir con el análisis legal; cercana a Costa Rica y a los Workers; la elegida **no** equivale a cumplimiento normativo |
| P2 | **Plazos de retención** por dato (mensajes 24 meses, eventos crudos 30–90 días, registros de acción 7 años: propuestas) | Aprobar junto con el análisis legal |
| P3 | **Visibilidad v1:** ¿todo miembro ve todo el CRM del tenant? | Sí en v1; los roles finos requieren otro ADR |
| P4 | **Secretos de integración:** Cloudflare, Supabase Vault o ambos | Decidir en el spike de ingesta |
| P5 | **Nivel 3 para oportunidad y cliente** (NEX propone, una persona confirma) | Aprobar; ampliar solo con evidencia y ADR-0009 aceptado |
| P6 | **Análisis legal** de datos de clientes finales, aviso de IA y consentimiento por canal (C12, C13, C14) | Antes de cualquier dato real |
| P7 | **Especificaciones** de MakaPay, MakaWallet y de SINPE | Aportar documentación técnica antes de su adaptador |
| P8 | **Entorno de datos reales** (no Preview) | Decidir en la fase de piloto |
| P9 | **Orden:** M0–M3 con el chat web primero; pagos y canales externos después | Aprobar |
| P10 | **Alcance fuera de este ADR:** planes y facturación de KYNOVA, facturas del tenant (Finance), propiedades, capa de IA | Cada uno con su ADR |

## Revisión
Revisar al **aceptar ADR-0009** (autonomía), al completar el análisis legal (P6), al terminar los spikes, y antes de M3 y de cualquier dato real. Revisar también si la prueba de carga incumple algún presupuesto.

## Referencias
- ADR-0006 (persistencia y aislamiento), ADR-0007 (CI), ADR-0008 (autenticación del spike); `supabase/migrations/`; `docs/supabase-spike/RESULTADO.md`.
- `docs/DOMAIN.md` §1, §4–6; `docs/modules/sales.md`, `clients.md`.
- MVP Comercial: `docs/mvp/MVP-COMERCIAL-1.0.md` y `ARQUITECTURA-PIPELINE.md` (ramas `feat/mvp-comercial-foundations` y `feat/premium-ui-v1`, aún sin fusionar).
- Constitución (PR #7) y ADR-0009 (PR #8): propuestos, sin fusionar.
- Documentos de arquitectura: [er-model](../architecture/er-model.md) · [data-catalog](../architecture/data-catalog.md) · [multitenancy](../architecture/multitenancy.md) · [commercial-lifecycle](../architecture/commercial-lifecycle.md) · [migrations](../architecture/migrations.md) · [scalability](../architecture/scalability.md) · [integrations](../architecture/integrations.md).
