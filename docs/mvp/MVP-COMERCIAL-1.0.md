# MVP Comercial 1.0 — diseño (borrador)

> Estado: **borrador para revisión de Jeffrey**. Fecha: 2026-11-05.
> **Criterio único:** ¿esto ayuda a que Nova Marketing Studio obtenga más clientes utilizando KYNOVA? Lo que no lo hace, va a `FUTURO.md`.
> Se construye en paralelo a la revisión de los PR #6 (handoff), #7 (Constitución) y #8 (ADR-0009). Este documento **no depende de ellos** salvo donde se indica en la sección 8.
> Los datos de Nova están en `nova/PACK-NOVA-BORRADOR.md` y **no están confirmados**.

## 1. Dos clientes, un motor

| Cliente | Para qué | Quién es el "prospecto" |
|---------|----------|-------------------------|
| **Nova Marketing Studio** (primero) | Conseguir más clientes: NEX atiende y prepara a los prospectos de Nova | Empresas que buscan servicios de marketing |
| **KYNOVA como su propio cliente** | Conseguir clientes de KYNOVA con el mismo método | Empresas que podrían usar KYNOVA |

Es **el mismo motor** (`lib/audit.ts`) con **paquetes distintos** de datos del cliente: catálogo, preguntas frecuentes, criterios de calificación, horarios, reglas de escalado y mensajes. Nada propio de Nova o de KYNOVA vive en el código (ADR-0006). El paquete de Nova es lo primero; el de KYNOVA reutiliza la estructura (su catálogo serán sus módulos y planes) y se prepara después.

## 2. Un ajuste necesario a lo aprobado: la Fase A en un chat en vivo

Se aprobó "Fase A: NEX redacta y Nova aprueba cada respuesta". En un chat web **en vivo** eso obliga a que una persona de Nova esté conectada para cada mensaje: el prospecto esperaría y se pierde el objetivo (responder rápido, también fuera de horario).

**Propuesta: dos versiones del chat de Nova.**

| Versión | Qué es | Qué NEX hace | Depende de |
|---------|--------|--------------|------------|
| **v1 — Chat guiado (el MVP)** | Un flujo con mensajes que **Nova ya aprobó por adelantado**, preguntas cerradas y un motor determinista. Funciona 24/7 | Prepara el resumen y la recomendación para Nova (trabajo interno, Nivel 1). **No improvisa mensajes al prospecto** | Nada normativo nuevo: es una función del producto con contenido aprobado, como un formulario guiado |
| **v2 — Conversación libre** | NEX conversa con lenguaje natural dentro del acuerdo de trabajo de Nova | Responde preguntas frecuentes y mantiene el diálogo | ADR-0009 aceptado (Nivel 2), `lib/ai/`, registro de acciones, parada de emergencia, evaluaciones de autonomía |

La v1 ya entrega lo esencial para Nova: **un prospecto preparado, calificado y con recomendación**, a cualquier hora. Aun así debe **identificarse como asistente automatizado** y mostrar un aviso de datos (decisiones C12 y C13, pendientes de análisis legal).

## 3. Flujo de onboarding de una empresa

Operado por KYNOVA en el MVP; sin alta en autoservicio.

| # | Paso | Quién | Hoy | Para el MVP |
|---|------|-------|-----|-------------|
| 0 | Acuerdo comercial y datos mínimos | KYNOVA y la empresa | Fuera del producto | Igual |
| 1 | Alta de la empresa y de su propietario | KYNOVA | Manual por SQL en un proyecto desechable | Script de alta documentado; sin pantalla |
| 2 | Primer acceso del propietario con código OTP | Propietario | Funciona en el Preview con las cuentas de prueba; el correo integrado de Supabase se limita a miembros del equipo (límite documentado en `RESULTADO.md`) | **SMTP propio** para que una persona externa, como el propietario de Nova, reciba su código |
| 3 | **Business Audit de la propia empresa** | Propietario, guiado por NEX | Assessment v0 de 6 preguntas, sin guardar | Mismo motor que el audit de prospectos, 8 dimensiones |
| 4 | Guardar el perfil (con aviso de qué se guarda) | Propietario | API y pantalla mínimas | Guardar el resultado del audit (ADR-0006, fase 2) |
| 5 | **Paquete de la empresa**: catálogo, FAQs, criterios de calificación, horarios, escalado, mensajes | Propietario revisa y aprueba | No existe | Se carga como datos versionados; el propietario aprueba cada versión |
| 6 | Conectar el canal | KYNOVA | No existe | Chat web embebible en el sitio de la empresa y ensayo con conversaciones ficticias |
| 7 | Puesta en marcha | Jeffrey y el propietario | — | Lista de puertas (sección 8) |
| 8 | Primer **resumen de cambio de turno** | NEX | No existe | Resumen al iniciar sesión, derivado de las conversaciones registradas |

