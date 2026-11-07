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
