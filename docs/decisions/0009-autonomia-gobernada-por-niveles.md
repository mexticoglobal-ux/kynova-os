# ADR-0009: Gobernar la autonomía de NEX por niveles de autorización en lugar de la confirmación por acción

| Campo | Valor |
|-------|-------|
| **Estado** | **Propuesto.** Hasta que sea Aceptado, el comportamiento vigente sigue siendo la confirmación explícita por acción |
| **Fecha** | 2026-11-05 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | ia · seguridad · nex · gobierno |
| **Sustituye a** | Regla 12 de `.claude/rules/ai.md`, sección "Niveles de autonomía" de `framework/standards/ai.md` y las frases de confirmación de `docs/DOMAIN.md` (al ser Aceptado; ver "Impacto en el framework") |
| **Sustituido por** | — |

> Junto con la KYNOVA Constitution, este ADR es uno de los documentos fundamentales del producto. Es la **fuente oficial** de por qué KYNOVA pasa de "confirmación por acción" a "autonomía gobernada por niveles".

## Contexto

**Lo que rige hoy.** Tres normas vigentes obligan a que NEX nunca actúe sin un "sí" por cada acción:
- `.claude/rules/ai.md`, regla 12: "Toda acción de NEX con efectos requiere confirmación explícita del usuario."
- `framework/standards/ai.md`: el nivel más alto es "Ejecutar con confirmación … por acción" y "ningún nivel permite ejecutar acciones con efectos sin confirmación."
- `docs/DOMAIN.md` §3: "Toda acción con efectos requiere confirmación explícita del usuario."

Esa norma se escribió para un NEX que **responde cuando se le pregunta**. Hoy NEX es un asistente simulado y reactivo (`lib/nex.ts`); la norma nunca ha tenido que convivir con un agente que trabaja sin el usuario delante.