## 4. Business Audit v1 y Business Score

Evaluación **autodeclarada** de la madurez digital: ocho dimensiones, cuatro niveles cerrados cada una. El resultado lo dice siempre ("según lo que usted nos indicó"); no verifica el sitio ni las redes reales.

| Dimensión | Peso | Pregunta guía | Nivel 0 *(none)* | Nivel 1 *(adHoc)* | Nivel 2 *(defined)* | Nivel 3 *(optimized)* |
|-----------|-----:|---------------|------------------|-------------------|---------------------|-----------------------|
| `web` Presencia web | 15 | ¿Cómo es su sitio web? | No tiene | Solo redes o una página básica | Sitio propio actualizado | Sitio orientado a captar y medido |
| `social` Redes sociales | 10 | ¿Cómo usa las redes? | No las usa | Publica sin constancia | Publica con un calendario | Estrategia por red con resultados medidos |
| `capture` Captación | 20 | ¿Cómo le llegan los clientes? | Solo recomendaciones | Mensajes directos y llamadas, manual | Formularios o chat en el sitio | Varios canales con seguimiento de origen |
| `followUp` Seguimiento | 15 | ¿Cómo da seguimiento a un interesado? | De memoria | Notas u hoja de cálculo | Una herramienta con recordatorios | Proceso definido y medido |
| `automation` Automatización | 10 | ¿Qué tareas repetitivas automatiza? | Ninguna | Plantillas manuales | Algunas respuestas y avisos automáticos | Flujos conectados entre herramientas |
| `analytics` Medición | 15 | ¿Cómo mide lo que funciona? | No mide | Mira seguidores y "me gusta" | Mide contactos y ventas por canal | Tableros con metas y retorno |
| `advertising` Publicidad | 10 | ¿Invierte en publicidad? | No | De forma ocasional | De forma regular | Optimizada con retorno medido |
| `ai` Uso de IA | 5 | ¿Usa IA en su trabajo? | No | La ha probado | La usa en algunas tareas | Integrada en sus procesos |

- **Business Score** = suma de `peso × nivel / 3`, redondeada: de 0 a 100. **Bandas:** inicial (0–24), básica (25–49), intermedia (50–74), avanzada (75–100).
- **Etapa de infraestructura** según cuántos de los cuatro pilares (`web`, `capture`, `followUp`, `analytics`) llegan al nivel 2: ninguno → **sin infraestructura**; uno o dos → **parcial**; tres o cuatro → **establecida**.
- **Brechas:** dimensiones por debajo del nivel 2, ordenadas por impacto (`peso × (3 − nivel)`); **fortalezas:** las demás.
- **Preguntas de contexto** (no puntúan): sector, tamaño del equipo y objetivo principal, con las opciones ya definidas en `lib/contracts/assessment.ts`.
- Implementación de referencia: `lib/audit.ts` y `lib/contracts/audit.ts` (19 pruebas). **Lo puntúa el código, no el modelo.**
- *Nombre:* el **Business Score** no es el *Business Health Score* del Dashboard (estado operativo de la empresa) ni el *KYNOVA Score* del Blueprint. Se propone mantenerlos separados; ver sección 9.

## 5. Cómo decide NEX qué necesita una empresa

**Paso 1 — Etapa.** La infraestructura de la sección 4 separa tres situaciones:

| Etapa | Qué suele necesitar | Enfoque de la recomendación |
|-------|---------------------|-----------------------------|
| **Sin infraestructura** (nueva o no digitalizada) | Presencia y forma de captar clientes | Fundamentos primero: sitio, captación y una presencia básica en redes |
| **Parcial** | Cerrar las brechas de sus pilares más débiles | La brecha de mayor impacto antes que ampliar lo que ya funciona |
| **Establecida** | Optimizar, medir y automatizar | Medición, seguimiento, automatización y publicidad con retorno |

**Paso 2 — Servicios del catálogo.** Cada servicio del cliente declara qué dimensiones resuelve y para qué etapas encaja (`CatalogService`). `recommendServices` ordena por la suma de impactos de las brechas que cierra y **descarta los que no encajan con la etapa**. Cada recomendación explica por qué (qué brechas cierra). Sin brechas, NEX lo dice y no inventa una venta.

**Paso 3 — Calificación del prospecto.** Cuatro factores: presupuesto, plazo, rol de decisión y si dejó un contacto. Los puntos y los umbrales **son del cliente** (`QualificationRules`); por defecto, caliente desde 7 puntos y tibio desde 4, sobre 9.

**Paso 4 — Ruta.**

