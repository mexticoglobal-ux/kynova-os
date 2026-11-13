# ADR-0030: NEX Executive Copilot, el director ejecutivo digital de cada empresa

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-12 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | nex · copilot · planes · recomendaciones · acciones · aprobación humana · multiempresa · determinismo |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
NEX ya recuerda (ADR-0027), relaciona (ADR-0028) y recupera contexto (ADR-0029), y KOE ya calcula las cifras de la empresa. Falta lo que une todo: antes de responder o proponer algo, NEX debe **entender el negocio completo** y decidir qué conviene hacer. Este sprint construye **una capa nueva**, `lib/nex/copilot/`, sin modificar KOE, el AI Gateway, el Runtime, el Backend Core, el Integration Hub, Google Workspace, el Financial Router, las Business Templates, el Business Architect, el Memory Engine, el Knowledge Graph ni el RAG. No hay pantallas, IA, base de datos ni ejecución de acciones.

## Decisión
1. **Pipeline fijo:** usuario → Copilot → RAG → Memoria → Knowledge Graph → KOE → plan → respuesta. Nunca se responde solo con la pregunta: primero se recupera el contexto del RAG (que consulta memoria y grafo, con los permisos de quien pregunta), se leen conteos de memoria y grafo y se calculan las cifras de KOE con **su propio** `computeInsights`; nada se recalcula ni se escribe de vuelta.
2. **Comprender la empresa con reglas:** 18 reglas deterministas sobre los hechos producen **problemas, oportunidades y riesgos**, con números e ids como evidencia (nunca el texto de una memoria). Los objetivos salen de la persona, de lo que la empresa dejó escrito como objetivo en su memoria y de uno por defecto según el plan.
3. **Recomendaciones** clasificadas Critical (80 o más), High (60), Medium (35) y Low, cada una con motivo, beneficio, impacto, riesgo, módulos involucrados y evidencia; ordenadas por severidad y desempatadas por id. Los textos son plantillas fijas: nada lo genera un modelo.
4. **Planner:** diez tipos de plan (ventas, marketing, finanzas, operaciones, CRM, automatizaciones, IA, crecimiento, soporte, organización), elegidos por una elección explícita, por una palabra reveladora, por el tema de la pregunta o, en una pregunta general, por el área del peor hallazgo. Un plan tiene dos pasos base, los pasos que atienden las recomendaciones más severas (primero las de su área) y un cierre para medir y volver a consultar; su horizonte (ahora, semana, mes, trimestre) sale de la severidad.
5. **Action Builder: sugerir, nunca ejecutar.** Cada recomendación trae acciones del **catálogo existente de la plataforma** (`ACTION_LEVELS`), cuyo nivel de autonomía se decide en código y falla cerrado. Toda acción nace `requiresApproval: true` y `executed: false`, y **no existe ninguna ruta de código que ejecute una**: una prueba lo vigila. Aprobar solo **registra** quién estuvo de acuerdo, para que una capa posterior (KOE) actúe con sus propias barreras. Según el nivel: 1 lo aprueba un miembro, 2 un gestor, 3 un administrador; un worker, el sistema y NEX nunca aprueban. Una sugerencia caduca (72 h) y ya no puede aprobarse; volver a preguntar no repite acciones ni deshace una decisión.
6. **Sesión sin conversación:** una sesión recuerda tema, objetivo, empresa, quién la abrió, últimas decisiones (máximo 10) y últimas recomendaciones (ids y títulos fijos), más las pocas palabras del último tema para que un seguimiento corto («¿y el descuento?») lo conserve. **No guarda** preguntas, respuestas ni contexto. Es de quien la abrió, caduca por inactividad (30 min) y cada empresa guarda un número acotado.
7. **Datos para un dashboard ejecutivo futuro (sin pantallas):** KPIs, riesgos, oportunidades, alertas, prioridades, resumen ejecutivo y estado general (saludable, atención, crítico o desconocido).
8. **Seguridad multiempresa:** los permisos se aplican **antes** de construir el contexto. El RAG ya oculta la memoria y el grafo que quien pregunta no puede leer; el Copilot oculta además las **cifras**: el dinero solo lo ven gestores y superiores, las cifras operativas miembros y superiores (más workers activos y el sistema), y un viewer solo lo que memoria y grafo le dejan leer. Lo oculto no existe: no se construyen hallazgos, recomendaciones ni acciones sobre ello, y una acción basada en dinero es invisible (y no se puede aprobar) para quien no ve dinero. Los datos de KOE de otra empresa se ignoran aunque se entreguen por error.
9. **Sin secretos:** la pregunta se valida con el RAG (una credencial se rechaza y no se guarda, cachea ni registra); lo que el Copilot conserva de texto libre (objetivo, decisión) es corto y se filtra; la respuesta final se vuelve a filtrar.
10. **Observabilidad por empresa, sin la pregunta ni el contexto:** consultas, contextos, planes por tipo, recomendaciones por severidad, acciones sugeridas por nivel, aprobadas, rechazadas y caducadas, latencia, ranking y los módulos consultados (RAG, memoria, grafo, KOE).

## Consecuencias
- **Honestidad sobre lo probado:** todo se probó con los motores reales de memoria, grafo y RAG, y con registros reales del libro de KOE procesados por KOE, sobre estado en memoria y reloj inyectado. Las 18 reglas, sus umbrales y los pesos son **valores de partida míos** que conviene revisar con el negocio. Las recomendaciones son consejos genéricos de reglas, no un análisis de un modelo.
- **Cobertura de KOE:** el Copilot usa solo lo que `computeInsights` ya calcula; no hay todavía reglas sobre cobros, academia, marketplace o referidos.
- **El plan puede quedarse corto en empresas nuevas:** sin KOE ni memoria solo recomienda capturar conocimiento y definir objetivos.
- **Aprobar no es ejecutar:** hoy una acción aprobada no hace nada. Conectarla con KOE (que decide, con autorización vigente y límites, si actúa) es un paso posterior y con aprobación propia.
- **Archivos de sprints anteriores tocados:** únicamente tests. Los guards de los Sprints 43, 44 y 45 («nadie más importa esta capa todavía») ahora permiten `lib/nex/copilot` como consumidor; ninguna fuente de esas capas cambió.
- **Pendiente con aprobación propia:** (a) conectar el Copilot con NEX y el Runtime, (b) conectar las acciones aprobadas con KOE, (c) puente de eventos al Event Bus, (d) persistencia de sesiones y acciones con RLS, (e) pantallas del dashboard, (f) más reglas con más fuentes de KOE.
- **No hecho a propósito:** ninguna base de datos, llamada de IA, pantalla, ejecución de acciones, migración ni despliegue.

## Referencias
ADR-0006, ADR-0009, ADR-0027, ADR-0028, ADR-0029, `lib/nex/copilot/copilot.test.ts`.
