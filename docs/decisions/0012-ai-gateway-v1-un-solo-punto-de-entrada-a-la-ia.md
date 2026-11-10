# ADR-0012: Toda llamada a IA pasa por un solo Gateway de KOE que decide proveedor, modelo y Worker

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-08 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | ia · koe · plataforma · costos · privacidad |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
Hoy KOE ya tiene un registro de modelos neutral y un enrutador por Worker (`koe-registry.ts`, `koe-engine.ts`), y `AGENTS.md` §7.2 exige que toda llamada a modelos pase por `lib/ai/` y AI Gateway. Falta el punto único que decida, para cualquier módulo, qué proveedor, qué modelo y qué Worker atienden una solicitud, con qué política de la empresa, con qué protecciones y a qué costo, y que lo deje registrado. Sin él, cada módulo acabaría eligiendo su propio modelo. El Backend Core (ADR-0011) ya fijó el entorno, los secretos, el Event Bus y la auditoría; el Gateway se apoya en ellos sin conectarlos todavía.

## Problema
¿Cómo se construye el Gateway de IA de modo que ningún módulo, ni NEX, pueda elegir una IA, sin conectar todavía ningún proveedor real?

## Criterios de decisión
- Ningún módulo nombra un proveedor o un modelo; todo pasa por KOE.
- Cada empresa elige su política, sus modelos permitidos, su presupuesto y sus límites, aislados por empresa.
- Si un proveedor falla, KOE elige otro automáticamente y deja el motivo.
- La privacidad de los datos es una regla dura, no una preferencia.
- Verificable con pruebas, sin red, sin credenciales y sin dependencias nuevas.
- No modificar los módulos existentes.

## Opciones consideradas

### Opción A: Cada módulo llama a su proveedor a través de un adaptador compartido
- **Ventajas:** poco código nuevo.
- **Inconvenientes:** el módulo decide el modelo; costos, políticas y privacidad quedan repartidos; el fallback se repite.
- **Coste y esfuerzo:** bajo ahora, alto al migrar.

### Opción B: Un Gateway de KOE con un solo evento de entrada que recibe un propósito, nunca un modelo
- **Ventajas:** una sola fuente de verdad para el enrutamiento, las protecciones y las métricas; los módulos solo piden un propósito; los proveedores reales se enchufan después detrás de la misma decisión.
- **Inconvenientes:** hay que mantener un catálogo de propósitos; el enrutador del motor de Workers convivirá con el del Gateway hasta que el motor delegue en él.
- **Coste y esfuerzo:** medio.

## Decisión
**Opción B**, como contratos y simulación en `lib/contracts/platform/`:
- `gateway-catalog.ts`: los ocho proveedores (todos simulados), el registro de modelos (nombre interno, etiqueta visible, capacidades, costo, contexto, velocidad, calidad, privacidad), las cinco políticas (Costo, Calidad, Velocidad, Privacidad, Equilibrada), los límites por defecto y sus techos, las capas del prompt, los propósitos y la arquitectura de la caché. Es el único archivo que nombra proveedores.
- `koe-gateway.ts`: el motor puro: pipeline del prompt, datos personales, moderación, enrutador, reintentos, cortacircuitos, adaptadores simulados, veredicto de caché y métricas.
- `gateway-center.ts`: el estado por empresa y el reductor. La única entrada es el evento `gateway.request`, que **no tiene campo de proveedor, modelo ni Worker**.
- `gateway-messages.ts`: los textos.

Reglas que quedan fijadas y probadas:
- Un llamador pide un **propósito**; el Gateway decide proveedor, modelo, Worker, costo estimado, prioridad y política. NEX consulta a KOE igual que cualquiera.
- Solo una persona de la empresa cambia su configuración; NEX, un Worker o el sistema no. Los incidentes simulados de un proveedor solo los inicia la plataforma.
- Los datos de empresa o personales solo van a modelos que no entrenan con ellos; bajo Privacidad primero, los personales solo a modelos locales.
- El fallback elige **otro proveedor**, reintenta solo fallas temporales y siempre registra el motivo. El cortacircuitos es por empresa y proveedor.
- El registro de cada llamada guarda decisión, conteos, latencia, costo y un hash; **nunca el texto del prompt ni datos personales**. Solo crece.
- La caché es solo arquitectura (por empresa, nunca con datos personales); no guarda nada.
- Ningún módulo importa todavía el Gateway, y no hay llamadas reales, claves ni dependencias nuevas.

## Consecuencias
- **Positivas:** un solo lugar donde se decide, se protege y se mide la IA; los proveedores reales se conectarán detrás de una decisión ya probada; cada empresa controla costo y privacidad.
- **Negativas:** hasta conectarlo, parte de lo construido no lo usa nadie; hay dos enrutadores (el del motor de Workers y el del Gateway) hasta que el motor delegue en el Gateway, lo que requerirá su propia decisión.
- **Riesgos y mitigaciones:** que un módulo nombre un modelo (mitigado con las pruebas que lo impiden en todo el código); que el catálogo envejezca (es un dato, no código); que el costo estimado difiera del real (se declara como estimación).

## Referencias
ADR-0009 (autonomía por niveles), ADR-0011 (Backend Core), `AGENTS.md` §7.2, `docs/platform/README.md` §22.
