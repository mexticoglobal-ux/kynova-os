# ADR-0013: El Runtime de Agentes IA es un bucle acotado que maneja los motores existentes, sin duplicarlos

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-10 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | ia · agentes · koe · plataforma · seguridad |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
Ya existen dos motores: el de **Workers** de KOE (`koe-engine.ts`: instancias por empresa, herramientas con nivel de autonomía, aprobaciones, memoria, delegación e interruptores de parada) y la **cadena de IA** (ADR-0012: KOE → AI Cost Optimizer → AI Gateway). Lo que falta es lo que convierte a un Worker en un *agente*: un bucle que recorre un plan de varios pasos, pide ayuda a la IA, usa herramientas, espera a una persona cuando corresponde, reintenta lo temporal, se detiene a tiempo y deja una traza. Ese bucle debe existir antes de conectar IA reales, sin modificar KOE ni el Gateway.

## Problema
¿Cómo se construye el runtime de agentes sin duplicar las reglas que ya viven en el motor de Workers y en la cadena de IA, y sin que un agente pueda hacer más de lo que su Worker puede?

## Criterios de decisión
- Un agente nunca puede más que su Worker: herramientas, nivel de datos, memoria y niveles de autonomía vienen del motor existente.
- No modificar KOE ni el AI Gateway; el runtime solo los llama.
- Acotado: pasos, llamadas a la IA, presupuesto, tiempo y repeticiones tienen tope.
- Una persona inicia, aprueba y puede cancelar o tomar el control; NEX y los Workers solo preparan.
- Aislado por empresa, solo arquitectura y simulación, sin dependencias nuevas.

## Opciones consideradas

### Opción A: Un motor de agentes nuevo, con sus propias herramientas, memoria y aprobaciones
- **Ventajas:** libertad de diseño.
- **Inconvenientes:** duplica la Constitución de NEX en dos lugares; dos conjuntos de interruptores de parada y de aprobaciones; deriva con el tiempo.
- **Coste y esfuerzo:** alto, con riesgo de inconsistencias.

### Opción B: Un runtime que maneja los dos motores existentes mediante sus eventos públicos
- **Ventajas:** una sola fuente de verdad para niveles, aprobaciones, memoria y paradas; el agente hereda todo lo ya probado; la IA sigue pasando por KOE.
- **Inconvenientes:** el runtime depende de los eventos de esos motores; el plan es una lista de pasos, no un razonamiento libre (el "cerebro" real llegará después).
- **Coste y esfuerzo:** medio.

## Decisión
**Opción B**, como contratos y simulación en `lib/contracts/platform/`:
- `agent-catalog.ts`: los **planes** (`Playbook`), datos que listan pasos (pedir a la IA un *propósito*, usar una herramienta, recordar, cerrar), los límites de una sesión con sus techos y los motivos de parada. Un plan nuevo es una entrada nueva.
- `agent-runtime.ts`: las reglas puras: validar un plan contra el Worker que lo ejecuta, previsualizar qué pasos esperarán a una persona, los límites (tiempo, pasos, presupuesto, repeticiones), el reintento con espera creciente, la traza y las métricas.
- `agent-center.ts`: el estado por empresa y el reductor (`reduceAgent`). Una **sesión** es un plan en marcha; cada paso se ejecuta llamando a los motores existentes: herramientas, memoria, aprobaciones y cierre, al motor de Workers; un pensamiento, a la solicitud de IA de KOE (`ai.request`).
- `agent-messages.ts`: los textos.

Reglas que quedan fijadas y probadas:
- Un agente es un Worker de KOE: solo usa sus herramientas, con el nivel que fija el catálogo de autonomía (nunca el plan ni el agente). Una acción de Nivel 3 (dinero o efecto fuera de la plataforma) espera a una persona y nada después de ella corre; un rechazo termina la sesión y no se reintenta ni se rodea.
- Una persona (o la plataforma) inicia una sesión; solo una persona aprueba, cancela o toma el control de una sesión escalada. NEX y los Workers no. Quien inició un cobro no lo aprueba.
- Cada sesión está acotada: pasos, llamadas a la IA, presupuesto, tiempo y pasos repetidos. Una falla temporal se reintenta unas veces con espera creciente y luego pasa a una persona; un rechazo del motor o de la IA que no se arregla reintentando escala de inmediato.
- Los interruptores de parada de KOE (empresa, plataforma, Worker en pausa o deshabilitado) ganan sobre todo y se revisan antes de cualquier límite.
- El runtime pide la IA solo a KOE: no importa el AI Cost Optimizer, el Gateway ni el registro de modelos, y no nombra modelos ni proveedores. KOE no guarda el texto del prompt.
- Todo está aislado por empresa; los registros solo crecen; no se modifica KOE ni el Gateway, ningún módulo existente lo importa y no hay dependencias, llamadas reales ni pantallas nuevas.

## Consecuencias
- **Positivas:** los agentes heredan la Constitución y las paradas ya probadas; cambiar cómo se elige la IA no toca al runtime; los planes son datos que una empresa podrá escribir después.
- **Negativas:** hoy el "cerebro" es un plan fijo; razonar y replanificar con un modelo real requerirá su propia decisión. La delegación entre agentes (traspaso) existe en el motor de Workers pero el runtime aún no la orquesta. Hasta conectarlo, nadie lo usa.
- **Riesgos y mitigaciones:** que un plan pida más de lo que el Worker puede (se valida al iniciar); que un bucle gaste sin control (topes de pasos, presupuesto, tiempo y repeticiones); que el runtime y el motor se desalineen (el runtime solo usa sus eventos públicos y las pruebas recorren planes completos).

## Referencias
ADR-0009 (autonomía por niveles), ADR-0012 (cadena de IA), `docs/platform/README.md` §11 y §23.
