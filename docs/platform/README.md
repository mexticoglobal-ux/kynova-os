# Plataforma: integraciones, pagos, referidos, tienda, academia, trabajadores y automatizaciones

> Arquitectura, contratos, modelos de datos y pantallas base. Fecha: 2026-11-06. **No hay ninguna conexión real**: ningún proveedor está conectado, no hay migraciones nuevas y las pantallas (`/platform`) muestran datos de ejemplo. Se construye sobre ADR-0010 y la Constitución (ADR-0009, propuesto).

## 1. Principios

1. **Un proveedor es un manifiesto, no código suelto.** `lib/contracts/platform/integrations.ts` declara autenticación, capacidades, webhook y sandbox. Conectar uno es escribir su adaptador (`lib/integrations/types.ts`) contra ese manifiesto.
2. **Lo desconocido no se supone.** MakaPay, MakaWallet y SINPE quedan con autenticación `undefined` y webhook `pending` hasta tener su documentación; una prueba lo exige.
3. **Salir de la plataforma o mover dinero es Nivel 3.** Enviar mensajes, crear cobros, reembolsar y escribir en calendarios siempre piden aprobación (`EXTERNAL_EFFECTS`). El nivel de cada acción lo decide el código y falla cerrado (`workers.ts`).
4. **Dinero:** enteros en unidades menores con moneda explícita; nunca decimales.
5. **Todo evento externo es idempotente** y entra por `/api/v1/inbound/{provider}` (hoy responde 501) hacia `inbound_events` e `inbound_dedup`.
6. **Secretos:** nunca en el repositorio ni en tablas en claro (ADR-0010 P4 sigue abierto: dónde viven las credenciales de cada empresa).

## 2. Contratos (`lib/contracts/platform/`)

| Archivo | Define | Lógica pura probada |
|---------|--------|---------------------|
| `integrations.ts` | 11 proveedores, capacidades, estados de conexión | Transiciones de conexión, validación de manifiestos, acciones con aprobación |
| `payments.ts` | `Money`, estados de pago, enlace de cobro, conciliación | Pago solo avanza, reembolsos nunca superan lo pagado, `matchTransfer` (exacto, probable, ambiguo) |
| `referrals.ts` | Programa, recompensa, atribución | Último contacto en ventana, recompensa entera con tope, señales de fraude |
| `marketplace.ts` | Publicaciones, permisos, precio, instalación | Revisión objetiva, ciclo de vida, reparto de ingresos sin perder centavos |
| `academy.ts` | Cursos, lecciones, progreso | Progreso y condición de certificado |
| `workers.ts` | Plantillas de trabajador, niveles, autorizaciones | `levelForAction` (desconocido = 3), `decide`, límites diarios |
| `automation-center.ts` (+ `-messages`, `-demo`) | Centro de Automatizaciones v1: seis disparadores, seis acciones de nivel 1, estados, ejecuciones y resultados (§12) |
| `studio-center.ts` (+ `-messages`, `-demo`) | AI Studio v1: prompts y agentes IA versionados, Playground por KOE, plantillas y acuerdos de compartir (§13) |
| `koe-ledger.ts`, `koe-insights.ts`, `insights-center.ts` (+ `-messages`, `-demo`) | Insights: el registro de KOE, el único motor de cifras y lo que una empresa puede hacer con ellas: correcciones y reportes (§14) |
| `koe-crm.ts`, `crm-center.ts`, `crm-audit.ts` (+ `-messages`, `-demo`) | CRM inteligente: el único motor de inteligencia comercial de KOE y los registros que lo hacen duradero (§15) |
| `koe-comms.ts`, `comms-center.ts` (+ `-messages`, `-demo`) | Centro de Comunicaciones: el único motor de entendimiento y enrutamiento de conversaciones de KOE y los registros que lo hacen duradero (§16) |
| `koe-org.ts`, `org-center.ts` (+ `-messages`, `-demo`) | Organización e identidad: la estructura de la empresa, roles y permisos, y el único motor de fuerza de trabajo y recomendaciones de KOE (§17) |
| `koe-billing.ts`, `billing-center.ts`, `billing-catalog.ts` (+ `-messages`, `-demo`) | Facturación y suscripciones: planes, add-ons, licencias, facturas y el único motor financiero de KOE: límites, consumo de IA, forecast y ROI (§18) |
| `koe-dev.ts`, `dev-center.ts`, `dev-catalog.ts` (+ `-messages`, `-demo`) | Plataforma para desarrolladores: apps, API Keys, webhooks, sandbox, explorador y el único motor de KOE para límites, consumo, respuestas simuladas y recomendaciones (§19) |
| `components/ui/*`, `config/brand.ts`, `lib/theme.ts`, `lib/nav-memory.ts`, `public/sw.js` | Design System V2: dos temas NOVA, componentes compartidos, marca, navegación con favoritos y búsqueda rápida, y PWA (§20) |
| `lib/backend/*`, `lib/db/core-clients.ts` | Backend Core v1: entorno, secretos, cifrado, Event Bus, auditoría central, Storage, contratos de datos, RLS preparado sin activar, Auth, observabilidad y rendimiento (§21, ADR-0011) |
| `ai-decision.ts`, `ai-cost-optimizer.ts`, `ai-model-registry.ts`, `ai-model-performance.ts`, `ai-limits.ts`, `ai-observability.ts`, `koe-ai*.ts`, `gateway-*.ts` | IA: KOE decide el Worker y la política, el AI Cost Optimizer recomienda el modelo y el AI Gateway elige proveedor, fallback y reintentos; todo simulado (§22, ADR-0012) |
| `agent-catalog.ts`, `agent-runtime.ts`, `agent-center.ts`, `agent-messages.ts` | Runtime de Agentes IA: un plan por pasos que maneja el motor de Workers y la cadena de IA, con límites, reintentos, escalamiento y aprobación humana; todo simulado (§23, ADR-0013) |
| `app/globals.css`, `tailwind.config.ts`, `components/ui/*`, `components/shell/*` | Design System V3 (NOVA): azul muy oscuro, azul y cian eléctricos, vidrio, tipografía premium; sustituye el estilo de §20 sin tocar lógica (§24, `docs/design-system.md`) |
| `lib/backend/integration/*` | Backend Core Integration v1: un conector que envuelve el reductor de cada módulo y lo lleva al Event Bus, la auditoría, las métricas y las trazas, sin modificar los módulos (§25, ADR-0014) |
| `supabase/migrations/20261110000100_*`, `lib/backend/identity.ts`, `lib/backend/integration/{persistence,supabase-storage}.ts` | Identidad, autenticación y Supabase v1: tablas del Backend Core con RLS, escritura por funciones, identidad de la sesión y adaptadores; la migración está escrita y probada, no aplicada (§26, ADR-0015) |
| `lib/ai/` | Capa de proveedores reales del AI Gateway: adaptadores OpenAI, Anthropic, Google y OpenRouter (Grok, DeepSeek, Mistral y Ollama preparados), ejecutor, secretos, streaming | Nadie más llama a un proveedor; KOE y el Gateway no cambian de arquitectura | `adapters.ts`, `executor.ts`, `service.ts`, `secrets.ts`, `providers.ts`, `http.ts` |
| `kynova-operation.ts` | El guion de KYNOVA operando KYNOVA: la empresa, un día de trabajo y el panel operativo, aplicados por los reducers existentes | No añade reglas ni módulos; solo lee y aplica | `kynova-operation.test.ts` |
| `business-templates.ts` | Doce plantillas de negocio (datos), su instalación por los reducers existentes, KPIs y el Revenue Engine (lectura) | No duplica lógica ni crea módulos; instala siempre en Nivel 1 | `business-templates.test.ts` |
| `partners.ts` | Programa oficial de Partners: niveles, código y enlace, seguimiento y conversión, comisiones recurrentes, validación de 15 días, retiro, panel e historiales | Reutiliza Referidos y Billing; no conecta medios de pago | `partners.test.ts` |
| `financial-router.ts` | KOE Financial Router: la única entrada del dinero; siete adaptadores desconectados con una interfaz; decisión, reintentos, respaldo, idempotencia, costos, monedas, estados, historial | Billing/Marketplace/Partners piden; el Router decide; ningún proveedor conectado | `financial-router.test.ts` |
| `business-architect.ts` | AI Business Architect: asistente de bienvenida, cuestionario, detección del negocio, recomendación, vista previa e instalación con un clic | Solo elige y escala plantillas y límites de Billing; no usa IA real ni reglas nuevas | `business-architect.test.ts` |
| `internal-beta.ts` | Beta interna: crea cuatro empresas con el AI Business Architect y configura sus casos de uso; portafolio de KYNOVA | Solo guion sobre módulos existentes; datos de ejemplo; nada conectado | `internal-beta.test.ts` |
| `connectors.ts` | Real World Integrations: 12 conectores con una interfaz, OAuth preparado, sincronización, permisos, salud y el camino Agente → Worker → Conector → Proveedor | Adaptadores simulados; credenciales por Secrets Manager; nada real conectado | `connectors.test.ts` |
| `automations.ts` | Plantillas y validación anteriores (se conservan): disparador, condiciones, acciones | Validación, acciones externas por aprobación, aviso de bucle, modo de prueba por defecto |

## 3. Modelos de datos (futuros; ninguno existe aún)

Todas llevan `tenant_id`, clave compuesta `(tenant_id, id)`, RLS y `created_at`. Se crearán con `kyn-data` y ADR cuando se conecte el primer proveedor. `integration_accounts` ya existe (migración 4); falta ampliar sus listas CHECK con el calendario.

| Tabla | Campos clave | Notas |
|-------|--------------|-------|
| `integration_accounts` (existe) | provider, category, status, config no secreta | Añadir `calendar` y `googleCalendar` |
| `integration_credentials` | account_id, secret_ref, rotated_at | Solo referencia al secreto, nunca el valor |
| `payments` | amount_minor, currency, status, provider, provider_ref, opportunity_id, customer_id | `unique(tenant_id, provider, provider_ref)` |
| `payment_events` | payment_id, type, payload, received_at | Solo anexar; base de la conciliación |
| `payment_links` | payment_id, status, expires_at, approval_id | Siempre con aprobación |
| `referral_programs` / `referral_touches` / `referral_rewards` | regla, ventana, referrer, estado | Recompensa `held` ante señales de fraude |
| `listings` / `listing_installs` | kind, version, permisos, estado | La tienda es global; las instalaciones son por empresa |
| `courses` / `course_progress` | lecciones, completadas, puntaje | Contenido global, progreso por usuario y empresa |
| `worker_instances` / `worker_runs` | plantilla, límites, pausa, estado | Cada ejecución queda en `action_log` |
| `automations` / `automation_runs` | definición (jsonb validada), estado, modo de prueba | Las acciones externas crean `approval_requests` |

## 4. Orden para conectar (cuando termine la validación del Backend Core)

1. Canal de entrada: chat web y correo (sin costo de verificación).
2. Un proveedor de pagos con pruebas y webhooks firmados (Stripe), con conciliación.
3. WhatsApp, luego Facebook e Instagram (misma revisión de plataforma).
4. MakaPay, MakaWallet y SINPE: requieren su documentación técnica primero.
5. Google Calendar de solo lectura, luego escritura con aprobación.
6. Referidos, trabajadores y automatizaciones sobre lo ya conectado; tienda y academia al final.

## 5. Pendiente de decisión

- Dónde viven las credenciales por empresa (ADR-0010 P4).
- Documentación de MakaPay, MakaWallet y SINPE (ADR-0010 P7).
- Análisis legal de pagos, datos de terceros y mensajería comercial (ADR-0010 P6).
- Pantallas solo en español.

## 6. Integraciones v1: el modelo de conexión

`lib/contracts/platform/connection.ts` define lo que toda integración soporta, igual para los 11 proveedores:

| Capacidad | Cómo |
|-----------|------|
| Estado de conexión | `ConnectionStatus` y transiciones permitidas (`integrations.ts`) |
| Configuración | Campos por proveedor (`CONFIG_FIELDS`); solo ajustes no secretos y **referencias** `secret:nombre`: un secreto en bruto se rechaza |
| Permisos | Por capacidad: apagado, con aprobación o automático. Lo que sale de la plataforma o mueve dinero nunca es automático; todo empieza apagado |
| Registros y errores | Historial acotado; los errores se clasifican (autenticación, límite, proveedor, red, configuración) y dicen si son reintentables |
| Auditoría | Quién hizo qué y cuándo; nunca valores de secretos ni contenido de mensajes |
| Activar y desactivar | Solo con configuración completa; un proveedor sin documentación (MakaPay, MakaWallet, SINPE) no se activa; una conexión revocada no revive |

Todo cambio pasa por una sola función pura, `reduce(conexión, evento)`, que el servidor usará igual cuando existan los adaptadores. Hoy `/platform/integrations` ejecuta ese mismo reductor en el navegador como **simulación local**: no persiste y no contacta a ningún proveedor. Persistirlo requiere las tablas de la sección 3 (aún no creadas, a la espera de la validación del Backend Core).

## 7. Centro de Pagos v1

Mismo enfoque que Integraciones: contratos puros más un reductor, con simulación local en `/platform/payments`. **Ningún proveedor se contacta y no hay migraciones.**

| Archivo (`lib/contracts/platform/`) | Contenido |
|-------------------------------------|-----------|
| `currency.ts` | 7 monedas con sus decimales (USD, EUR, CRC, MXN, JPY y, **reservadas**, BTC y USDC); formato; conversión con tasas informativas; totales por moneda; lectura segura de montos escritos |
| `billing.ts` | Suscripciones (incompleta, prueba, activa, pago vencido, pausa, cancelada; 3 fallos cancelan) y facturas (borrador, abierta, pagada, anulada, incobrable; numeración `INV-000001`) |
| `ledger.ts` | Estado único y `reducePayments`: métodos, pagos, reembolsos, webhooks, extracto y conciliación, suscripciones y facturas; `summarize` para el panel |
| `payments-demo.ts` | Datos de ejemplo que pasan por el mismo reductor |

**Reglas que el reductor hace cumplir (con pruebas):**
- Un método de pago comparte el contrato de conexión de Integraciones: configuración sin secretos, permisos, registros, errores y auditoría.
- Los métodos con cobro por proveedor (Stripe, PayPal, MakaPay) **se confirman solo por webhook verificado**; los de transferencia (SINPE, transferencia bancaria) **solo por una persona**, desde la conciliación. Nada se marca cobrado a mano en un método de webhook.
- Webhook: firma inválida o ausente se rechaza y se registra; el mismo evento dos veces no cambia nada; un evento fuera de orden no retrocede un pago; un proveedor sin webhooks (SINPE, banco) los rechaza.
- Reembolso: es Nivel 3. Lo solicita una persona y **otra** lo aprueba; nunca supera lo cobrado (contando los pendientes); solo en métodos que lo ofrecen; con permiso encendido.
- Conciliación: el sistema propone (exacta, probable, ambigua, ninguna) y una persona confirma; importar dos veces el mismo extracto no duplica líneas.
- Un pago cobrado activa su suscripción y marca pagada su factura solo si coincide con el total; si no coincide, queda registrado y no se fuerza.
- Monedas: cada método declara las que admite; los totales de varias monedas se convierten solo con tasas dadas (las que faltan se nombran, no se inventan) y **nunca se usan para liquidar**.
- Criptomonedas: representables (BTC, USDC) pero **no activables** hasta tener documentación, custodia y análisis legal. Los activos con más de 15 dígitos (p. ej. wei) necesitarán otro tipo numérico.

**Cambio respecto al PR #10:** SINPE pasa a modo manual o asistido (sin API, conciliación por extracto), por lo que ya puede activarse; MakaPay, MakaWallet y criptomonedas siguen bloqueados. Se añaden `bankTransfer` y `crypto` como proveedores.

**Pendiente al conectar:** tablas de la sección 3 (pagos, eventos, reembolsos, suscripciones, facturas, extracto), numeración de facturas por empresa a prueba de concurrencia, retención de eventos y el análisis legal y fiscal (facturación electrónica, datos de pago, criptomonedas).

## 8. Centro de Referidos v1

Mismo enfoque que Integraciones y Pagos: contratos puros más un reductor, con simulación local en `/platform/referrals`. **Sin APIs, sin pasarelas, sin migraciones, sin dinero que se mueva.**