| Resultado | Ruta |
|-----------|------|
| Caliente | Se propone una llamada y se traspasa **ya** a Nova con el paquete de contexto |
| Tibio | Se propone una llamada, se envía información y entra en la bandeja de Nova |
| Frío | Se le envía información útil, se cierra con cortesía y se guarda sin urgencia |
| Spam | **Cuarentena revisable**; nunca se borra automáticamente |
| Pide una persona, queja, cobro o tema legal | Se traspasa a Nova siempre |

## 6. Primer Journey de NEX para Nova (chat guiado v1)

| Estado | Qué ocurre | Notas |
|--------|------------|-------|
| 0. Entrada | El visitante abre el chat en el sitio de Nova | Sin cuenta ni instalación |
| 1. Presentación | El asistente se identifica como **asistente automatizado de Nova** y muestra el aviso de datos | Texto del aviso pendiente de análisis legal (C12, C13) |
| 2. Filtro | Señales de spam (campo trampa, enlaces, repetición, ritmo) | Cuarentena si procede; el visitante legítimo no nota nada |
| 3. Intención | Menú: cotizar, tengo una pregunta, ya soy cliente, otro | Cliente existente → se avisa a Nova |
| 4. Preguntas frecuentes | Respuestas **aprobadas por Nova**; si no hay respuesta aprobada, se traspasa | NEX no inventa precios, plazos ni promesas |
| 5. Mini-audit | Las ocho preguntas, de a una, con opción de omitir | Unos dos minutos; se guarda lo respondido |
| 6. Resultado | Business Score, tres brechas y los servicios de Nova que las cierran, con el porqué | Lenguaje prudente: "según lo que nos indicó" |
| 7. Calificación | Presupuesto, plazo, rol y contacto | El contacto se pide solo en este punto |
| 8. Ruta | Caliente, tibio o frío (sección 5) | Las reglas son de Nova |
| 9. Cierre | Se confirma al visitante qué pasará y cuándo | Fuera de horario, se promete respuesta en el siguiente horario de atención |

**Paquete de traspaso a Nova** ("un cliente preparado, no una conversación sin contexto"): quién es y cómo contactarle, qué pidió, las respuestas del audit, Business Score y brechas, servicios recomendados con su porqué, calificación con sus puntos, qué se le dijo y qué falta, siguiente paso sugerido y por qué se escala.

**Qué ve Nova al entrar:** el resumen de cambio de turno derivado solo de lo registrado (conversaciones atendidas, spam apartado, prospectos preparados por grado, traspasos pendientes), con cada cifra explicable.

**Métricas para la pregunta única:** tiempo hasta la primera respuesta, proporción de visitantes que completan el audit, prospectos calificados entregados con contexto completo, llamadas agendadas y la valoración de Nova sobre la calidad de los traspasos. *La meta numérica la fija Nova.*

## 7. Alcance del MVP

**Dentro:** el audit y el Business Score, la lógica de decisión, el paquete de Nova como datos, el chat web guiado (v1), la bandeja de traspasos, el resumen de cambio de turno, guardar el perfil y exportarlo y borrarlo.
**Fuera** (a `FUTURO.md`): WhatsApp y demás canales, conversación libre, cierre de ventas y pagos, CRM completo, alta en autoservicio, otros verticales y las demás herramientas de NEX.

## 8. Qué avanza ya y qué espera

| Pieza | Depende de | Estado |
|-------|------------|--------|
| Motor del audit, Business Score, recomendación y calificación | Nada | **Hecho** en la rama `feat/mvp-comercial-foundations` (19 pruebas) |
| Paquete de Nova | Información de Nova | Borrador con hipótesis marcadas |
| Diseño del flujo, audit y journey | Aprobación de Jeffrey | Este documento |
| Interfaz del audit y del chat guiado, en memoria como el Assessment v0 | Textos en 8 idiomas | Siguiente |
| Persistencia (conversaciones, contactos, resultados) | ADR de conversaciones y datos de prospectos; fase 2 de ADR-0006; migración | Espera |
| Conversación libre (v2) | ADR-0009 aceptado y capa de IA | Espera |
| Datos reales de prospectos | Las cuatro condiciones de ADR-0006, región y retención, análisis legal, un entorno aprobado distinto del Preview y aprobación explícita de producción | Espera |

## 9. Decisiones que necesito de Jeffrey

1. ¿Apruebas el **chat guiado v1** como Fase A en lugar de la aprobación por mensaje (sección 2)?
2. Tratamiento al visitante: **"usted"** (propuesto) o "tú".
3. Nombre: ¿mantenemos **Business Score** separado del Business Health Score y del KYNOVA Score?
4. Datos de Nova: el paquete necesita su información real (ver el final de `nova/PACK-NOVA-BORRADOR.md`).
