# Revisión: NEX trabaja de forma continua, no solo de noche

> Fecha: **2026-11-05** · Responde a la visión de trabajo continuo: NEX atiende conversaciones durante toda la jornada como primer asesor comercial, y presenta un resumen en el cambio de turno.
> Revisa si esa visión exige ajustes en la Constitución (PR #7), el ADR-0009 y la arquitectura, y qué parte del roadmap aprobado cambia.
> Separa lo aplicado en los documentos de lo que sigue **sin decidir**. Los hechos externos (plataformas, regulación) proceden de fuentes secundarias y deben verificarse en la documentación oficial antes de construir.

## Resumen

| Artefacto | ¿Requiere ajuste? | Estado |
|-----------|-------------------|--------|
| Constitución (PR #7) | **Sí** | Aplicado: Artículos 1, 3, 5, 6, 7, 9, 11, 12, 13 y 14; decisiones C10 a C15 abiertas |
| ADR-0009 (rama local) | **Sí** | Aplicado: contexto de trabajo continuo, acuerdos de trabajo, tabla de niveles para conversaciones, riesgos y verificación |
| Arquitectura | **Sí, de fondo** | Documentada aquí; requiere ADR nuevos antes de construir |
| Roadmap aprobado | **Sí** | **Propuesta de cambio abajo, pendiente de aprobación**; el roadmap aprobado sigue en vigor hasta entonces |

## 1. Qué cambia respecto a lo que habíamos escrito

Hasta ahora se describía un **turno de noche**: trabajo programado mientras el dueño no está. La visión nueva añade un modo mucho más exigente:

| Modo | Disparador | Tiempo de respuesta | Antes | Ahora |
|------|-----------|---------------------|-------|-------|
| **Conversación** | Un mensaje de un cliente por un canal | Segundos | No existía | **Núcleo del producto** |
| **Vigilancia** | Programado (cron) | Minutos u horas | Turno de noche | Se mantiene |
| **Cambio de turno** | El propietario inicia sesión | Al abrir | Informe de la mañana | Resumen ejecutivo desde la última conexión |

NEX pasa de ser un agente de **trabajo diferido** a un agente **dirigido por eventos**. Eso cambia el diseño de ejecución (C3), la identidad (C2), la memoria (C4), el modelo de datos y el coste por empresa.

## 2. Conflictos con lo ya aprobado y decisiones que hacen falta

| # | Conflicto o hueco | Por qué importa | Propuesta |
|---|-------------------|-----------------|-----------|
| **C10** | **"Cerré 4 ventas automáticamente"** choca con el Nivel 3: un compromiso comercial tiene impacto financiero y contractual y el Nivel 3 por ámbito no se delega ni se convierte | Es el mensaje central del resumen de cambio de turno | **A (recomendada para empezar):** cierre asistido; NEX prepara y el humano confirma el compromiso. **B:** cierre delegado dentro de una oferta, precios y límites que el cliente predefine; exige enmendar el Nivel 3, integrar pagos y análisis legal |
| **C11** | El criterio aprobado "primera comunicación con un tercero" **requeriría confirmar cada cliente nuevo que escribe**, lo que anula al asesor comercial | Cada prospecto nuevo sería una confirmación | Entender "primera comunicación" como el contacto **iniciado por NEX**; conectar un canal es una aprobación única que crea el acuerdo del canal. Aplicado como propuesta en la Constitución y el ADR |
| **C12** | ¿Se identifica NEX como IA ante el cliente final? | Honestidad (Constitución) y regulación. Fuentes secundarias indican que el [artículo 50 de la AI Act](https://gdprlocal.com/eu-ai-act-article-50/) exige informar de que se habla con una IA y que [aplica desde el 2 de agosto de 2026](https://secureprivacy.ai/blog/eu-ai-act-article-50-transparency-obligations-for-chatbots-and-deepfakes-2026) | Que NEX se presente como el asistente de IA de la empresa. **No he verificado el texto oficial**; hacerlo con el análisis legal |
| **C13** | **ADR-0006 se diseñó sin datos personales de clientes finales.** Conversaciones, teléfonos, nombres y mensajes cambian eso por completo | Las decisiones pendientes de ADR-0006 (región, retención, borrado, entorno, análisis legal) pasan de "antes de datos reales de Nova" a "antes de conectar cualquier canal" | ADR propio de datos de clientes finales: clasificación, base legal, consentimiento, encargado de tratamiento, derechos de los interesados y condiciones del proveedor de IA |
| **C14** | **Las plataformas imponen sus reglas.** Meta [restringe los asistentes de propósito general en WhatsApp Business](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban) (vigente desde el 15 de enero de 2026) aunque permite los bots de atención de una empresa; el [chat de Google Business Profile se cerró el 31 de julio de 2024](https://www.androidcentral.com/apps-software/google-shutting-down-maps-business-chat) y [Business Messages dejó de funcionar](https://developers.google.com/business-communications/business-messages/resources/release-notes/update-on-gbm) | **Google Business Profile no puede ser hoy un canal de conversación**; en la lista de canales de la visión solo cabría para reseñas, a verificar. No he revisado las ventanas de mensajería, plantillas ni aprobaciones de Meta | Verificar cada canal en su documentación oficial y integrarlos **uno a uno** |
| **C15** | **Clínicas: datos de salud** | Datos especialmente protegidos; el Blueprint sitúa "Salud" en la fase 4 de verticales | Fuera del MVP hasta decidirlo |

## 3. Arquitectura objetivo (por decidir, no construida)

Flujo de una conversación. Todo lo de la columna "Candidato" es una opción **sin decidir**:

| Paso | Función | Hoy | Candidato (requiere ADR) |
|------|---------|-----|--------------------------|
| 1. Canal | Recibe el mensaje (webhook de la plataforma, widget propio, correo, formulario) | ❌ | Rutas `fetch` del Worker actual |
| 2. Pasarela de canales | Verifica la firma, resuelve la empresa, evita duplicados, limita el ritmo, responde rápido | ❌ | Capa nueva en `lib/` con contratos por canal |
| 3. Cola | Desacopla la recepción del procesamiento y permite reintentos | ❌ | Colas o equivalente de Cloudflare (no revisadas aquí) |
| 4. Ejecución por conversación | Procesa los mensajes de una conversación **en orden** y conserva su estado | ❌ | Un objeto con estado por conversación; las [alarmas de Durable Objects](https://developers.cloudflare.com/durable-objects/api/alarms/) permiten reintentos. No probado con OpenNext, que exige un [worker personalizado](https://opennext.js.org/cloudflare/howtos/custom-worker) |
| 5. Núcleo de NEX | Detecta spam, identifica al cliente, responde preguntas frecuentes, califica | ❌ (`lib/nex.ts` simulado) | `lib/ai/`, AI Gateway, evals |
| 6. Puerta de acciones | Clasifica el nivel y comprueba la autorización **por código**, fallando cerrado | ❌ | ADR-0009 |
| 7. Herramientas | CRM, agenda, envío por el canal | ❌ (CRM demo) | Contratos en `lib/contracts/` |
| 8. Registro de acciones | Qué, por qué y bajo qué autorización; fuente del resumen | ❌ | Tabla append-only por tenant |
| 9. Traspaso a humano | Bandeja del asesor con el contexto preparado | ❌ | UI y contrato nuevos |
| 10. Cambio de turno | Resumen ejecutivo generado desde el registro | ❌ | Trabajo programado |

**Entidades a diseñar** (todas con `tenant_id` y RLS; las de clientes finales con clasificación reforzada): conexiones de canal, contactos, conversaciones, mensajes, traspasos, acuerdos de trabajo, autorizaciones, registro de acciones, fuentes de conocimiento y resúmenes.

**Requisitos no funcionales nuevos:** presupuesto de latencia por respuesta; coste de IA **por mensaje** y por empresa (relevante para los planes); idempotencia y orden; degradación honesta cuando NEX o un canal fallan (mensaje de espera y traspaso, nunca silencio); observabilidad de conversaciones sin registrar contenido sensible en los logs; aislamiento estricto entre empresas.

**Lo que se reutiliza de lo construido:** Auth, tenancy y RLS (ADR-0006), la API de perfil, i18n de 8 idiomas, el Business Profile como semilla del Business DNA, el estudio de creadores como una herramienta futura, el Worker y el CI. **Lo que falta es casi todo el lado del agente.**

## 4. Roadmap: propuesta, pendiente de aprobación

> El roadmap aprobado (Sprint 5 a 13) **sigue en vigor** hasta que se apruebe este cambio. Motivo de la propuesta: el CRM deja de ser "una herramienta del sprint 11" y pasa a ser el destino del trabajo de NEX; y las conversaciones son el primer trabajo real del agente, no un sprint tardío.

| Sprint | Propuesta | Cambio frente al aprobado |
|--------|-----------|---------------------------|
| 5 | Cerrar el spike | Sin cambios |
| 6 | **Fundamentos del agente:** ADRs de autonomía (C1), identidad (C2), ejecución continua por eventos y programada (C3), memoria (C4), **canales y conversaciones, datos de clientes finales (C13), acuerdos de trabajo y traspaso a humano**; inicio del análisis legal (C12, C13, C15) | Se amplía la lista de ADR |
| 7 | NEX real mínimo (Nivel 1, solo lectura) | Sin cambios |
| 8 | Perfil completo y endurecimiento | Sin cambios; las decisiones de datos reales dependen ahora también de C13 |
| 9 | **Conversaciones v1:** un solo canal propio (chat web o formulario), CRM mínimo (contactos y conversaciones), acuerdos de trabajo, traspaso a humano y primeras autorizaciones de Nivel 2 para preguntas frecuentes | **Nuevo; sustituye a "Turno de noche"** |
| 10 | **Cambio de turno y vigilancia programada:** registro de acciones persistente, resumen ejecutivo, bandeja de decisiones | Absorbe el turno de noche |
| 11 | **Primer canal externo** (el que decidan Jeffrey y Nova, según C14) y herramienta de agenda | Sustituye a "CRM como herramienta" (el CRM mínimo ya está en el 9) |
| 12 | Piloto con Nova | Sin cambios, con las condiciones de datos reales ampliadas por C13 |
| 13 | Producción | Sin cambios |

**Dos cautelas:** (1) conectar un canal de Meta puede requerir verificaciones y aprobaciones propias cuyos plazos no he comprobado y que pueden condicionar el calendario; (2) el CRM completo (oportunidades, etapas, segmentos) queda fuera hasta después del piloto.

## 5. Qué se aplicó en los documentos

| Documento | Cambios |
|-----------|---------|
| Constitución (PR #7) | Artículo 1: KYNOVA pone a trabajar un equipo de empleados de IA. Artículo 3: nuevo papel de primer asesor comercial. Artículo 5: identificación como IA ante clientes (propuesta). Artículo 6 reescrito en tres partes: la jornada, la ausencia del dueño y el cambio de turno, con el ejemplo del resumen. Artículo 7: acuerdos de trabajo y aplicación a conversaciones. Artículo 9: equipo de empleados de IA y acuerdos de trabajo. Artículos 11 a 14: canales, líneas rojas, métricas y decisiones C10 a C15. Corregí "NEX no es un vendedor", que contradecía la visión |
| ADR-0009 | Contexto de trabajo continuo; nueva sección de acuerdos de trabajo con la tabla de niveles para conversaciones; spam en cuarentena; resumen derivado solo del registro; riesgos de terceros hostiles, datos de clientes finales y plataformas; pruebas de conversación y de latencia; decisiones pendientes 8 a 12 |

## 6. Lo que necesito de ti

1. **C10:** ¿cierre asistido (A) para empezar o cierre delegado (B)?
2. **C11:** ¿confirmas que "primera comunicación" significa el contacto que inicia NEX?
3. **C12:** ¿NEX se identifica como IA ante el cliente final?
4. **C14:** ¿cuál es el primer canal real para Nova?
5. **Roadmap:** ¿apruebas la propuesta de la sección 4?
6. **Aviso:** C13 y C15 no se resuelven con un documento; requieren análisis legal.