| Archivo (`lib/contracts/platform/`) | Contenido |
|-------------------------------------|-----------|
| `referral-center.ts` | Estado por empresa y `reduceReferrals`: programa, afiliados, atribución, comisiones, señales de fraude, reglas de aprobación y solicitudes de pago; `summarizeReferrals` para el panel |
| `referral-messages.ts` | Todos los textos por código (errores, estados, señales). Hoy solo español; agregar un idioma es agregar un diccionario |
| `referral-demo.ts` | Dos empresas de ejemplo que pasan por el mismo reductor |
| `referrals.ts` (ya existía) | Atribución al último contacto, cálculo de recompensa y señales de fraude que este módulo reutiliza |

**Qué permite:** programa con comisión por porcentaje (0.01 a 50 %) o monto fijo, con tope y venta mínima; código y enlace únicos por afiliado (letras del nombre más un sufijo derivado de un hash, único por empresa); embudo clic, registrado, calificado, convertido, con rechazados y vencidos; comisiones pendientes, retenidas, aprobadas, en pago, pagadas, rechazadas y revertidas, cada una con su historial; panel con conversión y mejores afiliados; auditoría y registros.

**Reglas que el reductor hace cumplir (con pruebas):**
- **Atribución:** gana el último contacto dentro de la ventana; los demás afiliados que tocaron a la misma persona quedan rechazados. Quien ya es cliente no genera otro referido.
- **Aprobación:** una comisión nace pendiente (o retenida si hay señal de fraude) y no puede aprobarse antes de cumplir la espera. Pasada la espera, el sistema aprueba solo lo que está bajo el tope y sin señales; lo demás lo revisa una persona.
- **Fraude:** mismo correo, mismo dispositivo, autorreferido, ráfaga (5 o más referidos de un afiliado en una hora). Cualquier señal retiene la comisión. Un afiliado suspendido registra la comisión como rechazada.
- **Reembolsos de la venta:** la comisión se revierte; si ya estaba en un pago, se exige resolverlo primero; si ya se pagó, queda marcada por recuperar.
- **La regla vigente al ganar la comisión queda guardada en ella:** cambiar el programa después no la altera.
- **Niveles (preparado, desactivado):** el modelo soporta hasta dos niveles sobre quien patrocinó al afiliado, cada uno con su regla y con protección contra ciclos. Hoy solo gana quien hizo la venta; el interruptor está deshabilitado en la pantalla.
- **Multiempresa:** el estado es por empresa, todo registro lleva `tenantId` y el reductor rechaza cualquier evento de otra empresa.

**Pago de comisiones: Nivel 3 (Constitución de NEX).** Un pago se **solicita** (una persona), se **aprueba** (otra distinta) y se **registra como pagado** con una referencia que aporta quien pagó fuera de la plataforma. El reductor rechaza a NEX y a cualquier actor `worker:` o `system` para aprobar comisiones, solicitar, aprobar o registrar pagos. Las acciones están en el catálogo de trabajadores como Nivel 3 (`referral.payout`, `referral.approveCommission`) y ninguna autorización puede bajarlas. Al desacoplarse de las pasarelas, un futuro adaptador de pagos solo tendrá que producir esa referencia.

**Pendiente al conectar:** tablas (programa, afiliados, referidos, comisiones, pagos, auditoría) con RLS por empresa y clave compuesta; el punto de entrada público del enlace `/r/{código}` con protección anti-abuso (límite de tasa, detección de bots) y aviso de privacidad; recuperación de comisiones por reembolsos tras el pago; análisis legal y fiscal de comisiones a terceros (retenciones, contratos de afiliado); activar niveles con decisión de negocio.

## 9. Marketplace v1

Mismo enfoque que Integraciones, Pagos y Referidos: contratos puros más un reductor, con simulación local en `/platform/store`. **Sin APIs, sin pagos reales, sin migraciones; todo con datos de ejemplo.**

| Archivo (`lib/contracts/platform/`) | Contenido |
|-------------------------------------|-----------|
| `marketplace-center.ts` | Estado global del catálogo y `reduceMarket`: publicaciones, moderación, compras, suscripciones, descargas, favoritos, reseñas, reparto de ingresos y liquidaciones; búsqueda y filtros; paneles de vendedor y de administración |
| `marketplace-messages.ts` | Todos los textos por código (errores, tipos, categorías, estados, orden). Hoy solo español |
| `marketplace-demo.ts` | Cuatro empresas, dos administradores y seis personas de ejemplo que pasan por el mismo reductor |
| `actors.ts` | Quién es una persona: la regla de la Constitución compartida por Referidos y Marketplace |
| `display.ts` | Límites de visualización (ver abajo) |
| `marketplace.ts` (ya existía) | Reparto de ingresos en enteros (`splitRevenue`), que este módulo reutiliza |

**Qué ofrece:** siete tipos (producto, servicio, curso, agente IA, automatización, app, recurso digital) y nueve categorías; búsqueda sin distinguir acentos ni mayúsculas, con todas las palabras requeridas y orden por relevancia; filtros por tipo, categoría, precio (gratis, de pago, único, suscripción), moneda, tope de precio y calificación mínima; orden por relevancia, novedad, calificación, ventas y precio. Precio único, suscripción (mensual o anual con renovación simulada) y gratis. Compras, descargas (con un máximo por compra), favoritos por persona, calificaciones de 1 a 5 y reseñas con respuesta del vendedor y ocultamiento por moderación (nunca se borran). Panel del vendedor (ventas, bruto, comisión, neto, por liquidar, liquidado, descargas, favoritos, calificación, reseñas por responder) y de administración (cola de moderación, volumen, comisión, por pagar a vendedores, cambios y liquidaciones pendientes).

**Constitución de NEX (con pruebas):**
- **Toda publicación requiere aprobación.** El vendedor la envía y **otra** persona de la administración la aprueba: quien la envió no puede aprobarla, y ser llamado «admin» no basta: la lista de administradores vive en el estado, no en lo que diga el evento. Antes de aprobar se vuelven a comprobar los requisitos objetivos (nombre, versión, precio, política de privacidad si lee datos personales, soporte si actúa fuera, capacidades declaradas, archivo en un recurso digital). Rechazar exige un motivo.
- **Un cambio a algo ya publicado vuelve a revisión**, y la versión en vivo no cambia hasta que se aprueba. Suspender exige motivo; **reponer una suspendida también necesita una segunda aprobación**.
- **NEX puede preparar un borrador (Nivel 1) y nada más:** no lo envía, no publica, no compra, no modera, no cambia el reparto ni liquida. Las acciones están en el catálogo de trabajadores (`marketplace.publish`, `purchase`, `revenueShare` y `settlement` en Nivel 3; `draftListing` en Nivel 1) y ninguna autorización puede bajarlas.
- **Todo cambio del reparto económico es Nivel 3:** un administrador lo propone y otro distinto lo aprueba; va de 0 a 50 %; solo se admite uno en espera por alcance; aplica **solo a cobros futuros** (cada cobro guarda el reparto con el que se hizo) y puede ser general o por publicación.
- **Las liquidaciones a vendedores también son Nivel 3** y están desacopladas de las pasarelas: se solicitan, otro administrador las aprueba y se registran como pagadas con una referencia externa. Rechazar una devuelve los ingresos a «por liquidar».

**Multiempresa:** el catálogo es global, pero cada compra, descarga, favorito, reseña y publicación pertenece a una empresa; una empresa no puede comprar lo suyo, ni editar, retirar, descargar, cancelar o reseñar lo de otra. Los paneles y listas se calculan por empresa.

**Historial: nunca se recorta.** Ningún registro, log ni auditoría se elimina; los límites se aplican solo a lo que muestra la pantalla (`display.ts`: las 40 entradas más recientes y un aviso de cuántas más hay). Vale igual para Integraciones, Pagos y Referidos.

**Pendiente al conectar:** tablas con RLS por empresa y clave compuesta; almacenamiento y análisis de archivos descargables (antivirus, firma, límites); cobro real y retención de impuestos a vendedores; reembolsos de compras (hoy no existen) y su efecto en liquidaciones; revisión legal de términos de vendedor y de contenido; búsqueda a escala (índice) y moderación de reseñas con apoyo; y el análisis de riesgo de que un agente o app instalado actúe fuera de la plataforma (sandbox y permisos reales).

## 10. Academy v1

Mismo enfoque que los demás centros: contratos puros más un reductor, con simulación local en `/platform/academy`. **Sin APIs, sin video real, sin modelo de IA, sin migraciones; todo con datos de ejemplo.**

| Archivo (`lib/contracts/platform/`) | Contenido |
|-------------------------------------|-----------|
| `academy-center.ts` | Estado y `reduceAcademy`: cursos, lecciones, exámenes, progreso, certificados, tutor, accesos por compra; revisión objetiva, calificación, tutor simulado y paneles |
| `academy-messages.ts` | Todos los textos por código. Hoy solo español (el idioma del **contenido** de cada curso es otro campo) |
| `academy-demo.ts` | Tres empresas, dos administradores y seis personas de ejemplo que pasan por el mismo reductor |
| `academy.ts` (ya existía) | Tipos y reglas base de progreso y certificado de la primera versión |

**Qué cubre:**
- **Cursos propios** de cada empresa (solo su equipo), **oficiales de KYNOVA** (visibles para todas las empresas) y **cursos a la venta en el Marketplace**. `toMarketListing` convierte un curso en el contenido de una publicación de tipo «curso»; el Marketplace la revisa y aprueba con sus propias reglas (una prueba comprueba que cumple sus requisitos). La compra produce un acceso (`entitlement.grant`) que hoy simula la pantalla y mañana emitirá un adaptador; revocarlo cierra el acceso, pero un certificado ya ganado se conserva.
- **Lecciones** de video, PDF, archivo y lectura. Los archivos son referencias con nombre y tamaño: solo extensiones permitidas (nada de ejecutables ni scripts) y límites por tipo.
- **YouTube privado y contenido premium: arquitectura lista, sin conexión.** Se declaran como fuentes de medios con lo que falta confirmar (`MEDIA_SOURCES`: OAuth y permiso de incrustación, DRM y licencias, cuotas, corte de acceso). Un curso que use una no se puede publicar todavía; la pantalla lo marca como «no conectado».
- **Exámenes** de pregunta simple, múltiple y verdadero o falso, con puntos, nota mínima, intentos y tiempo límite. Se califican **por código**: múltiple es todo o nada, una respuesta fuera de las opciones se rechaza sin gastar el intento, uno abandonado vence y cuenta. El alumno ve su nota y qué preguntas falló, nunca cuáles eran las correctas.
- **Progreso** sobre las lecciones obligatorias, con orden secuencial opcional.
- **Certificados** por regla (lecciones obligatorias hechas y exámenes obligatorios aprobados). Código único `KYN-XXXX-XXXX-XXXX`, verificable por cualquiera: la verificación devuelve solo nombre, curso, fecha, emisor y vigencia. Se revocan con motivo; se puede volver a ganar uno nuevo.
- **Multiempresa:** cada inscripción, intento, certificado y pregunta al tutor pertenece a una empresa; un curso interno es invisible para otras, y el panel del instructor cuenta solo lo suyo.
- **Multiidioma desde el inicio:** cada curso declara su idioma (8 disponibles) y el catálogo filtra por él; los textos del producto salen de un diccionario por código.

**Constitución de NEX (con pruebas):**
- **NEX prepara, no decide.** Puede dejar un **borrador** de curso o editar un borrador (Nivel 1). No publica, no revisa, no archiva, no inscribe, no completa lecciones, no califica, no certifica, no concede accesos ni activa su propio tutor.
- **NEX como tutor es Nivel 2:** responde solo si el dueño del curso activó el tutor (esa activación es la autorización, y solo la da una persona), dentro de un **límite diario** por alumno, **solo con el contenido de las lecciones del curso** (cada respuesta cita su fuente; sin fuente, se rechaza) y **nunca mientras hay un examen en curso**. Si el material no responde, la pregunta **pasa al instructor**. Si el dueño apaga el tutor, deja de poder responder incluso lo ya preguntado.
- **Un curso oficial lo aprueba una segunda persona de la administración** (quien lo envía no puede aprobarlo), y un cambio a uno ya publicado vuelve a revisión mientras sigue visible la versión aprobada. Los cursos propios los publica su equipo tras pasar la revisión objetiva.
- **Un certificado lo decide una regla; solo una persona o el sistema lo reclama y solo una persona lo revoca**, con motivo.
- Nuevas acciones en el catálogo de trabajadores: `academy.draftCourse` (Nivel 1), `academy.tutorAnswer` (Nivel 2), `academy.publishOfficial` y `academy.certificate` (Nivel 3).

**El tutor de la simulación** (`simulateTutorAnswer`) es determinista: solo cita frases de las lecciones y devuelve nada cuando no hay coincidencia. Sustituye a NEX hasta conectar un modelo, que deberá cumplir el mismo contrato (respuestas con fuentes, por el mismo evento y con las mismas reglas).

**Historial: nunca se recorta** (límites solo en pantalla, `display.ts`).

**Pendiente al conectar:** tablas con RLS por empresa y clave compuesta; almacenamiento y entrega de archivos (URLs firmadas, antivirus, transcodificación de video); YouTube privado y premium (ver lo que falta confirmar en cada fuente); recuperación y evaluación del tutor con modelo (calidad de las fuentes, evals, qué hacer con material desactualizado); prevención de trampas en exámenes (aleatorizar, banco de preguntas, supervisión); certificados con firma verificable y página pública; reembolsos de cursos vendidos y su efecto en accesos; traducciones del producto y del contenido; y la ley aplicable a certificados y datos de menores.

## 11. NEX Workers y KOE (KYNOVA Orchestration Engine) v1

NEX Workers no son agentes aislados: son especialistas que colaboran bajo **KOE**. Mismo enfoque que los demás centros: contratos puros más un motor determinista, con simulación local en `/platform/workers`. **Sin modelos ni herramientas reales, sin red, sin migraciones; todo con datos de ejemplo.**

| Archivo (`lib/contracts/platform/`) | Contenido |
|-------------------------------------|-----------|
| `koe-registry.ts` | Los registros que lee el motor: herramientas, modelos (neutros respecto al proveedor) con su enrutador, definiciones de Worker y su validación, los Workers de KYNOVA, y las reglas de la memoria de trabajo |
| `koe-engine.ts` | Estado y `reduceKoe`: instancias por empresa, ejecuciones, pasos, aprobaciones, delegación, memoria, autorizaciones, interruptores de parada, auditoría y la trazabilidad (`explainRun`) |
| `koe-messages.ts` | Todos los textos por código. Hoy solo español |
| `koe-demo.ts` | Tres empresas, dos administradores y seis personas de ejemplo que pasan por el mismo motor |
| `workers.ts` (ya existía) | El catálogo único de niveles de autonomía; KOE lo lee y no lo duplica |

**Un Worker es un dato, no código.** Su definición declara especialidad, herramientas permitidas, nivel de datos que puede manejar, política de memoria, capacidades de modelo que necesita (y proveedores permitidos o excluidos), con quién colabora y límites. **Crear un Worker nuevo, sumar una herramienta o un modelo es agregar una entrada, sin tocar el motor**: la pantalla «Crear» lo demuestra con un formulario que muestra, antes de existir, su autonomía máxima, lo que hace fuera de la plataforma o con dinero, y lo que falta para cumplir los requisitos.

**Constitución de NEX (con pruebas):**
- **El nivel lo decide el código, nunca el Worker.** Cada herramienta toma su nivel del catálogo de `workers.ts`; una acción que no está ahí es Nivel 3. Nivel 1 se ejecuta; **Nivel 2 solo dentro de una autorización activa que una persona concedió**, con límite diario y vencimiento opcionales (una autorización solo se puede dar a acciones de Nivel 2 que el Worker tiene; Nivel 3 nunca se autoriza); **Nivel 3 siempre espera a una persona**, y mientras espera la ejecución no puede dar otro paso. Una acción que mueve dinero la aprueba una persona **distinta** de quien inició el trabajo. Una aprobación que nadie responde vence a las 24 h y no se ejecuta.
- **Delegar no amplía poderes.** Ambas partes deben aceptarse (el emisor lista al receptor y el receptor acepta al emisor); no hay ciclos; la profundidad la limita el tope más bajo de la cadena. Una delegación solo concede herramientas del receptor que sean de Nivel 1 o que el emisor **ya tenga**: no se puede obtener por delegación una acción de Nivel 3 que uno no tiene, y el hijo no usa nada fuera de lo concedido. Las aprobaciones del hijo siguen yendo a personas, y la persona que inició el trabajo se conserva a lo largo de la cadena.
- **Los datos sensibles no cruzan a quien no está habilitado.** Lo que el delegador comparte se filtra contra el nivel de datos del receptor (lo retenido queda en el registro); el resultado de un hijo que tocó datos personales **no vuelve** a un delegador que no está habilitado para ellos.
- **NEX y los Workers solo preparan.** NEX puede dejar un **borrador** de Worker (Nivel 1); no lo envía, aprueba, activa, autoriza ni retira, ni inicia ejecuciones ni decide aprobaciones. Un Worker nuevo lo envía una persona y lo aprueba **otra de la misma empresa**; uno oficial de KYNOVA, un administrador y un segundo administrador. Una herramienta nueva queda pendiente hasta que **otro administrador** la aprueba.
- **Se puede detener todo.** Una persona detiene los Workers de su empresa; un administrador, los de toda la plataforma; también se pausa una instancia o se retira un Worker (cancela sus ejecuciones). El interruptor gana sobre todo lo demás y mientras está activo nada se ejecuta, aunque sí se puede rechazar.