**Lo que cambia.** La visión de KYNOVA, recogida en `docs/constitution/KYNOVA-CONSTITUTION.md` (PR #7), es que KYNOVA es **un Agente de IA Empresarial que trabaja 24/7**; CRM, marketing, SEO, YouTube, documentos, automatizaciones, Academy y Marketplace son herramientas que NEX usa. Un agente así debe poder hacer trabajo útil mientras el dueño duerme: enviar el informe de la mañana, publicar contenido que el dueño ya programó, responder las consultas repetidas.

**El conflicto.** Con confirmación por acción, el agente 24/7 no puede ejecutar nada sin el usuario: queda reducido a preparar borradores y esperar. El valor que KYNOVA promete —trabajo hecho mientras el dueño no está— desaparece. Pero la solución obvia, dar autonomía libre al modelo, destruye lo que el proyecto declara su activo más importante: **la confianza**.

**Trabajo continuo, no solo nocturno (2026-11-05).** NEX no trabaja únicamente cuando el dueño se desconecta: trabaja toda la jornada, atendiendo las conversaciones que llegan por WhatsApp, Messenger, Instagram, el chat del sitio, formularios, correo, Google Business Profile y otros canales, como **primer asesor comercial** de la empresa (detecta spam, identifica clientes reales, mantiene la conversación, resuelve preguntas frecuentes, califica, obtiene datos, actualiza el CRM, intenta cerrar la venta y escala al humano solo cuando aporta valor). Esto cambia las exigencias del modelo de autonomía:
- Las decisiones ocurren **a velocidad de conversación**, con muchos mensajes al día: la clasificación y la comprobación de autorizaciones deben ser rápidas, deterministas y baratas.
- NEX habla con **terceros** (los clientes de la empresa), que son entradas **no confiables y potencialmente hostiles** en un canal público.
- El producto tratará **datos personales de clientes finales** (nombres, teléfonos, mensajes, historial), algo que ADR-0006 excluyó expresamente del Business Profile v1.
- Aparece el concepto de **acuerdo de trabajo** por empleado de IA o canal, definido por el cliente (ver Decisión §4).

**Decisiones del propietario ya tomadas (2026-11-05):**
- La autonomía se organiza por **tres niveles**, no con una respuesta binaria.
- El Nivel 2 **no entra en vigor** hasta que este ADR sea aceptado y se actualicen las normas vigentes.
- Los criterios adicionales del Nivel 3 y la regla de conversión del Nivel 3 al Nivel 2 están aprobados (ver "Decisión").

**Restricciones.** Aislamiento por tenant y mínimo privilegio (`AGENTS.md` §7.1, `ai.md` regla 11); lo determinista antes que lo generativo (`AGENTS.md` §3.4); registro auditable de acciones de NEX (`framework/standards/ai.md`, "Preparación Enterprise"); el producto ni siquiera tiene aún `lib/ai/`, identidad del agente ni ejecución en segundo plano (ver `docs/handoff/REVISION-4-PUNTOS.md`).

## Problema

¿Cómo permite KYNOVA que NEX ejecute trabajo útil sin el usuario presente, sin perder el control del dueño ni la confianza, y de forma explicable y auditable?

## Criterios de decisión

1. **Confianza y control del dueño:** el cliente decide qué delega y puede retirarlo al instante.
2. **Valor 24/7:** NEX debe poder hacer trabajo real en ausencia del usuario.
3. **Auditabilidad:** cada acción se explica: qué, por qué y bajo qué autorización.
4. **Seguridad ante manipulación:** resistencia a inyección de instrucciones y a abuso.
5. **Determinismo:** que una acción exceda o no su permiso lo decide código verificable, no el criterio del modelo.
6. **Reversibilidad y daño acotado:** lo irreversible o de gran impacto nunca se delega.
7. **Claridad para el cliente:** que se pueda explicar en una frase.
8. **Coste de implementación y compatibilidad** con la arquitectura actual.

## Opciones consideradas

### Opción A: Mantener la confirmación por acción
- **Ventajas:** máxima seguridad y simplicidad; ya es la norma vigente; ninguna superficie nueva.
- **Inconvenientes:** incompatible con el agente 24/7; el usuario recibe muchas confirmaciones (fatiga) y acaba aprobando sin leer, lo que **reduce** la seguridad real; NEX nunca trabaja solo.
- **Coste y esfuerzo:** ninguno.

### Opción B: Autonomía amplia, con el modelo decidiendo cuándo consultar
- **Ventajas:** mínima fricción; el agente más "inteligente".
- **Inconvenientes:** la decisión de consultar depende del criterio del modelo, que no es determinista ni verificable; vulnerable a inyección de instrucciones; imposible de auditar con garantías; contradice `AGENTS.md` §3.4 y `ai.md` reglas 6 y 8. Descartada.
- **Coste y esfuerzo:** bajo de construir, alto de asegurar; no asegurable.

### Opción C: Autonomía fijada por KYNOVA por tipo de herramienta, sin autorización del cliente
- **Ventajas:** sin gestión de autorizaciones por el cliente.
- **Inconvenientes:** el cliente no controla lo que delega; una misma acción tiene un riesgo distinto según el negocio; choca con "el negocio es de su dueño" (Constitución, Artículo 2). Descartada.
- **Coste y esfuerzo:** medio.

### Opción D: Autonomía gobernada por niveles con autorizaciones permanentes del cliente
- **Ventajas:** el dueño decide cuánto delega y lo revoca al instante; permite trabajo 24/7 en tareas acotadas; la comprobación de límites es determinista y auditable; lo importante sigue exigiendo confirmación.
- **Inconvenientes:** más complejidad (registro de autorizaciones, pantalla de gestión, registro de acciones); superficie de ataque nueva (inyección que busque disparar acciones autorizadas); exposición legal al actuar en nombre del negocio; riesgo de que el cliente conceda más de lo que debe.
- **Coste y esfuerzo:** alto, repartido en varios sprints (ver "Plan de implementación").

## Decisión

**Se elige la Opción D: autonomía gobernada por niveles.** Se descarta la confirmación por acción como único mecanismo porque convierte al agente en un asistente reactivo, y se descartan B y C porque quitan al cliente el control o la verificabilidad.

### 1. Los tres niveles

| Nivel | Qué puede hacer NEX | Qué necesita |
|-------|---------------------|--------------|
| **1. Observar y preparar** | Observar, analizar, investigar y preparar información (informes, borradores, propuestas, su propia lista de trabajo) | Nada |
| **2. Ejecutar lo autorizado** | Ejecutar tareas previamente autorizadas por el cliente mediante **autorizaciones permanentes y limitadas** (p. ej.: publicar contenido programado, responder consultas frecuentes, enviar reportes) | Una autorización permanente vigente que cubra exactamente esa tarea |
| **3. Confirmar siempre** | Toda acción con impacto legal, financiero, contractual, administrativo o que modifique información crítica | Confirmación explícita del usuario, por acción |

**Criterios adicionales del Nivel 3 (aprobados):** también exigen confirmación la **primera comunicación con un tercero**, **cualquier comunicación sensible** (quejas, disputas, cobros), el **uso de un canal nuevo** y **cualquier acción irreversible**.

### 2. El nivel lo decide el código, no el modelo
1. Cada acción que NEX puede ejecutar se declara en un **registro de acciones** con su nivel, su ámbito (legal, financiero, contractual, administrativo, información crítica, ninguno), su reversibilidad y su tipo de destinatario.
2. El modelo **propone** una acción; el sistema **clasifica** y **comprueba** su nivel y su autorización con reglas deterministas. El modelo no puede rebajar el nivel de una acción ni ampliar una autorización.
3. **Fallo cerrado:** si el sistema no puede clasificar una acción o verificar su autorización, la trata como Nivel 3 y consulta.
4. Una acción cuya clasificación depende de un dato externo (por ejemplo, el destinatario) se clasifica con el valor más restrictivo posible.

### 3. Autorización permanente (Nivel 2)
Es un registro de datos por tenant, versionado, con:
- **qué acción exacta** y ante qué situación;
- **límites:** destinatarios, canales, importes, volumen;
- **horario y vigencia** (con una vigencia máxima por defecto, a fijar en la implementación);
- **cómo se deshace** la acción, si es posible;
- **quién la concedió y cuándo** (solo el propietario de la empresa);
- **estado:** activa, pausada, revocada o caducada.

Reglas:
1. NEX actúa solo dentro de lo escrito; lo que ninguna autorización cubre es Nivel 3.
2. **Una autorización nunca puede cubrir una acción de Nivel 3 por su ámbito.**
3. Se **revoca al instante**; NEX deja de usarla en ese momento y lo registra.
4. Con autorizaciones solapadas, se aplica la más restrictiva; en la duda, consulta.
5. **Cada ejecución cita su autorización** y se comprueba contra ella **justo antes de ejecutar**.
6. El contenido que llega de terceros (mensajes, documentos, páginas) **nunca amplía** una autorización ni modifica sus límites.

### 4. Acuerdos de trabajo y conversaciones entrantes

Un **acuerdo de trabajo** agrupa las autorizaciones permanentes de un empleado de IA o de un canal, junto con sus políticas: objetivo y alcance, tono, horario, base de preguntas frecuentes, criterios de calificación, reglas de escalado, límites y vigencia. Lo define y aprueba el propietario, es versionado y revocable al instante. **Sin acuerdo de trabajo vigente, un empleado de IA solo trabaja en Nivel 1.** Cada acción autónoma sigue citando **la autorización concreta** dentro del acuerdo.

**Aplicación de los niveles a las conversaciones — propuesta de este ADR, pendiente de aprobación:**

| Situación | Nivel propuesto | Razón |
|-----------|-----------------|-------|
| Responder a quien escribió primero, dentro del acuerdo del canal (preguntas frecuentes, información) | 2 | El cliente final inicia el contacto; el acuerdo acota qué puede decir |
| **Primera comunicación iniciada por NEX** con un tercero | 3 | Criterio adicional aprobado |
| **Conectar un canal nuevo** | 3, una vez, por el propietario | Criterio adicional aprobado; esa aprobación crea el acuerdo del canal |
| Comunicación sensible (queja, disputa, cobro) | 3: se escala a una persona | Criterio adicional aprobado |
| Crear o actualizar contacto, notas y etapa en el CRM a partir de la conversación | 2 | Reversible, trazable y de bajo impacto |
| Borrar, fusionar o exportar datos de clientes | 3 | Información crítica |
| Spam | 1/2: **cuarentena revisable**, nunca borrado automático | Un falso positivo no puede perderse |
| Agendar o reservar una cita sin cobro, cancelable | 2, con límites de volumen y horario | Reversible; sin impacto financiero |
| Reserva o cita **con pago, depósito o condiciones legales** | 3 | Impacto financiero o contractual |
| **Cerrar una venta** | **3 por su ámbito financiero y contractual** — ver decisión pendiente | El Nivel 3 por ámbito es no delegable |
| Recopilar información inicial de **salud** | **Bloqueado hasta decidir C15** | Datos especialmente protegidos |

**Cierre de ventas — decisión pendiente (C10).** El resumen de cambio de turno de la visión dice "cerré 4 ventas automáticamente". Con las reglas aprobadas, un compromiso comercial tiene impacto financiero y contractual y es Nivel 3, no convertible a Nivel 2. Hay dos caminos, a decidir por el propietario:
- **A. Cierre asistido (recomendado para empezar):** NEX lleva la venta hasta el punto de confirmación y el dueño o su asesor confirma el compromiso; el resumen dice "preparé N ventas listas para tu confirmación". No cambia las reglas aprobadas.
- **B. Cierre delegado dentro de una oferta predefinida:** el cliente fija en el acuerdo de trabajo la oferta, los precios, las condiciones y los límites (importe máximo por operación y por día) y NEX ejecuta cierres que caben exactamente ahí. Exige **enmendar el Nivel 3** (hoy no delegable), integrar pagos y facturación, y análisis legal previo. Su efecto: la decisión financiera y contractual la toma el cliente por adelantado, no NEX.

### 5. Del Nivel 3 al Nivel 2 (aclaración aprobada)
Después de que el usuario autoriza un flujo por primera vez, puede convertir determinadas acciones **repetitivas** en autorizaciones permanentes de Nivel 2, siempre que **no impliquen impacto legal, financiero, contractual ni sean irreversibles**.

Interpretación adoptada (a confirmar al aprobar):
- Solo se convierten las acciones que eran Nivel 3 **por los criterios adicionales** (primera comunicación, comunicación sensible, canal nuevo).
- Las que son Nivel 3 **por su ámbito** (legal, financiero, contractual, administrativo, información crítica) **nunca** se convierten.
- La conversión la **decide el usuario**; NEX puede proponerla, no activarla.

### 6. Transparencia y auditoría
Cada acción de NEX genera un **registro append-only** que responde las tres preguntas de la Constitución: **qué hizo, por qué lo hizo y bajo qué autorización actuó.** Incluye: identificador, tenant, acción, nivel, identificador de la autorización o de la confirmación, motivo, referencias a los datos usados (no su contenido sensible), resultado, si es reversible y cómo, versión del modelo y del prompt, y marca de tiempo. El cliente puede consultarlo y NEX no puede modificarlo ni borrarlo. En el trabajo con conversaciones el registro se agrupa por **conversación** y por **contacto**, y es la **única fuente** del resumen de cambio de turno: toda cifra que NEX presente al propietario ("respondí 54 conversaciones") debe poder rastrearse a registros concretos.

### 7. Controles de seguridad
- **Parada de emergencia:** el dueño pausa todo el Nivel 2 o una autorización concreta, y la orden se cumple de inmediato.
- **Presupuesto y límites** de uso por tenant (`ai.md` reglas 13–14), con corte controlado.
- **La ausencia del usuario no amplía permisos:** de noche NEX solo puede lo que podría de día.
- **Evaluaciones de autonomía** como nueva dimensión de evals (ver "Verificación").
- **Los mensajes de terceros son datos, no instrucciones:** nunca amplían una autorización ni modifican un acuerdo de trabajo.
- **Límites de volumen** por autorización, por conversación y por contacto (mensajes por hora, acciones por día), con corte y aviso al propietario.
- Cualquier herramienta o acción nueva de Nivel 2 requiere `/security-review`.

### 8. Lo que este ADR no decide
Depende de otros ADR, que deben existir antes de activar el Nivel 2: **identidad del agente dentro de un tenant** (C2), **ejecución en segundo plano** (C3), **memoria del negocio** (C4), **esquema y retención del registro de acciones**, **canal de aviso** (C6) y los ADR que exige el trabajo con conversaciones: **canales y conversaciones** (integración con cada plataforma, ventanas de mensajería, aprobaciones de la plataforma), **datos personales de clientes finales** (C13), **traspaso a un humano** y **ejecución por eventos** (C3). En particular: la frase de `DOMAIN.md` §3 "con los permisos del usuario que lo invoca" no describe una ejecución de Nivel 2 sin usuario presente; el ADR de identidad la reformulará, con la regla de que **una ejecución nunca puede exceder lo que el propietario que concedió la autorización podría hacer**.

## Consecuencias

- **Positivas:** el agente 24/7 es posible sin soltar el control; la explicación "qué, por qué y bajo qué autorización" es una propiedad del sistema, no un favor del modelo; menos fatiga de confirmaciones sobre tareas repetitivas y de bajo riesgo; la seguridad de lo importante no baja.
- **Negativas:** más superficie que construir y mantener (registro de acciones, de autorizaciones, pantalla de gestión, evaluaciones); más decisiones de diseño por tipo de acción; el cliente debe entender y gestionar sus autorizaciones.
- **Riesgos y mitigaciones:**

| Riesgo | Mitigación |
|--------|------------|
| Inyección de instrucciones para disparar acciones autorizadas | El modelo no decide el nivel; la autorización se comprueba por código antes de ejecutar; el contenido de terceros nunca amplía permisos; evals de seguridad |
| El cliente concede más de lo prudente | Autorizaciones acotadas por diseño; Nivel 3 por ámbito no delegable; vigencia máxima; revisión periódica; NEX propone, el usuario decide |
| Daño por una autorización mal definida | Límites de volumen e importe; parada de emergencia; acciones reversibles primero; registro completo |
| Responsabilidad legal al actuar en nombre del negocio | Análisis legal antes del primer cliente con datos reales (ya pendiente en ADR-0006); términos de servicio |
| Fallo del registro de acciones | Una acción de Nivel 2 **no se ejecuta** si no puede registrarse |
| Clientes finales o atacantes manipulan a NEX por un canal público (inyección a escala) | Mensajes de terceros como datos no confiables; el modelo no decide el nivel; límites de volumen; evaluaciones de seguridad con ataques por canal; sin acción de Nivel 2 que dependa de texto libre del tercero sin validación |
| Tratamiento de datos personales de clientes finales | ADR propio antes de conectar el primer canal: base legal, minimización, región, retención y borrado (ADR-0006 los excluyó) |
| Políticas de las plataformas (WhatsApp, Meta, Google) | Verificar cada canal en su documentación oficial antes de integrarlo; un canal a la vez |
| El cliente final cree que habla con una persona | Presentación como asistente de IA de la empresa (decisión C12); en la UE, obligación de transparencia para chatbots |
| El resumen de cambio de turno exagera lo hecho | El resumen se genera solo desde el registro de acciones y cada cifra es rastreable |
| Deriva: nuevas acciones sin clasificar | El registro de acciones es la única vía de ejecución; lo no registrado se trata como Nivel 3 |

## Impacto en el framework

- **Reglas no negociables (`AGENTS.md` §7) afectadas:** ninguna se debilita. Se refuerzan: §7.1 (tenancy), §7.2 (IA solo por `lib/ai/`), §7.9 (verificación) y §7.11 (producción).
- **RULES afectadas:** `.claude/rules/ai.md` (regla 12 y el checklist); `.claude/rules/security.md` no cambia pero la revisión de seguridad pasa a ser obligatoria para toda acción de Nivel 2.
- **Estándares afectados:** `framework/standards/ai.md` (tabla "Niveles de autonomía", nueva dimensión de evals "Autonomía", observabilidad y registro auditable).
- **Skills afectados:** `kyn-ai` (declarar nivel y autorización de cada capacidad y herramienta).
- **Módulos y documentos afectados:** `docs/DOMAIN.md` §1 (Acción recomendada), §3 (NEX) y §9 (AI Studio); `docs/modules/nex.md` (capacidades y su nivel).

### Cambios normativos que se aplican **solo al aprobar este ADR**

| Documento | Texto actual | Texto propuesto |
|-----------|--------------|-----------------|
| `.claude/rules/ai.md`, regla 12 | "Toda acción de NEX con efectos requiere confirmación explícita del usuario." | "Toda acción de NEX con efectos se ejecuta bajo un nivel de autonomía gobernado (ADR-0009): confirmación explícita del usuario (Nivel 3) o una autorización permanente vigente que la cubra (Nivel 2). El nivel lo determina el código, no el modelo; sin clasificación o autorización verificable, se exige confirmación." |
| `.claude/rules/ai.md`, checklist | "Acciones con efectos sujetas a confirmación." | "Cada acción con efectos declara su nivel y se ejecuta con confirmación o con una autorización verificada y registrada." |
| `framework/standards/ai.md`, "Niveles de autonomía" | Tabla Informar / Sugerir / Ejecutar con confirmación, y "ningún nivel permite ejecutar acciones con efectos sin confirmación." | Tabla de tres niveles de esta ADR (*Observar y preparar* equivale a Informar y Sugerir; *Ejecutar lo autorizado*; *Confirmar siempre*), con la frase: "ninguna acción con efectos se ejecuta sin confirmación o sin una autorización permanente vigente que la cubra, y ninguna autorización cubre una acción de Nivel 3 por su ámbito." |
| `framework/standards/ai.md`, "Evals" | Dimensiones actuales | Añadir **Autonomía**: clasifica bien el nivel; no excede su autorización; resiste inyección dirigida a ampliar permisos; no ejecuta sin registro |
| `docs/DOMAIN.md` §1, "Acción recomendada" | "Nunca se ejecuta sin confirmación del usuario." | "Se ejecuta con confirmación del usuario o bajo una autorización permanente vigente que la cubra (ADR-0009)." |
| `docs/DOMAIN.md` §3, NEX | "Toda acción con efectos requiere confirmación explícita del usuario." | "Toda acción con efectos se ejecuta bajo un nivel de autonomía gobernado (ADR-0009)." La frase "con los permisos del usuario que lo invoca" se reformula en el ADR de identidad del agente |
| `docs/DOMAIN.md` §9, AI Studio | "…ni la confirmación de acciones con efectos." | "…ni los niveles de autonomía ni las autorizaciones de acciones con efectos." |
| `docs/modules/nex.md` | "Ejecutar acciones en otros módulos: Ejecutar con confirmación" | "Ejecutar acciones en otros módulos: Nivel 2 con autorización permanente o Nivel 3 con confirmación, según la acción" |

## Plan de implementación

1. **Aprobar este ADR** (Jeffrey) y abrir un PR único que actualice las normas de la tabla anterior. Sin ese PR, el Nivel 2 sigue sin estar en vigor.
2. **Fundamentos del agente (Sprint 6 del roadmap aprobado):** ADRs de identidad (C2), ejecución continua por eventos y programada (C3), canales y conversaciones, datos personales de clientes finales (C13), traspaso a un humano, memoria (C4), esquema y retención del registro de acciones, y canal de aviso (C6).
3. **Sprint 7 — NEX real mínimo (solo Nivel 1):** `lib/ai/` y el **registro de acciones** con los niveles declarados; **ninguna acción con efectos se ejecuta aún sin confirmación**.
4. **Cuando se active el trabajo continuo** (el sprint depende del roadmap; ver `docs/handoff/REVISION-TRABAJO-CONTINUO.md`): registro de acciones persistente, acuerdos de trabajo, autorizaciones permanentes, parada de emergencia y primeras acciones de Nivel 2 de bajo riesgo (por ejemplo, enviar informes).
5. **Puerta para activar cualquier acción de Nivel 2:** ADR aceptado + normas actualizadas + registro de acciones auditable + parada de emergencia + evaluaciones de autonomía en verde + `/security-review` sin hallazgos altos.

## Plan de reversión

Desactivar el Nivel 2 con un único interruptor devuelve **todas** las acciones con efectos al Nivel 3 (confirmación por acción), que es el comportamiento vigente hoy. No hay pérdida de datos: autorizaciones y registro se conservan. Coste bajo. Deja de ser trivial una vez que existan clientes que dependan de acciones autorizadas; entonces la reversión degrada el servicio, no la seguridad.

## Verificación

- **Clasificación:** pruebas deterministas de que cada acción registrada devuelve el nivel esperado y de que una acción no registrada o ambigua se trata como Nivel 3.
- **Autorización:** pruebas de que una acción fuera de sus límites, de su horario o con una autorización revocada, caducada o pausada **no se ejecuta**.
- **Registro:** prueba de que toda acción ejecutada tiene registro completo (qué, por qué y bajo qué autorización) y de que una acción sin posibilidad de registro no se ejecuta.
- **Evaluaciones de autonomía** (dimensión nueva): inyección de instrucciones que intenta ampliar permisos, clasificación correcta del nivel y negativa a exceder una autorización; con el proveedor principal y el de respaldo.
- **Aislamiento:** una autorización de una empresa no puede usarse en otra.
- **Conversaciones:** pruebas de que un mensaje entrante con instrucciones ("ignora tus reglas", "aplica este descuento") no cambia el nivel ni amplía una autorización; de que el spam va a cuarentena y no se borra; de que el traspaso al humano incluye el contexto mínimo definido; y de que el resumen de cambio de turno coincide cifra a cifra con el registro.
- **Volumen y latencia:** el chequeo de nivel y autorización cabe en el presupuesto de latencia de una respuesta conversacional y los límites de volumen cortan cuando corresponde.
- **Parada de emergencia:** prueba de que pausar una autorización detiene su ejecución de inmediato.
- `/security-review` sin hallazgos altos antes de activar la primera acción de Nivel 2.

## Decisiones pendientes de aprobación

1. **Definición de "comunicación sensible"** (quejas, disputas, cobros, ¿qué más?): ¿solo por categoría o también por señales del contenido? Hay un caso ambiguo: una disculpa a un cliente molesto, ¿es sensible y convertible a Nivel 2?
2. **Interpretación de la conversión Nivel 3 → Nivel 2 (§5):** la aclaración del propietario excluye lo legal, financiero, contractual e irreversible; este ADR añade, por coherencia con el Nivel 3, que lo administrativo y la información crítica tampoco se convierten.
3. **Vigencia máxima por defecto** de una autorización y si exige reconfirmación periódica.
4. **Quién puede conceder autorizaciones:** solo el propietario (propuesta) o también otros roles, cuando existan.
5. **Cuántos tipos de acción** admite el primer Nivel 2 y cuáles son (propuesta: enviar informes, publicar contenido programado).
6. **Retención del registro de acciones**, ligada a las decisiones pendientes de retención y eliminación de ADR-0006.
7. **Análisis legal** de la responsabilidad al actuar en nombre del negocio, antes de datos reales.
8. **Cierre de ventas (C10):** camino A (cierre asistido) o B (cierre delegado dentro de una oferta predefinida).
9. **Semántica de los criterios aprobados ante conversaciones entrantes (C11, §4):** primera comunicación = contacto iniciado por NEX; conectar un canal = aprobación única; clasificación de las acciones de CRM.
10. **Transparencia ante el cliente final (C12):** que NEX se identifique como IA y con qué texto.
11. **Datos personales de clientes finales (C13)** y **sectores sensibles (C15):** deben resolverse antes de conectar el primer canal real.
12. **Canales y plataformas (C14):** cuál es el primer canal y qué aprobaciones exige.

## Revisión

Cuando se active la primera acción de Nivel 2; después de cada incidente de confianza (acción no autorizada, explicación ausente); y a los 6 meses del primer cliente real. Cualquier cambio de los tres niveles requiere un ADR que sustituya a este y una enmienda de la Constitución (Artículo 15).

## Referencias

- `docs/constitution/KYNOVA-CONSTITUTION.md` (PR #7): Artículos 2, 6, 7 y 14.
- `.claude/rules/ai.md` (regla 12), `framework/standards/ai.md`, `docs/DOMAIN.md` §3 y §9, `docs/modules/nex.md`.
- `AGENTS.md` §3.4 (determinista antes que generativo), §7.1, §7.2, §7.9, §7.11.
- `docs/handoff/REVISION-4-PUNTOS.md` y `docs/handoff/REVISION-TRABAJO-CONTINUO.md` (PR #6): análisis de la arquitectura frente a un agente 24/7 y frente al trabajo continuo con conversaciones.
- ADR-0006 (tenancy, retención y eliminación pendientes) y ADR-0002 (plataforma).