**KOE y varias IA, sin depender de una.** Cada tarea pide **capacidades** (razonamiento, rápido, visión, código, contexto largo, embeddings, multilingüe), un nivel de datos, tamaño de contexto, herramientas y región. El enrutador elige el modelo **sano más barato** que cumple, con la **política de datos como regla dura**: datos personales solo a un modelo que no entrena con ellos, datos del negocio a uno que no «puede entrenar»; los modelos caídos se saltan, los degradados quedan detrás de los sanos y se registra el respaldo. Lo que la ejecución ya tocó (p. ej. leer un contacto) sube el nivel de datos de las consultas siguientes y una tarea no puede pedir menos protección. Ningún nombre de proveedor está en la lógica; el catálogo de modelos de la simulación usa nombres neutros y el real saldrá de la configuración de AI Gateway. Las llamadas reales pasarán **solo** por `lib/ai/` y AI Gateway.

**Memoria de trabajo.** Es de la ejecución: al terminar o cancelarse se **borran los valores** y queda solo la huella de que existieron. Una persona puede conservar una entrada 30 días si el Worker conserva memoria; los **datos personales nunca se conservan** (viven en el CRM). Nunca entran secretos, claves, referencias a secretos ni datos con forma de tarjeta. Cada Worker tiene tope de entradas y de caracteres. Una persona puede hacer olvidar cualquier entrada.

**Auditoría completa y sin recortes.** Cada evento deja su rastro con quién, qué, la empresa y la ejecución, **también los intentos rechazados** de algo sensible; cada paso guarda su decisión y su nivel; `explainRun` arma la traza anidada de una ejecución y de lo que delegó. Ningún dato se recorta (los límites son solo de pantalla).

**Multiempresa.** El catálogo de definiciones es global, pero las instancias, ejecuciones, memoria, autorizaciones y aprobaciones son de cada empresa; una empresa no ve, pausa, aprueba ni cancela lo de otra, y los Workers a medida de una empresa no se pueden activar en otra.

**Pendiente al conectar:** tablas con RLS por empresa; adaptadores reales de herramientas (cada uno detrás de su contrato) y de modelos (AI Gateway, con evals); costos y presupuestos reales por ejecución; ejecución asíncrona y reanudación (colas, reintentos, tiempos de espera); evaluación de la calidad de cada Worker antes de activarlo; sandbox para Workers de terceros del Marketplace; y la definición legal de la responsabilidad por lo que un Worker prepara y una persona aprueba.

### 11.1 Centro de Workers: instalación y configuración por empresa

Complementa el punto anterior sin cambiar lo aprobado. En `/platform/workers`, pestaña **Workers**:

- **Instalados en su empresa / Disponibles para instalar / En preparación y retirados.** Un Worker se instala por empresa (instancia); el mismo Worker puede estar instalado en una y disponible en otra.
- **Tres estados por empresa:** **Activo**; **En pausa** (temporal: se reanuda cuando se quiera); **Deshabilitado** (apagado: no se inicia nada, se cancelan sus ejecuciones vivas y lo que delegaron, se rechazan sus aprobaciones pendientes y queda así hasta que una persona lo habilita). Pausar solo sale de activo y reanudar solo sale de pausa; un Worker deshabilitado no se reactiva por pausa ni por reanudar. Retirar un Worker no convierte una instancia deshabilitada en pausada.
- **Qué modelos puede usar cada Worker** (`modelAvailability`): se evalúa cada modelo del registro contra lo que el Worker necesita y el dato más sensible que puede manejar, con la política de datos como regla dura; se muestra cuáles puede usar y por qué no los otros. La salud del modelo no cuenta aquí (cambia por minuto); sí la desactivación. **No se conecta ninguna API.**
- **Qué herramientas puede usar,** con su nivel de autonomía de la Constitución, y si actúan fuera de la plataforma o mueven dinero (ya existía; se conserva).
- **Configuración por empresa** (`instance.configure`): puede **bajar** el máximo de ejecuciones por día (nunca superar el de la definición) y **excluir proveedores de modelos** para ese Worker; las exclusiones de la empresa se suman a la política del Worker, nunca la ensanchan. Solo la decide una persona de esa empresa; NEX no puede cambiar el estado ni la configuración.

### 11.2 Prioridad y costo estimado de un Worker

Dos datos nuevos en cada definición, pensados para las métricas futuras de KOE. No cambian lo aprobado ni limitan nada.

- **Prioridad:** Baja, Normal, Alta o Crítica. Ordena las aprobaciones pendientes (más prioritarias primero, y a igual prioridad la más antigua). Una ejecución delegada hereda la mayor entre la del Worker que delega y la del Worker delegado: delegar nunca baja la prioridad. La empresa puede **cambiar** la prioridad de su instancia; no cambia la de la definición.
- **Costo estimado por ejecución** (`costEstimate.perRunMicros`, en millonésimas de dólar; tope de validación US$5 por ejecución). Cada ejecución guarda una **copia** del costo y de la prioridad al iniciar, así que cambiar la definición después no reescribe el historial. `koeMetrics` suma el costo estimado por empresa. **No es una factura ni un presupuesto:** es una estimación para comparar Workers; el costo real llegará con los adaptadores de modelos.

## 12. Centro de Automatizaciones v1

`/platform/automations`. Todo es simulación local: contratos más un único reducer (`reduceAutomations`), sin APIs, sin migraciones y sin dependencias nuevas.

**Qué ofrece.** Crear, editar, duplicar, pausar y eliminar automatizaciones, con tres estados: **Borrador**, **Activa** y **Pausada**. Seis disparadores (nuevo prospecto, nuevo cliente, pago recibido, reunión creada, formulario enviado, manual) y seis acciones: crear tarea, crear recordatorio, notificación interna, **preparar** correo, **preparar** WhatsApp y crear evento pendiente. Condiciones opcionales (igual, distinto, mayor, menor, contiene; todas deben cumplirse) sobre los campos del propio disparador. Plantillas con `{{campo}}` rellenadas con los datos del evento.

**Constitución de NEX.**
- Las seis acciones son **nivel 1** en el catálogo único de autonomía (`ACTION_LEVELS`): preparan algo dentro de la plataforma y **nada se envía, se escribe fuera ni mueve dinero**. Un borrador de correo o de WhatsApp sigue siendo borrador; «Hecho» significa que una persona lo atendió fuera de la plataforma. Cualquier acción que no esté en el catálogo es nivel 3.
- Toda automatización **nace en modo de prueba**: activarla no crea nada; solo registra lo que habría hecho. Pasar a «en vivo» es una decisión explícita de una persona.
- **NEX solo puede dejar borradores:** crear y duplicar (siempre como borrador en modo de prueba) y editar sus propios borradores. Activar, pausar, eliminar, pasar a en vivo, probar, ejecutar, detener o resolver resultados exige una persona.
- Correo y teléfono del evento solo pueden ir en borradores de correo o de WhatsApp; nunca en tareas, recordatorios, avisos o eventos. Los marcadores deben existir en el disparador. Los valores del evento se tratan como datos: no se vuelven a expandir y se les quitan los caracteres de control.
- Editar una automatización activa la **pausa** y sube su versión; eliminar exige pausarla antes. Lo que ya hizo (ejecuciones y resultados) se conserva.

**Integración con KOE desde el diseño** (`automation-koe.ts`).
- **Cada automatización se ejecuta mediante un Worker** de KOE (`workerId`). El Worker aporta sus herramientas, el nivel de datos que puede manejar, su prioridad y su costo estimado. Para ello existe el Worker **Automatizador** (Nivel 1: solo prepara) y tres herramientas registradas en KOE (`reminder.create`, `notification.internal`, `event.prepare`).
- **El modelo lo elige el enrutador de KOE**, no la automatización: según lo que el Worker necesita, el nivel de datos (los borradores con correo o teléfono exigen un Worker con nivel «personal»), la política de datos y la salud de los modelos. La elección **se registra** en cada ejecución (Worker, prioridad, costo estimado, modelo y motivo); **ningún modelo se llama** y los módulos de automatización no importan `lib/ai` ni tocan la red (lo verifica una prueba).
- **«Configuración pendiente»:** sin Worker asignado, o con uno que no sirve (no existe, no está activo, es de otra empresa, no tiene la herramienta o no puede manejar datos de contacto), la automatización queda en ese estado y no se puede activar, probar ni poner en vivo. Al asignar un Worker válido pasa a Borrador; al quitarlo, vuelve a pendiente. Si el Worker deja de servir después, la ejecución se **omite** con el motivo y no crea nada.
- **Prioridad:** cuando un evento activa varias automatizaciones, corren primero las de Workers con mayor prioridad (a igual prioridad, por orden de creación).
- **Costo estimado:** cada ejecución guarda una copia; el centro suma las ejecuciones **en vivo** y lo presenta como estimación, no como factura. La UI muestra Worker, prioridad y costo en cada automatización y en cada ejecución.
- **Biblioteca de Automatizaciones (futura):** solo existe el modelo. `AutomationTemplate` (una automatización sin empresa ni Worker), `inputFromTemplate` y el campo `source` (id y versión de la plantilla), que se conserva al editar y duplicar y no se puede reescribir. **No hay catálogo ni pantalla de plantillas;** la empresa siempre elige su Worker.
- **Pendiente al conectar:** que el Worker esté instalado y activo en la empresa (estado de instancia de KOE, hoy solo se mira la definición), los interruptores de KOE y la configuración de proveedores por empresa, y el costo real por ejecución.

**Seguridad operativa.** Un evento con el mismo identificador se procesa una sola vez por empresa; como máximo 60 ejecuciones por automatización por hora (el exceso queda registrado como «omitida»); lo que una automatización crea nunca dispara otra (sin bucles); un interruptor detiene todas las automatizaciones de la empresa. Una empresa no ve ni cambia las de otra. **Nada se recorta:** ejecuciones, resultados, auditoría y registros se conservan completos; el límite de 40 solo afecta a lo que se muestra.

**Pestañas:** Automatizaciones (lista y acciones), Crear y editar (con validación en vivo), Simular eventos (datos de ejemplo e identificador), Resultados (lo preparado y las ejecuciones) y Actividad.

**Textos y multilenguaje.** Todos los textos salen de `automation-messages.ts` por código; solo existe el español, y otro idioma es un diccionario nuevo.

**Pendiente al conectar:** tablas con RLS por empresa; que la plataforma emita los eventos reales (hoy se simulan); un destino real para tareas, recordatorios y notificaciones; envío de los borradores solo mediante aprobación y el nivel que decida la Constitución; condiciones más ricas y esperas entre acciones; y plantillas oficiales de automatización en el Marketplace.

## 13. AI Studio v1

`/platform/studio`. Es donde una empresa **crea, prueba y administra** la inteligencia de KYNOVA. Todo es simulación local: contratos más un único reducer (`reduceStudio`), sin APIs, sin modelos reales, sin migraciones y sin dependencias nuevas. **Studio solo guarda configuraciones y pruebas;** no llama a ningún proveedor ni conoce sus nombres (la interfaz solo muestra la etiqueta del modelo).

**Arquitectura: todo pasa por KOE.** Una prueba no elige modelo. KOE elige el **Worker** (`chooseWorker`: entre los que pueden ejecutar un prompt con ese nivel de datos; prefiere la especialidad de la categoría, luego mayor prioridad y menor costo; si el agente tiene Workers asignados, solo entre ellos) y el **Worker decide el modelo** con el enrutador de KOE (`planExecution`: capacidades, nivel de datos, política y salud). Cada prueba guarda: Worker y motivo, modelo y motivo, **costo estimado** (costo del Worker por ejecución más los tokens al costo del modelo), **tiempo estimado** y tokens. Son estimaciones, no mediciones ni una factura. Una prueba sin Worker o sin modelo disponible se **rechaza** y no deja registro. Una prueba nunca llama a un modelo; una prueba automática verifica que los módulos de Studio no importan `lib/ai`, no usan la red ni nombran proveedores.

**Qué ofrece**
- **Panel:** conteos por estado, versiones, pendientes de aprobación (con aprobar y rechazar), pruebas y costo estimado, plantillas y acuerdos, y la autorización de Nivel 2.
- **Biblioteca de Prompts y de Agentes IA:** búsqueda por nombre o etiqueta, filtro por categoría (ventas, atención, marketing, educación, operaciones, análisis, otra), estado (Borrador, En revisión, Publicado, Archivado), origen (propio, copia, plantilla) y todas las versiones de cada elemento.
- **Constructor:** crear, editar, duplicar y versionar. **Variables dinámicas** `{{nombre}}`: se declaran exactamente las que usa el texto (con descripción y ejemplo), los nombres son estrictos, los valores se tratan como datos (no se vuelven a expandir y se les quitan los caracteres de control) y el texto no puede contener secretos. Categorías y etiquetas validadas. El **agente** se compone de prompt principal, Workers (hasta 5), automatizaciones y cursos de la Academia de su empresa (hasta 10 de cada uno), **memoria** (ninguna, de sesión o duradera; la duradera no admite datos personales), **personalidad** (tono, idioma, estilo) y **límites** (ejecuciones por día, pasos y costo máximo por ejecución; las pruebas los respetan).
- **Playground:** probar una versión con datos de entrada, elegir un Worker o dejar que KOE elija, **comparar dos versiones** (ambas por el mismo Worker, todo o nada) con diferencia de texto, costo y tiempo, e **historial de pruebas** completo.
- **Historial:** pruebas y registro de actividad de la empresa.

**Constitución de NEX**
- **Nivel 1 prepara:** crear, guardar una versión nueva, duplicar y enviar a revisión (`studio.draft`); probar (`studio.test`, lo inicia una persona porque gasta costo estimado).
- **Nivel 2 con autorización:** cambiar a qué está conectado un agente (Workers, automatizaciones, cursos) exige una **autorización vigente** que una persona concedió (`studio.assign`, con límite diario y vencimiento opcionales). Con ella, NEX y el equipo pueden hacerlo; sin ella o agotada, se rechaza. Duplicar un agente conectado también la usa.
- **Nivel 3 siempre una persona:** publicar o rechazar una versión (`studio.publish`) y compartir entre empresas (`studio.share`). **NEX nunca publica;** una versión que NEX envía queda «pendiente de aprobación» hasta que una persona la apruebe. Un agente solo se publica si su prompt principal tiene una versión publicada. Archivar, crear plantillas y revocar también son de una persona.
- **Las versiones nunca se sobrescriben:** cada guardado es una versión nueva; el contenido de una versión no cambia jamás (solo su estado, y cada cambio queda en el registro). Una versión publicada pasa a «Reemplazada» cuando otra se publica, pero se conserva. **Nada se recorta:** versiones, pruebas, registro y actividad se guardan completos; el límite de 40 solo afecta a lo que se muestra.
- **Aislamiento por empresa:** una empresa no ve ni cambia lo de otra.

**Preparado para el Marketplace y para compartir (solo el modelo)**
- `PromptTemplate` y `AgentTemplate` con `author`, `company`, `source` (origen y referencia), `version` y la versión de origen. Una plantilla de agente **no lleva** las conexiones (prompt, Workers, automatizaciones, cursos) porque son de cada empresa; al crear un borrador desde ella se elige el prompt principal. `toMarketplaceDraft` muestra cómo sería un borrador de publicación (agente IA o recurso digital): **no crea ningún listado;** publicar en el Marketplace es Nivel 3 y no se construye aquí. No existe el Marketplace de prompts.
- **Compartir entre empresas:** `share.propose` (una persona o NEX), `share.approve` (una persona de la empresa dueña) y `share.revoke`. Un acuerdo aprobado **es solo un registro:** todavía no se copia nada y la otra empresa no ve nada.

**Integraciones.** *Workers y KOE:* cada prueba y cada agente usan Workers del registro de KOE. *Automatizaciones:* un agente puede referenciar automatizaciones de su empresa (por id); referenciarlas no le da poder para ejecutarlas (las automatizaciones solo preparan, Nivel 1, y las ejecuta una persona o un evento). *Academia:* un agente puede referenciar cursos de su empresa; actuar como tutor sigue siendo Nivel 2 en la Academia. *Marketplace:* plantillas listas, sin listado.

**Pendiente al conectar:** tablas con RLS por empresa; el registro real de Workers y modelos de KOE (hoy el de ejemplo); tokens y costos reales; la lectura de las automatizaciones y cursos reales en lugar de referencias de ejemplo; la importación de lo compartido por otra empresa; el Marketplace de prompts; evals de calidad antes de publicar un prompt; y revisión legal del uso compartido entre empresas.

## 14. Insights e Inteligencia Empresarial v1

`/platform/insights`. El centro donde una empresa mide productividad, ahorro, rendimiento, automatizaciones, IA y crecimiento con lo que KOE registró. Todo es simulación local: eventos simulados, sin APIs, sin modelos reales, sin migraciones, sin dependencias nuevas y sin llamadas externas.

**KOE es la única fuente de verdad.** Hay **un solo motor de cifras**, `koe-insights.ts` (`computeInsights`); las pantallas solo dan formato y no cuentan nada (una prueba lo verifica: las palabras de las cifras solo existen en ese archivo, y las pantallas no contienen cálculos). La entrada es el **registro de KOE** (`koe-ledger.ts`):
- **Ejecuciones:** lo que KOE enrutó, leído de los registros que cada módulo ya guarda y convertido a una forma neutral por adaptadores: las corridas de Workers de KOE (`executionsFromKoe`, las mismas que suma `koeMetrics`, y una prueba confirma que los totales coinciden), las ejecuciones en vivo de Automatizaciones y las pruebas de AI Studio. Cada una trae Worker, especialidad, modelo elegido por KOE, si hubo respaldo, resultado, costo, tiempo y el proceso manual que reemplazó.
- **Hechos:** lo que reportan los demás módulos (prospecto nuevo, lección completada, total cobrado…), con una **métrica cerrada**, un número y una fecha: sin texto libre. El dinero es un total estimado en millonésimas de dólar; **no existe ningún campo para cuentas, tarjetas o bancos.** En la simulación los genera un generador determinista; después vendrán del flujo de eventos de KOE.

**Qué muestra (8 pestañas):** *Resumen ejecutivo* (ROI, horas ahorradas, automatizaciones ejecutadas, Workers y agentes activos, prompts más usados, clientes atendidos, prospectos convertidos, tareas completadas, costo IA, ahorro, tiempo de respuesta) · *Analítica* (un gráfico por módulo: ventas, marketing, SEO, CRM, Academia, Marketplace, referidos, automatizaciones, Workers, pagos, integraciones) · *IA* (por Worker, por modelo, por especialidad, tiempo y costo promedio, éxito, errores, respaldos, modelos preferidos por KOE y comparaciones) · *Productividad* (horas ahorradas, tiempo automatizado, procesos manuales eliminados, tiempo por departamento, ranking de procesos) · *Finanzas* (ROI, costo IA, costo por Worker, por agente, por automatización y de la empresa, ingresos estimados y valor generado) · *Clientes* (nuevos, activos, perdidos, conversión, embudo, retención) · *KOE* (Worker más eficiente, más usado, más costoso y más rápido; automatización, prompt, agente y especialidad más usados; modelo recomendado; eventos procesados) · *Reportes*.

**Supuestos declarados (todo es estimado, nunca una factura).** Una hora de trabajo manual vale US$ 20 (`DEFAULT_HOURLY_RATE_MICROS`); cada proceso tiene los minutos manuales que reemplaza (`PROCESSES`); un proceso cuenta como «eliminado» tras 2 ejecuciones automáticas exitosas; un modelo se recomienda con al menos 2 usos, por mayor éxito, menor costo y menor tiempo; una prueba de AI Studio no reemplaza ningún proceso. **ROI** = (valor generado − costo estimado de IA) ÷ costo, donde valor = ahorro de horas + ingresos atribuidos; se muestra como múltiplo. El costo cuenta solo la IA estimada, no licencias ni personal. Sin datos, las razones son «—», no ceros inventados.

**Multiempresa.** Lo primero que hace el motor es quedarse con los registros de **una sola empresa** (`tenant_id`); una prueba comprueba que miles de registros de otra empresa no cambian ni un número, y que cada empresa solo ve lo suyo. Nunca se suman empresas.

**Constitución de NEX.** NEX puede **preparar borradores de reportes**, editarlos, hacer exportaciones simuladas y proponer una corrección. **Nunca** modifica métricas, borra historial ni altera estadísticas: no existe ningún evento que edite o borre un hecho, una ejecución, un registro o la auditoría (una prueba lo verifica), y los hechos solo los registra la plataforma. Una cifra equivocada se corrige con una **corrección**: se propone con su motivo, **una persona la aprueba**, y se guarda como un hecho nuevo que compensa la diferencia; el original se conserva y la auditoría dice quién aprobó. Aprobar, programar y compartir un reporte son decisiones de una persona (Nivel 3).

**Reportes (solo arquitectura).** Un reporte es una definición (nombre, secciones, formato PDF o Excel): borrador → aprobado. **Programar** (semanal o mensual) y **compartir** (con personas del equipo; sin correos externos) son registros: no corre ninguna tarea ni se envía nada. **Exportar** crea una descripción simulada (`simulated: true`, nombre del archivo y secciones): no se genera ningún archivo.

**Preparado para el futuro, no implementado** (`FUTURE_CAPABILITIES`): Forecast, Predicciones, Análisis IA, Benchmark, Machine Learning y Recomendaciones. Cada uno será un Worker de KOE que lea este mismo registro, para que las cifras sigan teniendo una sola fuente; hoy ninguno existe.

**Pendiente al conectar:** que KOE emita su flujo real de eventos y cada módulo reporte sus hechos; tablas con RLS por empresa; tiempos y costos reales; la tarifa por hora y los minutos por proceso configurables por empresa; generación real de archivos y tareas programadas; y las capacidades futuras.

## 15. NEX CRM Intelligence v1

`/platform/crm`. Un CRM que se siente como tener a un vendedor trabajando 24/7: KOE analiza y recomienda, NEX prepara, y una persona decide. Todo es simulación local: sin APIs, sin modelos reales, sin migraciones, sin dependencias nuevas y sin llamadas externas.

**Toda la inteligencia viene de KOE, y hay un solo motor** (`koe-crm.ts`): puntaje del prospecto y de la oportunidad, probabilidad de cierre, nivel de riesgo y sus motivos, valor y tiempo esperados, siguiente mejor acción y su motivo, los mensajes del asistente, el panel comercial, el pipeline y el Cliente 360. Las pantallas solo dan formato y ningún otro módulo repite estas reglas (una prueba verifica que las reglas viven en un solo archivo y que las pantallas no calculan). Las reglas están declaradas para poder explicar cada número: base por etapa, puntaje del prospecto con su Business Audit y sus contactos de los últimos 30 días, y una resta por el tiempo sin contacto; el riesgo suma puntos por días sin contacto, días en la etapa por encima de lo normal, puntaje bajo y tareas vencidas.

**Cada análisis pasa por KOE y queda registrado** (`crm-center.ts`): KOE elige el Worker (Asistente comercial, el único con nivel de datos personal) y el enrutador elige el modelo; el análisis guarda ese Worker, el modelo y su motivo, y el costo estimado. Los análisis **se añaden, nunca se reescriben**: el historial muestra cómo cambió el puntaje (con el valor anterior). Sin Worker o sin modelo disponible, KOE rechaza el análisis y no inventa uno; un cambio hecho por una persona se conserva y queda anotado como «análisis pendiente».

**Qué ofrece (7 pestañas):** *Dashboard* (prospectos nuevos y activos, oportunidades, clientes, ventas estimadas, conversión, próximas acciones, reuniones y actividad reciente) · *Pipeline* tipo Kanban (Prospecto, Calificado, Reunión, Propuesta, Negociación, Ganado, Perdido; cada tarjeta con puntaje de lead y de oportunidad, siguiente acción, valor, tiempo en la etapa, riesgo y responsable) · *Oportunidad* (probabilidad, riesgo, valor esperado, tiempo esperado, siguiente mejor acción, el porqué, el Worker y el modelo de KOE y el historial de análisis) · *Línea de tiempo* (correos, WhatsApp, llamadas, notas, reuniones, automatizaciones, Workers, Business Audit y NEX, en orden cronológico) · *Tareas* inteligentes · *Cliente 360* (empresa, contactos, pipeline y lo que KOE conecta: productos, Academia, Marketplace, automatizaciones, Workers, pagos y referidos) · *Asistente de ventas* («Este prospecto tiene alta probabilidad», «Recomiendo llamar hoy», «Han pasado 5 días», «Existe riesgo de perder la oportunidad», «Este cliente puede comprar otro servicio»).

**Business Audit integrado.** Cada resultado (lo reporta la plataforma, nadie lo escribe) se **añade** al prospecto, y KOE actualiza el puntaje de oportunidad, las recomendaciones (reusa el motor de `lib/assessment.ts`, sin duplicarlo), la prioridad y el riesgo. El audit anterior se conserva; una prueba lo verifica.

**Constitución de NEX**
- **Nivel 1, prepara:** crear un prospecto, actualizar el análisis y proponer tareas con su borrador (correo, WhatsApp, reunión, propuesta, seguimiento, llamada). Son propuestas: **no existe ningún evento que envíe o ejecute algo.**
- **Nivel 2, con autorización vigente:** mover una etapa automáticamente, de a una hacia adelante y solo hasta Negociación, cuando una persona concedió la autorización (con límite por día y vencimiento) **y** las reglas de KOE lo recomiendan (puntaje mínimo por etapa y contacto reciente). Nunca hacia atrás, y sin autorización o agotada, se rechaza.
- **Nivel 3, siempre una persona:** ganar o perder un negocio (perder exige un motivo), convertir un prospecto en cliente (solo si está ganado, una vez), aceptar, completar o descartar una tarea, registrar un contacto, agendar una reunión, editar los datos de un prospecto y conceder o revocar autorizaciones. **NEX nunca cierra una venta, nunca convierte un cliente y nunca elimina información.**
- **Nada se elimina ni se sobrescribe:** no existe ningún evento para ello. Las etapas, contactos, audits, análisis y la línea de tiempo solo crecen; al editar un prospecto, los valores anteriores quedan en la auditoría. Las automatizaciones y los Workers reportan lo que hicieron a través de la plataforma (`timeline.record`, `customer.link`), no una persona ni NEX. Un pago en el Cliente 360 es solo un total: no hay ningún campo para datos bancarios.

**Multiempresa.** Todo lleva `tenant_id`: las vistas, el motor y cada evento se limitan a una empresa; una prueba comprueba que el trabajo de otra empresa no cambia ni una cifra y que cada cambio sobre algo ajeno se rechaza.

**Preparado para el futuro, no implementado** (`FUTURE_CRM`): predicción de ventas, forecast comercial, detección de abandono, Cross Selling, Up Selling, renovaciones y Churn Prediction. Cada uno será un Worker de KOE sobre los mismos registros. El mensaje «puede comprar otro servicio» es solo una regla sencilla (un cliente con pagos al día y a lo más un servicio), no un modelo de venta cruzada.

**Pendiente al conectar:** tablas con RLS por empresa; que los contactos, las automatizaciones, los Workers y los pagos lleguen por el flujo real de eventos de KOE; el Business Audit real; los umbrales y los tiempos típicos por etapa configurables por empresa (hoy son supuestos declarados); y las capacidades futuras.

## 16. Communications Hub v1

`/platform/comms`. Una sola bandeja para todos los canales de una empresa. Todo es simulación local: **no se envía ningún mensaje**, no se conecta ningún proveedor, no hay APIs, ni modelos reales, ni migraciones, ni dependencias nuevas. Toda comunicación pasa por KOE y ninguna pantalla ni Worker habla directo con un proveedor.

**Toda la inteligencia viene de KOE, y hay un solo motor** (`koe-comms.ts`): urgencia, sentimiento (simulado), intención, categoría, probabilidad de venta y de soporte, tiempo de espera, próxima mejor acción y su motivo; el **enrutamiento** (qué Worker la atiende, qué especialidad necesita, qué prioridad tiene y qué modelo elige el enrutador de KOE); el borrador de la respuesta; la bandeja, la línea de tiempo omnicanal y el contexto del cliente. Las pantallas solo dan formato (una prueba verifica que el vocabulario y las reglas viven en un solo archivo y que las pantallas ni calculan ni enrutan). Las reglas son declaradas y explicables: léxico cerrado en español para la intención y el sentimiento, puntos de urgencia por tiempo de espera, palabras urgentes, sentimiento, intención y canal (un chat web espera rapidez), y una probabilidad de venta que sube si el CRM tiene un negocio abierto.

**Qué ofrece (6 pestañas):**
- **Bandeja:** Email, WhatsApp, Facebook Messenger, Instagram Direct, Chat Web y Formularios Web en una sola lista, agrupada por conversación (SMS está declarado como arquitectura futura y se rechaza). Filtros por canal, estado, responsable (o sin responsable), etiqueta y texto sin distinguir acentos; lo que espera respuesta va primero, lo más urgente primero.
- **Conversación (Conversation Center):** cliente, empresa, canal, estado, responsable, prioridad, tiempo de espera, última actividad, etiquetas e historial completo; notas internas; contexto del cliente.
- **Línea de tiempo omnicanal:** una sola línea con los correos, WhatsApp, Messenger, Instagram, chat, notas, Workers, automatizaciones, Business Audit y CRM, de todas las conversaciones del mismo cliente, en orden.
- **Borradores (Draft Center):** NEX prepara correo, WhatsApp, Messenger, Instagram, respuesta de chat y respuesta de formulario, cada uno con la forma de su canal. **Nunca se envían.**
- **Asignaciones:** asignar, cambiar de responsable, marcar pendiente, resolver, archivar y reabrir, siempre con historial.
- **Inteligencia:** la lectura de KOE de la conversación y su decisión de enrutamiento (Worker, especialidad, prioridad, modelo y motivo, costo estimado), con el historial de decisiones.

**Enrutamiento inteligente.** Cada mensaje nuevo se enruta por KOE: la categoría fija la especialidad (ventas, seguimiento, cobros); el Worker elegido debe poder redactar mensajes con datos personales; la prioridad sale de la urgencia; el modelo lo elige el enrutador de KOE. La decisión se **guarda con su motivo y se añade, nunca se reescribe**. Si KOE no tiene Worker o modelo en ese momento, **el mensaje no se pierde** (queda anotado «enrutamiento pendiente») y clasificar se rechaza.

**Constitución de NEX**
- **Nivel 1, prepara:** clasificar, etiquetar, enrutar por KOE, preparar borradores y mejorar sus propios borradores (cada cambio es una revisión nueva).
- **Nivel 2, con autorización vigente:** reasignar una conversación, solo a una persona y dentro de una autorización con límite por día y vencimiento que una persona concedió.
- **Nivel 3, siempre una persona:** **no existe ningún evento que envíe un mensaje ni que elimine algo** (una prueba lo verifica). Resolver, archivar, marcar un borrador como listo (listo = una persona puede enviarlo ella misma, fuera de la plataforma), descartarlo, vincular con el CRM, escribir notas y registrar una respuesta enviada son siempre de una persona. Una conversación **nunca se cierra sola**: si el cliente escribe de nuevo, se reabre y queda anotado. Los mensajes de los clientes **solo llegan por la plataforma**, no los escribe una persona ni NEX.
- **Notas internas:** solo una persona las agrega, quedan auditadas, son internas y **nunca** las ve el cliente ni las lee un borrador (una prueba lo verifica).

**Contexto del cliente sin duplicar.** Desde una conversación se abren el pipeline, el Business Audit y el Customer 360 (pagos, productos, Academia, Marketplace, referidos, Workers y automatizaciones) consultando al módulo de CRM de KOE en el momento; **no se copia nada**: la conversación solo guarda una referencia al prospecto o cliente (una prueba comprueba que el contexto es idéntico a lo que dice el CRM y que no hay datos de pagos ni de productos en las conversaciones). Un pago es solo un total.

**Multiempresa.** Todo lleva `tenant_id`: la bandeja, las estadísticas, el enrutamiento y cada evento se limitan a una empresa; una prueba comprueba que las conversaciones de otra empresa no cambian ni una cifra y que cada cambio sobre algo ajeno se rechaza.

**Preparado para el futuro, no implementado** (`FUTURE_CONNECTORS`): WhatsApp Business API, Meta Messenger, Instagram Graph, Gmail, Microsoft 365, Twilio, telefonía y video llamadas. Cada uno será un conector que pasa por KOE, nunca directo a un proveedor; hoy ninguno existe y SMS no recibe conversaciones.

**Pendiente al conectar:** tablas con RLS por empresa; los conectores reales detrás de KOE (con consentimiento, ventanas de mensajería, plantillas aprobadas y retención); la lectura real de buzones; el análisis de sentimiento real con evals (hoy es una estimación simulada); los tiempos de respuesta objetivo por canal y por empresa; y el envío de los borradores, que será una acción de Nivel 3 con aprobación de una persona.

## 17. Organization & Identity Center v1

`/platform/org`. La estructura completa de una empresa, no solo sus usuarios: sucursales, departamentos, equipos, personas y Workers IA, roles, permisos e invitaciones, más la identidad de cada persona. Todo es simulación local: sin APIs, sin migraciones, sin dependencias nuevas, sin llamadas externas y sin ningún directorio ni proveedor de identidad.

**Qué ofrece (9 vistas)**
- **Panel:** empresa, sucursales, departamentos, equipos, usuarios (por estado), Workers IA (en equipos y sin equipo), roles, invitaciones y el estado general; las **recomendaciones de KOE**, las **propuestas de NEX**, la autorización de Nivel 2 y la **auditoría**.
- **Organigrama:** empresa → sucursales → departamentos → equipos → personas y Workers IA. **Un Worker pertenece al equipo igual que una persona.**
- **Usuarios:** invitaciones, estado (Pendiente, Activo, Suspendido, Deshabilitado), último acceso, idioma y zona horaria.
- **Equipos:** personas, Workers, especialidad, objetivos y responsable; mover integrantes con historial.
- **Roles:** Administrador, Gerente, Supervisor, Ventas, Marketing, Finanzas, RRHH, Soporte y Solo lectura, más roles personalizados. **Cada empresa tiene su propia copia: los roles nunca se comparten.**
- **Permisos:** una matriz rol × módulo (CRM, Academy, Marketplace, Workers, Insights, Pagos, Comunicaciones, AI Studio, Automatizaciones, Integraciones y Developer Center) con cuatro niveles (sin acceso, lectura, escritura, administración). Un permiso solo vale dentro de su empresa, para una cuenta activa.
- **Sucursales:** cada una con sus departamentos, equipos, personas, Workers y su configuración (idioma, zona horaria, moneda y horario); se desactivan, nunca se eliminan.
- **Identidad:** perfil, idioma, zona horaria, notificaciones, seguridad, sesiones y dispositivos. **Es arquitectura:** se registra la preferencia de verificación en dos pasos y las sesiones que reporta la plataforma, pero no hay ninguna verificación ni proveedor reales. Cada persona cambia sus propias preferencias y su seguridad (ni un administrador lo hace por ella); un administrador sí puede corregir un perfil o cerrar una sesión.
- **Fuerza de trabajo:** personas y Workers IA en una sola vista con estado, especialidad, equipo, sucursal, carga, disponibilidad y costo estimado.

**KOE es la única fuente de la inteligencia, y hay un solo motor** (`koe-org.ts`): el organigrama, la fuerza de trabajo, el panel, la matriz de permisos y **todas las recomendaciones** (equipo sobrecargado, Worker infrautilizado, Worker sin equipo, usuario sin actividad, departamento con cuello de botella). Las pantallas solo dan formato (una prueba verifica que las reglas viven en un solo archivo). Los datos salen de los registros de KOE: las ejecuciones y los Workers instalados, y lo que cada persona tiene abierto en el CRM y en el Centro de Comunicaciones. Los **supuestos son declarados**: una persona atiende 12 elementos abiertos; un equipo con más carga que capacidad está sobrecargado; un Worker con menos del 3 % de su límite diario en 7 días está infrautilizado; 14 días sin acceso es inactividad; y el costo de una persona es un supuesto por rol (el de un Worker es la suma de sus ejecuciones de 30 días). Todo es estimado, no una nómina. Cada análisis que se pide **guarda el Worker, el modelo y su motivo, y el costo estimado**, y se añade, nunca se reescribe.

**Autoridad.** Quién puede hacer qué sale del rol de la propia persona: el propietario y los administradores todo; un gerente lo del día a día (invitar con roles no críticos, crear equipos, mover integrantes, suspender no críticos); el resto, solo leer. **Siempre debe quedar un administrador activo**, el propietario no se cambia por esta vía (solo él transfiere la propiedad a otro administrador activo) y nadie cambia su propio estado.

**Constitución de NEX**
- **Nivel 1, prepara:** propuestas de invitación, de equipo y de cambio (mover de equipo, cambio de rol). **Una persona las aprueba, y al aprobarlas se aplican como esa persona**, con las mismas comprobaciones. NEX nunca aplica nada directamente.
- **Nivel 2, con autorización vigente:** mover a una persona entre equipos, de una administradora o administrador con límite por día y vencimiento; solo a una persona activa con un rol no crítico, nunca al propietario ni a un administrador, y nunca a un Worker (los mueve una persona).
- **Nivel 3, siempre una persona con el rol adecuado:** **NEX nunca crea administradores** (ni siquiera como propuesta), **nunca elimina usuarios** (no existe el evento: una persona se suspende o se deshabilita), **nunca cambia permisos críticos** (administrar pagos, integraciones, el Developer Center o los Workers) **ni cambia al propietario**.
- **Auditoría que nunca se borra:** invitaciones, cambios de rol, de permisos, de equipos, de sucursales y de Workers, con quién, qué y cuándo (los valores anteriores quedan en el detalle). El historial de equipos es una lista de asignaciones que solo crece.

**Multiempresa.** Cada empresa está totalmente aislada: sus personas, Workers, roles, equipos y configuraciones nunca se comparten. Un mismo identificador en otra empresa es otra persona; una persona de una empresa no tiene autoridad en otra; los cambios sobre algo ajeno se rechazan, y el trabajo de otra empresa no cambia ni una cifra (todo probado).

**Preparado para el futuro, no implementado** (`FUTURE_IDENTITY`): SSO, Azure AD, Google Workspace, Microsoft Entra, LDAP, SCIM, Okta y Auth0. Cada uno será un conector de identidad que pasa por KOE, nunca directo a un proveedor, con aprobación humana para los roles críticos; hoy ninguno existe.

**Pendiente al conectar:** tablas con RLS por empresa; autenticación real, verificación en dos pasos y sesiones; los conectores de identidad detrás de KOE; los límites de capacidad y los costos por rol configurables por empresa; la lectura real del trabajo abierto de cada persona desde los demás módulos; y la aplicación de los permisos en cada módulo (hoy `canUser` es el contrato que cada uno consultará).

## 18. Billing & Subscription Center v1

`/platform/billing`. El plan, la suscripción, los add-ons, las licencias, las facturas y el consumo de IA de cada empresa, con el forecast y el ROI. Todo es simulación local: sin APIs, sin pasarela de pagos, sin migraciones, sin dependencias nuevas y sin llamadas externas. **Nunca se cobra a nadie**: un pago solo se registra.

**Qué ofrece (8 vistas)**
- **Panel:** plan actual, estado de la suscripción, próxima renovación, usuarios y Workers activos, consumo de IA, almacenamiento, automatizaciones, integraciones, Marketplace, Academy, facturación mensual y ROI estimado; las **alertas de límites** con las opciones de KOE, las **propuestas de NEX**, la autorización de Nivel 2 y la **auditoría**.
- **Planes:** Starter, Professional, Business y Enterprise, más planes personalizados que solo ve su empresa. Cada plan declara sus límites de usuarios, Workers, sucursales, departamentos, equipos, almacenamiento, Academy, Marketplace, integraciones, automatizaciones, API, AI Studio, Comunicaciones, CRM, Insights y tareas de KOE al mes. Los precios son de ejemplo.
- **Licencias:** usuarios, Workers, sucursales, departamentos, equipos, Academy, Marketplace e integraciones, y los demás límites del plan. El límite es lo que incluye el plan más lo que suman los add-ons activos.
- **Add-ons:** usuarios extra, Workers extra, almacenamiento, Academy, Marketplace, Automation Packs y créditos de IA. Se compran por paquetes y **son independientes del plan**: sobreviven a un cambio de plan.
- **Facturación:** facturas, recibos, renovaciones, créditos, saldo e historial. Una **factura emitida nunca se modifica**: que esté pagada, abierta o vencida se lee de los pagos que apuntan a ella, y un error se corrige con un crédito. Los pagos y las facturas solo se registran (arquitectura).
- **Consumo IA (KOE AI Usage):** tareas ejecutadas, costo estimado, costo promedio, tiempo ahorrado y el costo por departamento, por Worker, por automatización y por agente IA. **Nunca se muestran proveedores ni modelos.**
- **Forecast:** consumo y costo proyectados, el uso proyectado por recurso, la recomendación (mantener, subir o bajar de plan) y el ROI.
- **Upgrade Center:** upgrade, downgrade, prueba, Enterprise, cancelar y reactivar. Todo simulado.

**KOE es la única fuente de todo cálculo financiero, y hay un solo motor** (`koe-billing.ts`): los límites, el total de una factura, el saldo, el crédito que se aplica, el consumo y su costo, el ROI, las alertas con sus opciones, el forecast y la recomendación. El almacén (`billing-center.ts`) solo decide quién puede hacer qué y registra el resultado; las pantallas solo dan formato. Una prueba lo verifica: las reglas viven en un solo archivo, el almacén no suma dinero y las pantallas no calculan ni nombran proveedores. El consumo sale de los registros de KOE (las ejecuciones de los Workers) y de lo que cada módulo reporta (usuarios y estructura de la organización, Workers instalados, automatizaciones, cursos, publicaciones, activos de AI Studio, canales, contactos del CRM y reportes de Insights); lo que ningún módulo guarda todavía (almacenamiento, llamadas a la API y conexiones) lo mide la plataforma.

**Supuestos declarados.** Todo es estimado y cada supuesto está en una constante del motor: el uso y el ROI se miden en los últimos 30 días; KOE empieza a recomendar al 80 % de un límite; el forecast sigue el ritmo de los últimos 15 días contra los 15 anteriores (entre la mitad y el doble); se sugiere un plan menor solo si el uso proyectado queda por debajo del 70 % de sus límites; y una hora de trabajo manual se valora a 12 US$. El ROI es (ahorro − costo de IA − costo de plataforma) / (costo de IA + costo de plataforma).

**Los límites nunca bloquean lo que ya existe.** Cuando un límite se acerca o se alcanza, KOE recomienda opciones (un add-on o el plan que alcance, la más barata primero) y solo limita **crear más**; no bloquea ni borra datos. Un downgrade o la cancelación de un add-on se **rechaza** si el uso actual no cabe, sin tocar nada. Cancelar la suscripción tampoco borra datos.

**Autoridad.** Decide sobre el dinero el propietario y quienes él nombra; el resto solo lee. Un Worker o la plataforma nunca.

**Constitución de NEX**
- **Nivel 1, prepara:** propuestas de cambio de plan o de compra de un add-on. **Una persona las aprueba, y al aprobarlas se aplican como esa persona**, con las mismas comprobaciones (si rompen una regla, se rechazan y la propuesta sigue abierta).
- **Nivel 2, con autorización vigente:** solicitar un upgrade al plan inmediatamente superior, con límite por día y vencimiento. **Es solo una solicitud**: no cambia el plan hasta que una persona la aprueba. Enterprise y los planes personalizados no se piden por esta vía.
- **Nivel 3, siempre una persona:** **NEX nunca cobra, cancela, renueva, emite pagos ni modifica facturas.** No existe ningún evento para editar o borrar una factura, un pago o el historial, y NEX ni siquiera prepara una propuesta de ese tipo.
- **Auditoría que nunca se borra:** plan, add-ons, facturas, pagos, créditos, propuestas y acceso, con quién, qué y cuándo.

**Multiempresa.** Cada empresa administra únicamente su plan, su consumo, sus licencias y sus facturas; nada se comparte. Un plan personalizado solo lo ve su empresa, una persona de una empresa no tiene autoridad en otra y los cambios sobre algo ajeno se rechazan (todo probado).

**Preparado para el futuro, no implementado** (`FUTURE_PAYMENT_CONNECTORS`): Stripe, PayPal, MakaPay, MakaWallet, SINPE, cripto, Apple Pay y Google Pay. Cada uno será un conector que pasa por KOE, nunca directo, con la aprobación de una persona en cada cobro; hoy ninguno existe.

**Pendiente al conectar:** tablas con RLS por empresa; una pasarela real y la conciliación; el prorrateo de cambios a mitad de periodo y los impuestos; las facturas con el formato legal de cada país; la lectura real del uso de cada módulo (hoy el almacenamiento, la API y las conexiones son medidas de ejemplo); la aplicación de los límites en cada módulo (`canUse` es el contrato que cada uno consultará antes de crear algo); y que el equipo de la empresa que administra la facturación salga de la organización (hoy lo nombra el propietario).

## 19. Developer Platform v1

`/platform/developers`. El centro para quien construye sobre KYNOVA: aplicaciones, API Keys, webhooks, sandbox, explorador de la API, SDK y el historial de todo. Todo es simulación local: **sin API, OAuth, webhooks ni SDK reales**, sin migraciones, sin dependencias nuevas y sin llamadas externas. Las credenciales son **simuladas** (empiezan por «kyn_sim_» y «whsec_sim_») y nada sale de la simulación.

**Qué ofrece (8 vistas)**
- **Panel:** API Keys, aplicaciones, webhooks, eventos, SDK, sandbox, versiones, consumo, rate limits y logs; las **recomendaciones de KOE**, los límites por empresa, aplicación y llave, el consumo, las **propuestas de NEX** y la autorización de Nivel 2.
- **API Keys:** crear, editar, revocar, regenerar y expirar, con permisos (scopes) y estado. **La llave completa se muestra una sola vez**, al crearla o regenerarla; el estado solo guarda un prefijo, los últimos cuatro caracteres y un hash, y ningún log la contiene. Una llave nunca puede tener más permisos ni más límite que su aplicación.
- **Webhooks:** crear, editar, pausar, eliminar, rotar el secreto, simular un evento, reintentar y ver el historial. Cada entrega va firmada (HMAC-SHA256 simulada) y KOE decide cómo sale; si falla se puede reintentar hasta 4 intentos en total (espera declarada de 1, 5 y 30 minutos). Eliminar un webhook lo deja de usar pero **conserva sus entregas y su historial**.
- **Sandbox:** un entorno de pruebas con datos, eventos, errores y latencia simulados. Su latencia y su tasa de errores afectan al explorador y a las entregas.
- **Logs:** peticiones, errores, eventos, webhooks y API Keys, filtrables por tipo. **Nunca se borran: solo crecen.** No existe ningún evento que borre o edite un log, una petición o una entrega.
- **Marketplace Apps:** el modelo de lo que se podrá ofrecer: apps, plugins, Workers, prompts, templates, automatizaciones y conectores. Solo arquitectura: una solicitud de publicación se **registra**, aprobarla no publica nada hoy.
- **API Explorer:** endpoints, métodos, headers, body y una respuesta simulada por KOE. **Nunca llama a una API real**: aplica las mismas reglas que una puerta de enlace (llave inválida o expirada: 401; permiso faltante: 403; app pausada: 403; límite alcanzado: 429; errores del sandbox: 500).
- **SDK Center:** JavaScript, TypeScript, Python, PHP, C#, Java y Go, y la arquitectura de OAuth (Authorization Code, PKCE, Client Credentials, Refresh Tokens y scopes). Todo está declarado y nada está implementado.

**KOE es la única fuente de todo cálculo, y hay un solo motor** (`koe-dev.ts`): los rate limits, el consumo, la respuesta simulada a una petición, el resultado de una entrega, la firma, los secretos, los datos del sandbox, el panel y las recomendaciones (una llave por expirar, una llave sin uso, un webhook que falla, una llave cerca de su límite, una versión que se retirará, una tasa de errores alta). El almacén (`dev-center.ts`) solo decide quién puede qué y registra el resultado; las pantallas solo dan formato. Una prueba lo verifica: las reglas viven en un solo archivo, el almacén no calcula y las pantallas no calculan, no llaman a la red ni nombran proveedores.

**Rate limits.** El **plan** fija el tope por minuto de toda la empresa (60, 300, 1.200 o 6.000); cada **aplicación** y cada **API Key** solo se pueden limitar más. El límite efectivo es el menor de los tres, y una petición que lo supera en cualquiera de los niveles recibe un 429.

**Supuestos declarados** (constantes del motor): KOE avisa al 80 % de un límite; una llave sin uso en 30 días se marca como sin uso; una llave se avisa 14 días antes de expirar; un webhook con 3 fallos en 7 días se marca como fallando; una tasa de errores del 10 % o más (con al menos 50 peticiones) se marca como alta; el consumo se mide en 30 días. Los números son ejemplos: las llaves, las direcciones y las respuestas son inventadas.

**Autoridad.** Construyen el propietario y las personas que él nombra; el resto solo lee. Un Worker o la plataforma nunca.

**Constitución de NEX**
- **Nivel 1, prepara:** propuestas de API Key, de webhook o de aplicación. **Una persona las aprueba, y al aprobarlas se aplican como esa persona** (la llave o el secreto se muestran una sola vez a quien aprueba). Si una aprobación rompe una regla, se rechaza y la propuesta sigue abierta.
- **Nivel 2, con autorización vigente:** solicitar la publicación de una app activa, con límite por día y vencimiento. **Es solo una solicitud**: una persona la decide y hoy no se publica nada.
- **Nivel 3, siempre una persona:** **NEX nunca crea credenciales reales** (ni siquiera simuladas: solo las prepara como propuesta), **nunca activa una aplicación, nunca publica y nunca elimina logs.** Las propuestas de ese tipo ni siquiera se aceptan.
- **Logs que nunca se borran:** cada cambio queda con quién, qué y cuándo.

**Multiempresa.** Cada empresa administra únicamente sus apps, llaves, logs, webhooks y sandbox; nada se comparte. Una persona de una empresa no tiene autoridad en otra y los cambios sobre algo ajeno se rechazan (todo probado).

**Preparado para el futuro, no implementado** (`FUTURE_PLATFORM`): GraphQL, gRPC, OpenAPI, AsyncAPI, CLI, Terraform, GitHub Apps y una extensión de VS Code. Cada uno pasará por KOE, nunca directo; hoy ninguno existe.

**Pendiente al conectar:** tablas con RLS por empresa; un almacén de credenciales con hash real y rotación; una puerta de enlace real con OAuth, límites y firma de webhooks; los SDK; que el consumo salga de las peticiones reales; que quién construye salga de la organización (hoy lo nombra el propietario); y la publicación real en el Marketplace con su revisión.

## 20. Premium Experience v2 (su estilo visual lo reemplaza el §24)

Una mejora de experiencia, no de negocio: **no hay módulos nuevos, ni APIs, ni migraciones, ni dependencias, y no cambia ninguna regla de negocio, KOE, NEX, reducer ni contrato.** Solo cambia cómo se ve, cómo se navega, cómo carga y cómo se instala la plataforma, y con una auditoría que impide que vuelva la duplicación.

**Design System V2: un solo sistema visual**
- **Dos temas, NOVA Dark y NOVA Light**, con exactamente los mismos componentes: cada tema declara los mismos tokens de color (`app/globals.css`) y solo cambia `data-theme`. NOVA Dark es la identidad (azul petróleo, grafito y dorado); NOVA Light es papel cálido. Se elimina el tema `dark` intermedio y `premium` pasa a llamarse NOVA Dark. El tema elegido se recuerda en el dispositivo y se aplica **antes del primer pintado** (sin parpadeo); cambia con el botón del encabezado.
- **Componentes compartidos** (`components/ui/`): `Tabs` (barra segmentada, con flechas, Inicio y Fin, y que se desliza en el móvil), `Table` (una tabla con nombre que se desplaza dentro de su caja), `Stat` (la cifra de todo dashboard: etiqueta discreta, número grande, nota), `Dialog` (modal que atrapa el foco, se cierra con Escape y devuelve el foco), `ProductMark` (el ícono y el nombre de cada producto), campos compactos (`INPUT`, `INPUT_FULL`) y esqueletos (`Skeleton`, `SkeletonKpis`, `SkeletonTable`, `SkeletonPage`). Los botones, tarjetas e insignias se actualizan en su sitio.
- **Se eliminó lo duplicado:** 12 copias de la clase de los campos, 15 barras de pestañas con su marcado y su manejo de teclado propio (incluida la del estudio de creadores), 6 envolturas de tabla, la tarjeta de cifras (`Kpi` y `KpiCard` comparten ahora la jerarquía de `Stat`), la variable `--glow-a` (era idéntica a `--primary`), un tema entero (`dark`) y el color del navegador escrito en dos sitios.

**Marca.** Una sola fuente (`config/brand.ts`) para KYNOVA, NEX, KOE, Academy, Marketplace, CRM, Workers, Developer Platform, Billing, Organization, Communications, Insights y AI Studio: nombre, qué es, ícono y un tono que sale de los colores del sistema (se ve bien en los dos temas). Cada pantalla de la plataforma lleva la marca de su producto.

**Dashboards.** Más aire (`space-y-8`, `gap-5`), una jerarquía única (etiqueta pequeña en mayúsculas, número grande, nota) y encabezados de sección más claros en el panel, en NEX y en todas las pantallas de módulo.

**Navegación.** Barra lateral **colapsable** (solo íconos, se recuerda), **favoritos** (estrella por pantalla, hasta 8), **recientes** (las últimas 5 pantallas abiertas) y **búsqueda rápida** con Ctrl o Cmd + K: encuentra cualquier módulo o pantalla de la plataforma sin importar acentos ni mayúsculas, se mueve con las flechas y se abre con Enter. Todo se guarda solo en el dispositivo y solo acepta rutas del propio sitio. La búsqueda se descarga solo cuando alguien la abre.

**Responsive.** Escritorio, portátil, tableta y móvil: las pestañas se deslizan, las tablas se desplazan dentro de su caja en lugar de romper la página, la barra lateral pasa a ser un cajón en el móvil, la búsqueda ocupa el ancho disponible y la app instalada respeta las zonas seguras (muesca e indicador de inicio).

**Animaciones.** Muy suaves y definidas en un solo lugar (`tailwind.config.ts`): entrada de página, entrada de diálogos, brillo de los esqueletos y un ligero levantamiento de las tarjetas. **Todas se desactivan** para quien prefiere menos movimiento.

**Rendimiento.** Pantallas de carga con esqueletos para toda la aplicación y para la plataforma (cada centro es un paquete grande que llega por partes), descarga diferida de la búsqueda rápida y división de código por ruta de Next.js.

**PWA.** Manifiesto completo (identificador, ícono normal y enmascarable, accesos directos a Panel, NEX y Plataforma, colores de la pantalla de bienvenida), **service worker** (`public/sw.js`), página sin conexión (`/offline`), botón de instalar (solo cuando el navegador lo ofrece), aviso cuando se pierde y vuelve la conexión, y pantalla de bienvenida al abrir la app instalada. **El service worker solo guarda archivos estáticos** (scripts, estilos, fuentes e íconos): nunca una página, una respuesta de la API ni nada de una sesión; las páginas siempre van a la red y solo si falla aparece la página sin conexión. Se prueba en un entorno simulado.

**Accesibilidad.** Enlace «Saltar al contenido» y marca principal enfocable, un solo anillo de foco visible en los dos temas, pestañas con teclado y tabulación correcta, diálogos con foco atrapado, devuelto y cierre con Escape, anuncios de conexión y de carga con regiones activas, y la comprobación de contraste AA de todos los pares de color en ambos temas.

**Auditoría** (`app/design-system-audit.test.ts`). Falla si reaparece: una clase de campo copiada, una barra de pestañas fuera de `Tabs`, una tabla ancha fuera de `Table`, un componente definido dos veces, un color escrito a mano (hexadecimal, `rgb()` o la paleta por defecto de Tailwind), una variable declarada dos veces en un tema o sin usar, un tema distinto de los dos NOVA, una animación repetida, o un control sin anillo de foco.

**Pendiente:** revisar las pantallas en dispositivos reales (esta entrega se verificó con pruebas automáticas y el build, no con capturas); íconos PNG de 192 y 512 píxeles para instaladores que no aceptan SVG; modo sin conexión con datos (hoy solo lo estático y la página sin conexión, a propósito); y traducir los textos nuevos del shell a los demás idiomas (hoy español e inglés).

## 21. Backend Core v1

La infraestructura sobre la que se conectará todo lo demás, **sin conectar nada todavía**: no hay OpenAI, Claude, Gemini, Stripe, WhatsApp, Gmail ni Outlook, no hay APIs externas, no hay migraciones nuevas, no hay dependencias nuevas, no se usan datos reales y no cambia ningún módulo, ni KOE, ni el inicio de sesión actual. Todo vive en `lib/backend/` (contratos y utilidades puras) y en `lib/db/core-clients.ts` (el único cliente de Supabase del núcleo). La decisión está en el ADR-0011 (Propuesto).

**Qué hay (las 14 áreas del sprint)**
- **Supabase** (`lib/db/core-clients.ts`): configuración desde el Environment Manager, un cliente con la llave publicable (la protege el RLS) y otro con la llave de servicio (salta el RLS: solo en el servidor, solo si existe, solo a través del Secrets Manager). **Perezoso**: no carga la librería ni conecta hasta que alguien pide un cliente, y no guarda sesión propia. `describe()` muestra el host y qué está configurado, nunca una llave.
- **Auth** (`auth.ts`): estado de la sesión (válida, por renovar o expirada), los pasos declarados de login, refresco y cierre de sesión, rutas protegidas con el permiso que pide cada una (facturación y desarrolladores piden administrador) y permisos por módulo y rol. **Reutiliza** los roles y `can` de `lib/contracts/backend.ts` y las rutas de `lib/auth/paths.ts`; no toca el middleware.
- **Organización** (`entities.ts`): el contexto de cada petición (`tenant_id`, `organization_id`, `user_id`, `role_id`), validado desde entrada no confiable, y el filtro por empresa para cualquier consulta. No hay una empresa por defecto.
- **RLS** (`rls.ts`): las políticas de cada tabla nueva escritas como datos, auditadas y renderizables como SQL para revisión, **sin activar**. Copian los tipos que las migraciones ya aplican (`read`, `rw`, `rw_delete`, `admin`). Todo lo que no tiene política se deniega: así las tablas de solo agregar y de solo lectura no se pueden modificar. Una auditoría de diseño exige que toda política filtre por empresa, que ninguna deje pasar a todos y que ninguna nombre al rol de servicio.
- **Base de datos** (`entities.ts`): **38 entidades de las once áreas** (usuarios, organizaciones, Workers, automatizaciones, Marketplace, Academy, CRM, facturación, Insights, desarrollo y comunicaciones) con columnas, datos personales marcados y su tipo de protección. Las que ya están en las migraciones se marcan `existing` y las nuevas `planned`; una prueba lo compara con el SQL. Solo contratos: ninguna migración.
- **Storage** (`storage.ts`): seis espacios (documentos, imágenes, videos, avatares, Academy y Marketplace) con tipos, tamaños y exigencia de análisis. Toda ruta empieza por la empresa, así que una empresa no puede alcanzar el archivo de otra; se rechaza cualquier nombre que intente salir de su carpeta. Solo avatares y Marketplace son públicos; lo privado usa direcciones firmadas de vida corta. El servicio real queda como una interfaz sin implementar (un archivo se retira, no se borra).
- **Event Bus** (`events.ts`): un catálogo de eventos tipados (al menos dos por módulo más un evento de auditoría por módulo) y un bus que **valida, guarda y nada más**. Un módulo solo publica eventos suyos; un evento nunca lleva una credencial; el mismo evento dos veces es uno. Se lee **por empresa y por cursor**, que es como KOE lo consumirá. **Nada consume todavía.** Las entradas reales de auditoría de Organización, Facturación y Desarrollo ya se convierten en eventos válidos.
- **Auditoría** (`audit.ts`): un solo contrato para todos los módulos (quién, qué, dónde, cuándo y con qué resultado). Solo crece, y cada registro se **encadena con SHA-256** al anterior de su empresa: cualquier cambio en el historial se detecta. Los detalles se limpian de secretos.
- **Configuración** (`env.ts`): Development, Preview y Production, con las variables que pide cada uno, informes que solo contienen **nombres** (nunca valores), rechazo de un secreto con prefijo público y una política por entorno: datos de ejemplo solo fuera de producción, **datos reales en ninguno todavía** y RLS sin activar en ninguno.
- **Seguridad** (`secrets.ts`, `crypto.ts`): el Secrets Manager es la única puerta a un secreto (lista permitida, uso por tarea, registro de accesos por nombre y propósito, rotación). Cifrado AES-256-GCM **atado a la empresa** (el texto cifrado de una no se abre como de otra), hash con llave para tokens, PBKDF2, comparación en tiempo constante y aleatoriedad. Todo con Web Crypto: sin dependencias y sin llaves en el código. Una prueba revisa que ni el código, ni las migraciones, ni el seed, ni los docs contengan nada que parezca un secreto.
- **Rendimiento** (`performance.ts`): arranque perezoso de una sola vez, un pool de conexiones con límite, espera, caducidad y reciclaje, y una caché con expiración y límite cuyas claves incluyen siempre la empresa (se puede vaciar la de una sin tocar la de otra).
- **Observabilidad** (`observability.ts`): logs estructurados que ocultan credenciales y datos personales; trazas con el formato W3C y muestreo coherente; comprobaciones de salud (ok, degradada, caída) con tiempo límite y sin exponer errores; y métricas cuyas etiquetas son una lista corta (**nunca una empresa ni una persona**) con salida en formato Prometheus. Solo arquitectura: no hay servicio de destino.
- **KOE** (`index.ts`): `koeView` es una vista de **solo lectura** (eventos por empresa, auditoría, contratos y salud). KOE no se modifica ni importa el Backend Core.
- **Ensamblaje** (`createBackendCore`): todas las piezas se crean la primera vez que se usan. `BACKEND_MANIFEST` lista cada pieza y su archivo, y una prueba comprueba que existen.

**Reglas que las pruebas mantienen:** no hay llamadas de red ni nombres de proveedores externos en el núcleo; las migraciones son exactamente las seis que ya existían; ningún módulo importa todavía el Backend Core; nadie se suscribe al bus; las políticas planeadas no aparecen en ninguna migración; el SQL de referencia y los contratos coinciden.

**Pendiente (no se hizo a propósito):** escribir las migraciones de las tablas planeadas y activar el RLS (una decisión aparte, con pruebas de aislamiento sobre una base real); conectar los módulos al bus y a la auditoría central; un destino real para logs, trazas y métricas; un servicio de archivos y su análisis; los secretos reales en Wrangler; y validar todo contra Supabase real, que sigue bloqueado hasta iniciar sesión en el entorno local.

## 22. IA: KOE, AI Cost Optimizer y AI Gateway v1

Toda llamada a IA pasa por una cadena de tres pasos con responsabilidades separadas (ADR-0012). Solo arquitectura, contratos y simulación: no hay proveedor real, clave, llamada de red ni dependencia nueva, y ningún módulo existente la usa todavía. Vive en `lib/contracts/platform/`.

```
Módulo → KOE → AI Cost Optimizer → AI Gateway → Proveedor IA (simulado)
```

| Paso | Decide | Nunca conoce | Archivos |
|------|--------|--------------|----------|
| **KOE** | Worker, especialidad, prioridad y política; además aplica los límites de la empresa (tokens, ritmo, presupuesto) y arma el prompt | Proveedores y modelos | `koe-ai.ts`, `koe-ai-center.ts`, `koe-ai-catalog.ts`, `koe-ai-messages.ts` |
| **AI Cost Optimizer** | Modelo recomendado, costo estimado, nivel de confianza y motivo (y los siguientes mejores, como respaldo) | El prompt, los Workers y los proveedores | `ai-cost-optimizer.ts`, `ai-model-registry.ts` |
| **AI Gateway** | Proveedor, modelo (de la lista que recibe), fallback, reintentos, tiempo máximo y observabilidad | Workers, especialidades y políticas | `gateway-engine.ts`, `gateway-center.ts`, `gateway-catalog.ts`, `gateway-messages.ts` |

- **`AIDecision`** (`ai-decision.ts`): el contrato compartido que KOE produce en cada solicitud: Worker, especialidad, política, prioridad, presupuesto restante, nivel de privacidad y tiempo máximo. **Nunca** incluye proveedor ni modelo: cualquier campo extra se rechaza.
- **Un solo punto de entrada** (`koe-ai-center.ts`, evento `ai.request`): el llamador (NEX, un Worker o un módulo) indica un **propósito** y un texto por capas. No hay campo de proveedor, modelo ni Worker; si se fuerza uno, se ignora. NEX nunca decide qué IA usar: consulta a KOE igual que cualquiera. El Gateway solo acepta llamadas de KOE (`gateway.execute`).
- **Propósitos** (`koe-ai-catalog.ts`): cada uno ya dice qué Worker lo atiende, qué especialidad es, su prioridad y la sensibilidad de sus datos. Agregar uno es agregar una entrada.
- **Optimizer**: recibe política, especialidad, presupuesto, prioridad y modelos permitidos (más el tamaño del trabajo, nunca el texto). Descarta con motivo los modelos sin la capacidad, el contexto, las herramientas, la región, el permiso de la empresa o la privacidad que exige el dato; puntúa el resto con los pesos de la política. El presupuesto no quita modelos: el Optimizer dice si la recomendación cabe y KOE decide. La prioridad solo desempata. La confianza es alta si hay una ventaja clara y baja en un empate o si no cabe en el presupuesto.
- **Políticas**: Costo primero, Calidad primero, Velocidad primero, Privacidad primero y Equilibrada. Cada empresa elige la suya. Privacidad primero manda los datos personales solo a modelos locales.
- **Registro de modelos**: perfiles (nombre interno `gw-…`, etiqueta neutral, capacidades, costo, contexto, velocidad, calidad, privacidad, regiones) **sin proveedor**. Qué proveedor sirve cada modelo lo sabe solo el catálogo del Gateway, que es el único archivo que nombra proveedores (OpenAI, Anthropic, Google, Mistral, Grok, DeepSeek, OpenRouter y modelos locales, todos simulados).
- **Gateway**: prueba los modelos en el orden recibido; si un proveedor falla pasa a **otro proveedor** y registra el motivo. Reintenta solo fallas temporales con la espera de la empresa; una caída no se reintenta. Un pedido crítico tiene un intento más y uno de prioridad baja, uno solo. Respeta el tiempo máximo de la decisión. Cortacircuito por empresa y proveedor (cerrado, abierto, semiabierto tras el enfriamiento).
- **Prompt y guardrails de KOE**: capas en orden fijo (sistema, negocio, guardrails, memoria, contexto, herramientas, usuario); datos personales reemplazados salvo permiso del propósito; moderación por reglas; recorte de contexto y memoria antes de tocar las palabras del usuario; límites de tokens y ritmo por empresa.
- **Observabilidad** (`ai-observability.ts`): une lo que decidió KOE con lo que observó el Gateway (modelo, proveedor, intentos, fallback y su motivo, latencia, tokens, costo). Ninguno de los dos lee los registros del otro. **Nunca se guarda el texto del prompt ni datos personales**; los registros solo crecen.
- **Caché**: solo arquitectura (`CACHE_ARCHITECTURE`): exacta y semántica, por empresa, nunca con datos personales. KOE marca qué respuesta es cacheable y el Gateway solo calcula la llave; no se guarda nada.
- **`ModelPerformance`** (`ai-model-performance.ts`): contrato para uso futuro (especialidad, modelo, porcentaje de éxito, costo, latencia y calidad promedio). No se registra ni se lee todavía; el Optimizer no lo considera.
- **Empresas**: cada una configura política, modelos permitidos, presupuesto mensual, región y límites, todo aislado por empresa. Lo cambia una persona (el propietario o los administradores que él nombra); NEX, un Worker o el sistema no. Los incidentes simulados de un proveedor los declara solo la plataforma.

**Reglas que las pruebas mantienen:** KOE no nombra ni importa proveedores ni el registro de modelos; el Gateway no nombra Workers, especialidades, políticas, propósitos ni presupuestos y no importa nada de KOE ni del Optimizer; el Optimizer no conoce prompts, Workers ni proveedores; el flujo va en un solo sentido; sin red, entorno ni claves; los proveedores solo se nombran en el catálogo del Gateway; ningún módulo existente lo importa; sin dependencias nuevas. Una tabla fijada de modelos por propósito y política, capturada con la versión anterior, comprueba que el comportamiento no cambió.

**Pendiente (no se hizo a propósito):** conectar los proveedores reales detrás de `lib/ai/` y AI Gateway (con sus secretos en el Secrets Manager); que el motor de Workers (`koe-engine.ts`) delegue su enrutamiento de modelos en esta cadena (hoy conviven los dos); implementar la caché y `ModelPerformance`; conectar los registros al Event Bus y a la auditoría central; una pantalla de configuración por empresa.

## 23. Runtime de Agentes IA v1

El bucle que convierte a un Worker en un *agente* (ADR-0013). Solo arquitectura, contratos y simulación: no hay IA real, red, dependencia ni pantalla, no se modifica KOE ni el AI Gateway, y ningún módulo existente lo usa todavía. Vive en `lib/contracts/platform/`.

```
Persona → sesión → plan (pasos) → motor de Workers (herramientas, memoria, aprobaciones)
                                → KOE ai.request → AI Cost Optimizer → AI Gateway (simulado)
```

| Archivo | Contenido |
|---------|-----------|
| `agent-catalog.ts` | Los planes (`Playbook`) como datos, los tipos de paso, los límites de una sesión (con techos), los motivos de parada y los estados |
| `agent-runtime.ts` | Reglas puras: validar y previsualizar un plan, límites, reintento, bucle, traza (`explainSession`) y métricas (`agentMetrics`) |
| `agent-center.ts` | Estado por empresa y `reduceAgent`: iniciar, avanzar, correr, aprobar, cancelar, tomar el control y fallas simuladas |
| `agent-messages.ts` | Los textos por código |

- **Un agente es un Worker.** Sus herramientas, nivel de datos, memoria y niveles de autonomía vienen del motor de Workers; el plan nunca fija un nivel. Un plan se valida contra el Worker que lo ejecuta al iniciar (herramientas permitidas, datos requeridos, propósitos conocidos, cierre al final).
- **Pasos**: `think` (pide a la IA un *propósito*, nunca un modelo), `tool`, `remember` y `finish`. Los textos usan `{dato}` que se llena con lo que la persona dio al iniciar. Planes de ejemplo: calificar un prospecto, dar seguimiento, resumen del negocio y recordatorio de cobro (este último pide un enlace de cobro, que siempre espera a una persona).
- **Sesión**: un plan en marcha, con su ejecución del motor de Workers, su cursor, sus pasos (cada intento queda registrado), el costo gastado y las llamadas a la IA. Estados: en curso, esperando aprobación, escalada, completada, detenida, cancelada y traspasada.
- **Constitución**: una persona (o la plataforma) inicia; solo una persona aprueba, cancela o toma el control. Una acción de Nivel 3 espera y nada después corre; un rechazo termina la sesión. Quien inició un cobro no lo aprueba.
- **Límites por sesión**: pasos, llamadas a la IA, presupuesto, tiempo y repeticiones del mismo paso; cada uno con techo. Los interruptores de parada de KOE se revisan antes que cualquier límite.
- **Fallas**: una falla temporal (de una herramienta o de la IA) se reintenta con espera creciente (se registra, no se espera) y, al agotarse, la sesión se **escala** a una persona, que puede tomar el control. Lo que un reintento no arregla (la IA no tiene un modelo permitido, el motor rechaza una herramienta) escala de inmediato.
- **La IA, solo por KOE**: el runtime no importa el Optimizer, el Gateway ni el registro de modelos y no nombra modelos ni proveedores. El prompt no se conserva en los registros de KOE.
- **Multiempresa**: el catálogo de planes es global; sesiones, fallas simuladas y métricas son de cada empresa, y una empresa no ve ni mueve las de otra. Los registros solo crecen.

**Reglas que las pruebas mantienen:** planes válidos para su Worker; el agente no puede más que su Worker; Nivel 3 espera y el rechazo termina; solo personas aprueban, cancelan y toman el control; límites y paradas; reintento y escalamiento; aislamiento entre empresas; sin red, entorno, claves ni dependencias; ningún módulo existente lo importa.

**Pendiente (no se hizo a propósito):** un "cerebro" que planifique y replanifique con un modelo real; delegación y traspaso entre agentes; ejecución asíncrona y reanudación (colas); conectar las sesiones al Event Bus y a la auditoría central; tablas con RLS por empresa; planes escritos por cada empresa; una pantalla para ver y aprobar las sesiones.

## 24. Design System V3 (NOVA)

Renueva por completo la identidad visual (reemplaza el estilo de §20: petróleo y dorado) sin tocar lógica, contratos, KOE, NEX, el AI Gateway ni los Workers. Todo pasa por los tokens y por las piezas compartidas, así que **toda la plataforma cambia a la vez** (Dashboard, CRM, Communications, Organization, Billing, Developer Platform, Insights, Marketplace, Academy, Workers, AI Studio, NEX, KOE y el sitio público) sin editar ninguno de esos módulos. La referencia completa está en `docs/design-system.md` y la viva en `/design-system`.

| Archivo | Qué cambia |
|---------|------------|
| `app/globals.css` | Los dos temas con tokens nuevos (azul muy oscuro, azul y cian eléctricos, vidrio, auras), y el aspecto de las piezas compartidas |
| `tailwind.config.ts`, `app/layout.tsx` | La tipografía de títulos (Manrope, una fuente variable en latín), `primary-deep`, la sombra `glow`, las animaciones `fade-in` y `breathe` |
| `components/ui/*` | `Badge` (borde fino y luz de estado), `EmptyState` (halo), `Skeleton` (brillo cian), `IconBadge`, `Brand`, `ProductMark`, `PageHeader`, `KpiCard`, `StatusBadge`, `choice` |
| `components/shell/*` | Barra lateral, barra superior de vidrio y navegación (`.nav-item`) |
| `lib/theme.ts`, `public/icon-maskable.svg`, `app/icon.svg` | Los colores de la barra del navegador y de los íconos |

- **Fondo NOVA Dark** `#060B18` con dos auras (azul y cian) en una sola capa fija; **NOVA Light** en azul frío.
- **Un sistema de colores unificado:** `primary` azul eléctrico, `accent` cian, `primary-deep` como fin del degradado de la acción principal; sin dorado.
- **Vidrio** en las tarjetas, con respaldo sólido donde no hay desenfoque o se pide menos transparencia.
- **Botones, campos, badges, pestañas, tablas, cifras, encabezado, barra lateral y navegación** rediseñados en un solo archivo; **estados vacíos, carga y esqueletos** con luz suave que se detiene con `prefers-reduced-motion`.
- **Accesibilidad:** contraste AA comprobado también sobre ambos extremos del degradado y sobre el vidrio; un solo anillo de foco; enlace "saltar al contenido".
- **Rendimiento:** una fuente más (variable, latín), sin imágenes ni dependencias nuevas.

**Pruebas:** `app/design-system-v3.test.ts` (identidad, contrastes, vidrio, degradado, tablas, navegación y tipografía), `components/ui/v3.test.tsx` (insignias, estados vacíos, esqueletos y marcas), y se actualizaron `lib/theme.test.tsx` y la prueba de la página `/design-system`. Las pruebas de tokens y de auditoría del sistema siguen pasando sin cambios de reglas.

**Pendiente (no se hizo a propósito):** una pasada visual con Lighthouse sobre la versión desplegada (aquí solo se midió con pruebas y la construcción); revisar las imágenes sociales (`opengraph-image.png`, `apple-icon.png`), que siguen con el estilo anterior porque son binarios.

## 25. Backend Core Integration v1

Une todo lo construido con el Backend Core (§21) **sin modificar** ningún módulo, KOE, NEX, el AI Gateway ni el runtime, sin pantallas ni funciones nuevas, y todavía en simulación (ADR-0014). La conexión va en un solo sentido: `lib/backend/integration/` importa los módulos; ningún módulo importa el Backend Core.

```
reductor del módulo (sin cambios) → conector → Event Bus + auditoría central + métricas + trazas
                                             → base simulada (platform_events, audit_log, storage_objects) → [Supabase preparado]
```

| Archivo (`lib/backend/integration/`) | Contenido |
|--------------------------------------|-----------|
| `connector.ts` | El conector: ejecuta el reductor tal cual y lleva lo que el módulo registró al Event Bus y a la auditoría; cuenta, mide y traza cada llamada |
| `bridges.ts` | Los catorce puentes (Workers, IA de KOE, AI Gateway, runtime de agentes, automatizaciones, Marketplace, Academy, CRM, Billing, Insights, Developer Platform, Communications, Organización y AI Studio) y la telemetría de dominio de la cadena de IA |
| `persistence.ts` | Filas según el contrato de datos, base simulada y adaptador de Supabase preparado (bloqueado sin datos reales) |
| `archive.ts` | Storage y Secrets Manager por contratos: archivo cifrado de la auditoría de una empresa |
| `health.ts`, `coverage.ts` | Siete comprobaciones de salud nuevas y la prueba de que todo lo auditado pasó por el bus |
| `index.ts` | `connectPlatform(core)`: un conector por módulo, la base y el almacenamiento simulados, y la salud integrada |

- **Event Bus y auditoría:** cada entrada nueva de la traza de un módulo se publica con un id determinista (repetir la misma historia no duplica nada) y queda en la auditoría central encadenada; un intento rechazado se audita como `refused` y no genera evento. El resultado del módulo no se toca.
- **Runtime, IA y Gateway:** al envolver el runtime de agentes se reenvían también el motor de Workers, la solicitud de IA y el Gateway que van dentro. Cada llamada del Gateway deja el evento `koe.ai.call.recorded`, sus métricas (`kynova_ai_gateway_*`) y un span hijo con la duración simulada; cada cambio de estado de una sesión deja `workers.session.changed`. Nunca viaja el texto de un prompt.
- **Trazas:** un solo id de traza une el span de la llamada, los eventos (`correlationId`) y los registros de auditoría (`requestId`).
- **Métricas:** `kynova_reducer_*`, `kynova_bus_events_total`, `kynova_audit_records_total`, `kynova_integration_violations_total` y `kynova_health_ok`. Sus etiquetas son solo las permitidas: nunca llevan empresa ni modelo.
- **Salud:** a las comprobaciones del núcleo se suman `event_bus`, `audit_chain`, `bus_coverage`, `tenancy`, `bridges`, `persistence`, `file_storage` y `secrets_access`, cada una también como métrica.
- **`tenant_id` en todo el flujo:** una llamada sin empresa se rechaza antes de tocar el módulo; una entrada de otra empresa dentro de una llamada no se publica y cuenta como violación (la salud cae).
- **Supabase y RLS preparados:** las filas se validan contra `platform_events`, `audit_log` y `storage_objects` (que ya tienen su política por empresa, sin activar). El adaptador es perezoso, solo inserta, filtra cada lectura por empresa y **no escribe nada** mientras el entorno no admita datos reales; no hay migraciones nuevas.
- **Storage y secretos:** el archivo de la auditoría se cifra con la llave de la empresa (leída solo por nombre y propósito), se guarda bajo su carpeta y se registra en `storage_objects`; ninguna otra empresa puede leerlo ni abrirlo.

**Reglas que las pruebas mantienen:** los puentes apuntan a la misma función que exporta cada módulo y el resultado con y sin conector es idéntico; cada centro de la plataforma está conectado o declarado (hoy solo los referidos y los pagos quedan fuera); la historia de cada módulo demostrada se reenvía completa y es idempotente; la cobertura del bus se verifica por empresa; aislamiento total de eventos, auditoría, filas, archivos y sellos; sin prompts, credenciales ni datos personales en el bus, la auditoría, los logs ni los spans; nadie se suscribe al bus; ningún módulo importa el Backend Core; sin red, proveedor real ni migraciones.

**Pendiente (no se hizo a propósito):** conectar la base real (hace falta la validación con Supabase real, que sigue bloqueada hasta que haya sesión iniciada) y activar el RLS con sus pruebas de aislamiento; que KOE consuma el bus; eventos de dominio finos para cada módulo; pagos y referidos (necesitan una traza por empresa); un puente para el módulo de usuarios cuando exista su reductor.

## 26. Identidad, autenticación y Supabase v1

Conecta el Backend Core con Supabase (ADR-0015). **La autenticación real ya existía** (OTP, cookie, renovación en el middleware, cierre de sesión, rutas protegidas, membresías y roles): no se tocó. Lo nuevo es la migración de las tablas del Backend Core con RLS, la identidad que une la sesión con `tenant_id` y los permisos, los adaptadores de Supabase y las pruebas de aislamiento.

| Pieza | Dónde |
|-------|-------|
| Migración con RLS desde su creación | `supabase/migrations/20261110000100_backend_integration.sql` |
| Pruebas de aislamiento, roles, cadena y borrado | `supabase/tests/backend_integration.sql` (corre en la CI `rls-isolation`) |
| De la sesión de Supabase Auth al contexto de empresa y a `canUser` / `canUse` | `lib/backend/identity.ts` |
| Adaptadores de Supabase (eventos, auditoría, archivos) y `connectSupabasePlatform` | `lib/backend/integration/persistence.ts`, `supabase-storage.ts`, `index.ts` |
| Salud real y cobertura | `lib/backend/integration/health.ts` |

- **Tablas** (`platform_events`, `platform_audit`, `storage_objects`): RLS activo al crearse; los miembros solo leen; ni `anon` ni la llave de servicio tocan nada; `platform_events` y `platform_audit` son append-only. `platform_audit` es la auditoría central encadenada (la auditoría por fila `audit_log` es otra cosa y no se cambió).
- **Escritura solo por funciones** (`append_platform_events`, `append_platform_audit`, `register_storage_object`, `retire_storage_object`): comprueban el derecho a escribir en la empresa. La base **exige la continuidad de la cadena de auditoría** (bloqueo por empresa, seq + 1 y hash previo) y la idempotencia de los eventos.
- **Storage:** un bucket privado `documents` con políticas que atan cada objeto a la carpeta de su empresa (sin actualizar ni borrar; un archivo se retira en el registro).
- **Borrado de una empresa:** `delete_company` también quita estas filas.
- **Identidad:** claims verificados + membresía activa → `TenantContext` (`tenant_id`, `organization_id`, `user_id`, `role_id`; la organización aún no está modelada, así que es nula) y `AuthSession`. `canUser` y `canUse` dan las mismas respuestas que la matriz de permisos y que `private.can_write` / `is_admin` (una prueba compara el código con el SQL). Una llamada del conector con el contexto de la sesión se rechaza si es de otra empresa.
- **Adaptadores:** escriben por las funciones, **como la persona que inició sesión** (RLS aplica a esa persona), sin actualizar ni borrar. No escriben en producción; en desarrollo y vista previa solo admiten datos de demostración; `realData` sigue en `false` en todos los entornos (ADR-0006).
- **Cadena entre instancias:** `platform.resume(tenantId)` retoma la cadena desde el último registro guardado; sin eso la base rechaza una cadena que reinicia en 1.
- **Hueco corregido:** el Event Bus identificaba un evento solo por su id, de modo que una empresa podía suprimir el evento de otra eligiendo el mismo id. Ahora la identidad es empresa + id.
- **Salud real:** `supabase_reachable` pregunta al proyecto con una lectura filtrada a una empresa inexistente (nunca devuelve datos de nadie); en la comprobación de persistencia, el RLS ya figura como activo donde se aplique la migración.

### Cómo se verificó, y qué no
- **Pruebas unitarias y de integración** (`lib/backend/identity.test.ts`, `integration/supabase.test.ts`): identidad, permisos, cadena completa de rutas, adaptadores con un cliente simulado que imita las funciones, Storage, salud, cadena entre instancias, y que la migración concuerda con el contrato (columnas, RLS, funciones, políticas de Storage).
- **SQL:** las migraciones y `backend_integration.sql` se ejecutaron en un Postgres efímero (PGlite) y pasan; se comprobó además que las pruebas detectan tres mutaciones (RLS apagado, un `grant insert`, una política abierta). **No es Supabase real:** la CI de GitHub (`rls-isolation`, Postgres real) y la validación en el proyecto de Supabase son la verificación definitiva.
- **No se aplicó nada a ningún proyecto de Supabase** y no se inició sesión: la verificación de la cadena de autenticación con el proyecto real sigue esperando el inicio de sesión de la persona en `http://localhost:8787/login`.

### Para activarlo en un proyecto real (requiere aprobación explícita; AGENTS.md §7.11)
1. Revisar y aprobar el ADR-0015 y la migración; confirmar el entorno (desarrollo o vista previa, **nunca producción primero**).
2. Correr `supabase/tests/backend_integration.sql` (y los dos anteriores) en una base limpia con las migraciones, y la CI en verde.
3. Aplicar `20261110000100_backend_integration.sql` al proyecto elegido y repetir las pruebas de aislamiento contra él.
4. Secretos por entorno (solo por Wrangler o los secretos de GitHub, nunca en el repositorio): `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` (públicas por diseño), `KYNOVA_ENCRYPTION_KEY` (32 bytes en base64) y `KYNOVA_HASH_PEPPER` (mínimo 32 caracteres); la llave de servicio no se usa. El informe del Environment Manager solo dice qué nombres faltan.
5. Conectar una ruta de servidor que llame a `connectSupabasePlatform(core, cliente de la petición)` y a `resume`: hoy ninguna lo hace.
6. Los datos reales de clientes siguen bloqueados hasta las puertas del ADR-0006 y la aprobación de producción.

**Pendiente (no se hizo a propósito):** aplicar la migración; la ruta que use el adaptador; migraciones para las demás tablas planeadas (Workers, Billing, etc.); el modelo de organización dentro de una empresa; verificar la cadena de autenticación con la sesión real.

## 27. Proveedores de IA reales v1

Flujo: Módulo → KOE → AI Cost Optimizer → AI Gateway → `lib/ai/` → proveedor. Ver ADR-0016.

- **Conectados:** OpenAI, Anthropic, Google Gemini, OpenRouter. **Preparados, nunca llamados:** Grok, DeepSeek, Mistral, Ollama.
- **Una sola interfaz** (`complete`, `stream`), errores normalizados, `fetch` solo en `lib/ai/http.ts`, sin SDK.
- **Dos pasadas** del mismo reducer (captura → llamada real → reproducción): KOE no cambia y su registro lleva tokens y costo reales. Sin conductor, el Gateway simula como antes.
- **Se conservan** las cinco políticas, la privacidad dura, reintentos, backoff, cortacircuitos y fallback a otro proveedor.
- **Streaming:** fallback solo antes del primer fragmento; un corte a mitad termina como fallido.
- **Secretos** (solo Wrangler): `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `OLLAMA_BASE_URL`.
- **Verificar antes de usar con tráfico real:** nombres de modelo nativos y precios de referencia (`lib/ai/providers.ts`); nada se ha probado contra una API real.
- **Uso:** `askAi(state, evento, deps)` y `askAiStream`; ningún módulo ni pantalla los importa todavía.

## 28. KYNOVA opera KYNOVA v1

Objetivo: demostrar que una empresa puede operar usando solo la plataforma. Ver ADR-0017.

- **Empresa interna** `tenant-kynova`: propietario, personas, departamentos, equipos y Workers internos; Billing (plan Business), IA de NEX, automatizaciones, AI Studio, Marketplace y Academy configurados.
- **Día simulado** (`runKynovaOperation`): prospectos, seguimiento, soporte, facturación, marketing, contenido, métricas, reuniones y tareas, con aprobaciones de personas.
- **Panel operativo** (`operatingDashboard`): lectura de lo que ya guardan los módulos; no es una pantalla nueva.
- **Sin tocar** KOE, NEX, AI Gateway ni Runtime; sin WhatsApp, Stripe ni redes sociales; todo simulado.
- **Pruebas** extremo a extremo en `kynova-operation.test.ts`: ningún paso rechazado, solo personas deciden, determinismo y aislamiento por empresa.

## 29. Business Templates & Revenue Engine v1

Ver ADR-0018.

- **Doce plantillas:** Agencia de Marketing, Bienes Raíces, Restaurante, Clínica, Abogado, Contador, Constructora, E-commerce, YouTube Faceless, Consultor, Educación y Empresa Genérica.
- **Cada una trae:** roles, equipos, Workers, agentes de IA recomendados, automatizaciones, flujos, KPIs, objetivos, panel, plan, presupuesto de IA y configuración inicial de CRM y comunicaciones.
- **Instalar** (`installBusinessTemplate`) aplica los datos por Organization, KOE, la IA de NEX, Billing, AI Studio, Automations e Insights; tarda milisegundos y no concede autonomía (Nivel 1).
- **Revenue Engine** (`revenueEngine`, `readKpis`): lecturas de CRM e Insights; muestran lo que falta para la meta mensual.
- **Una sola fuente:** las automatizaciones se escriben una vez y cambian de palabras según el negocio.
- **Sin tocar** KOE, NEX, Gateway, Runtime ni Backend Core.

## 30. Partners & Referral Engine v1

Ver ADR-0019. Programa oficial de Partners de KYNOVA, multiempresa y auditable.

- **Niveles:** Registered 7 %, Silver 9 %, Gold 12 %. Platinum, Diamond y Elite están definidos y **bloqueados**.
- **Partner:** registro (pendiente) → aprobación de una persona → activo, suspendido o cerrado; código único y enlace de referido.
- **Referidos:** clic, registro, conversión con el primer pago; autorreferido y mismo correo se rechazan.
- **Comisión:** porcentaje sobre la membresía **pagada** (Billing), cada mes mientras el cliente esté activo; se recalcula al cambiar de plan y se **pausa** si deja de pagar.
- **Validación:** 15 días para reembolsos, fraude y contracargos; después queda en el saldo.
- **Retiro:** mínimo USD 100; una persona solicita, otra aprueba y una tercera registra el pago con referencia externa.
- **Medios de pago:** MakaPay, Payoneer, PayPal, Stripe y Osmo solo como interfaces desconectadas.
- **Panel e historiales:** `partnerDashboard` y `programSummary` (clientes y su estado, comisiones, pagos).
- **Auditoría, Event Bus y RLS:** cada evento deja su entrada de auditoría (probado con el conector del Backend Core); las 8 tablas futuras pasan la auditoría de políticas. Sin migración aplicada.

## 31. KOE Financial Router v1

Ver ADR-0020. Billing → KOE Financial Router → Proveedor de Pago. **Solo arquitectura: ningún proveedor está conectado.**

- **Operaciones:** cobros de membresía y Marketplace, renovaciones, suscripciones, cambios de plan, pagos a partners, reembolsos, créditos, comisiones y facturas.
- **Adaptadores** (misma interfaz, todos desconectados): MakaPay, PayPal, Payoneer, Stripe, Apple Pay, Google Pay y Osmo.
- **Decisión automática** por operación, moneda, método, política de la empresa (costo, fiabilidad, velocidad, balanceada) y su historial.
- **Reintentos, tiempos y cortacircuitos;** respaldo a otro proveedor, salvo en reembolsos, que vuelven al proveedor que cobró.
- **Idempotencia** por clave y empresa. **Solo personas deciden el dinero:** pagos, reembolsos y créditos piden una segunda persona.
- **Monedas:** se liquida en la moneda de la operación; convertir requiere autorización y tasa de la empresa; cripto reservada.
- **Costos, historial y métricas** por proveedor y moneda; **auditoría** y compatibilidad con el Event Bus; 6 tablas futuras con RLS por empresa (sin migración).
- **Entradas:** `chargeFromInvoice`, `chargeFromPurchase`, `payoutFromPartner` y, de vuelta a Billing, `billingPaymentFromOperation`.

## 32. Smart Onboarding & AI Business Architect v1

Ver ADR-0021. El cliente responde unas pocas preguntas y KYNOVA configura su empresa en minutos.

- **Cuestionario:** 7 preguntas cortas (8 si el negocio no quedó claro); 4 minutos como máximo.
- **Detección** del tipo de negocio por palabras clave; el cliente siempre puede elegir.
- **Recomienda:** plantilla, plan (por los límites de Billing), número de agentes, presupuesto de IA, automatizaciones, Workers, equipos, KPIs y panel.
- **Vista previa exacta** (ejecución de prueba del instalador real) y **un clic** para instalar (`install.confirm`).
- **Solo el propietario decide;** NEX pregunta. Todo en Nivel 1. Una sesión por empresa, auditada.
- **No usa IA real** ni agrega reglas de negocio: todo sale de los datos de las plantillas y de Billing.

## 33. KYNOVA Internal Beta v1

Ver ADR-0022. KYNOVA administra cuatro empresas con su propia plataforma.

| Empresa | Plantilla | Casos de uso |
|---------|-----------|--------------|
| Nova Marketing Studio | Agencia de Marketing | Captación, seguimiento, SEO, campañas, redes (a mano) |
| PSI Sostenible | Empresa Genérica | Prospectos B2B, seguimiento, cotizaciones, productos, distribuidores |
| Real Estate | Bienes Raíces | Propiedades, leads, seguimiento, agenda, cierre |
| YouTube Studio | YouTube Faceless | Producción, calendario, guiones, miniaturas, publicaciones, analíticas |

- Cada una se crea con el **AI Business Architect** (preguntas, vista previa, un clic) y después se configuran sus casos con CRM, Communications, Billing, Workers, agentes, AI Studio, Automations e Insights.
- **Datos de ejemplo:** los datos reales siguen bloqueados por las puertas del ADR-0006. **Nada conectado:** ni WhatsApp, ni Stripe, ni MakaPay, ni redes sociales.
- **Portafolio de KYNOVA** (`portfolio`, `mrrMicros`): lectura de las cuatro empresas.
- **Pruebas** extremo a extremo (19): sin pasos rechazados, solo personas deciden, aislamiento y cobertura del Event Bus por empresa.

## 34. Real World Integrations

Ver ADR-0024. La arquitectura para trabajar sobre las herramientas de los clientes, **sin conectar ninguna API real**: cada proveedor se conectará en un sprint propio sin cambiar esta arquitectura.

| Conector | Proveedor | Sincroniza |
|----------|-----------|------------|
| Gmail, Outlook | Google, Microsoft | Correos |
| Google Calendar, Microsoft Calendar | Google, Microsoft | Eventos |
| Google Drive, OneDrive | Google, Microsoft | Archivos |
| WhatsApp Business | Meta | Mensajes, leads |
| Facebook Pages | Meta | Mensajes, publicaciones, comentarios, leads |
| Instagram Business | Meta | Mensajes, publicaciones, comentarios |
| LinkedIn Company | LinkedIn | Publicaciones, comentarios, leads |
| YouTube | Google | Videos, comentarios |
| TikTok Business | TikTok | Videos, comentarios, leads |

- **Una interfaz** (`ConnectorAdapter`) y **cuatro estados**: Connected, Disconnected, Pending Authorization y Error. Cada conector muestra nombre, proveedor, última sincronización, estado, permisos y empresa propietaria.
- **OAuth preparado:** PKCE, `state` de un solo uso atado a la empresa, retorno seguro. **No se guardan credenciales a mano:** los tokens solo existen como referencia `secret:...` y las credenciales de la app de KYNOVA se leen por nombre del Secrets Manager (`GOOGLE_*`, `MICROSOFT_*`, `META_*`, `LINKEDIN_*`, `TIKTOK_*`).
- **Multiempresa:** cada empresa autoriza solo sus cuentas; una cuenta pertenece a una empresa a la vez.
- **Agente IA → Worker → Conector → Proveedor:** solo un Worker pide la acción; lo que sale de la plataforma espera a una persona.
- **Sincronización** de correos, eventos, archivos, mensajes, videos, publicaciones, leads y comentarios (cuentas y cursores, nunca contenido), renovación de tokens y reintentos.
- **Pantalla Connected Apps** (`/platform/connected-apps`, simulada) y **salud** de Google, Microsoft, Meta, YouTube, WhatsApp, LinkedIn, TikTok y Drive.
- **Valores de referencia:** endpoints, permisos y requisitos de revisión de cada proveedor, a verificar en su sprint.
- **Pruebas:** conexión, desconexión, renovación, errores, multiempresa, OAuth, secretos y permisos.
