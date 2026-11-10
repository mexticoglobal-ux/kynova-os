# ADR-0012: Toda llamada a IA pasa por KOE, el AI Cost Optimizer y el AI Gateway, cada uno con su responsabilidad

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto (revisado el 2026-11-10, Sprint 27.1; aún no aceptado) |
| **Fecha** | 2026-11-08 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | ia · koe · plataforma · costos · privacidad |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
`AGENTS.md` §7.2 exige que toda llamada a modelos pase por `lib/ai/` y AI Gateway. KOE ya tiene un registro de modelos neutral y un enrutador por Worker (`koe-registry.ts`, `koe-engine.ts`), y el Backend Core (ADR-0011) fijó el entorno, los secretos, el Event Bus y la auditoría. Falta decidir **quién decide qué** en una llamada a IA. La primera versión de este ADR (Sprint 27) puso todo en un solo Gateway que elegía Worker, política, modelo y proveedor a la vez. Eso mezcla responsabilidades: KOE terminaría conociendo proveedores y el Gateway terminaría conociendo Workers.

## Problema
¿Cómo se reparte la decisión para que ningún módulo ni NEX elija una IA, KOE no conozca proveedores, el Gateway no conozca Workers y el costo se optimice en un solo lugar, sin conectar todavía ningún proveedor real?

## Criterios de decisión
- Cada paso decide lo suyo y no conoce lo del siguiente.
- La decisión de KOE no puede contener proveedor ni modelo.
- La privacidad de los datos es una regla dura, no una preferencia.
- Cada empresa elige su política, sus modelos permitidos, su presupuesto y sus límites, aislados por empresa.
- Verificable con pruebas, sin red, sin credenciales y sin dependencias nuevas.
- No cambiar el comportamiento ni modificar los módulos existentes.

## Opciones consideradas

### Opción A: Un solo Gateway que decide Worker, política, modelo y proveedor
- **Ventajas:** poco código; es lo construido en el Sprint 27.
- **Inconvenientes:** el Gateway conoce Workers y políticas; KOE y el Gateway se acoplan; cambiar cómo se optimiza el costo obliga a tocar la ejecución.
- **Coste y esfuerzo:** bajo, pero el acoplamiento crece con cada proveedor.

### Opción B: Tres pasos: KOE decide, el AI Cost Optimizer recomienda, el AI Gateway ejecuta
- **Ventajas:** cada paso tiene un contrato estrecho; se puede probar y reemplazar por separado; el Optimizer podrá aprender del rendimiento real sin tocar a KOE ni al Gateway.
- **Inconvenientes:** más archivos y un contrato más (`AIDecision`); el Gateway recibe la lista ordenada de modelos que el Optimizer recomendó en lugar de elegirla.
- **Coste y esfuerzo:** medio; es una reorganización de lo ya construido, sin cambio de comportamiento.

## Decisión
**Opción B**, como contratos y simulación en `lib/contracts/platform/`. El flujo oficial es:

```
Módulo → KOE → AI Cost Optimizer → AI Gateway → Proveedor IA
```

- **KOE** (`koe-ai*.ts`) decide solo el Worker, la especialidad, la prioridad y la política, y lo expresa en el contrato compartido **`AIDecision`** (`ai-decision.ts`): Worker, especialidad, política, prioridad, presupuesto restante, nivel de privacidad y tiempo máximo. **Nunca** lleva proveedor ni modelo; cualquier campo extra se rechaza. KOE también arma el prompt por capas, aplica los datos personales, la moderación y los límites de la empresa, y guarda su propio registro (sin el texto).
- El **AI Cost Optimizer** (`ai-cost-optimizer.ts`) recibe política, especialidad, presupuesto, prioridad y modelos permitidos (más el tamaño del trabajo, nunca el texto) y devuelve el modelo recomendado, el costo estimado, el nivel de confianza (alto, medio o bajo) y el motivo, junto con los siguientes mejores modelos como respaldo. No conoce prompts, Workers ni proveedores. Trabaja sobre el registro de modelos (`ai-model-registry.ts`), cuyos perfiles **no llevan proveedor**.
- El **AI Gateway** (`gateway-*.ts`) recibe de KOE una solicitud estrecha (la lista ordenada de modelos, la prioridad, el tiempo máximo, los tamaños y los límites de reintento y cortacircuito) y decide solo el proveedor, el modelo dentro de esa lista, el fallback, los reintentos, el tiempo máximo y la observabilidad. No conoce Workers, especialidades ni políticas. Solo acepta llamadas de KOE. Su catálogo es el único archivo que nombra proveedores y mapea cada modelo a uno.
- **`ModelPerformance`** (`ai-model-performance.ts`) queda declarado para uso futuro (especialidad, modelo, porcentaje de éxito, costo, latencia y calidad promedio); no se registra ni se lee todavía.
- `ai-observability.ts` une, solo para lectura, el registro de KOE con lo que observó el Gateway.

Reglas que quedan fijadas y probadas:
- KOE no nombra ni importa proveedores ni el registro de modelos; el Gateway no nombra Workers, especialidades, políticas ni presupuestos y no importa nada de KOE ni del Optimizer; el Optimizer no conoce prompts, Workers ni proveedores; el flujo va en un solo sentido.
- Un llamador pide un **propósito**; ni NEX ni un módulo eligen modelo, proveedor o Worker. Solo una persona de la empresa cambia su configuración.
- El presupuesto no quita modelos al Optimizer: este dice si la recomendación cabe y KOE decide. La prioridad solo desempata.
- Los datos de empresa o personales solo van a modelos que no entrenan con ellos; bajo Privacidad primero, los personales solo a modelos locales.
- El fallback elige otro proveedor y siempre registra el motivo; el cortacircuitos es por empresa y proveedor.
- Ningún registro guarda el texto del prompt ni datos personales; los registros solo crecen.
- La caché y `ModelPerformance` son arquitectura: no guardan ni leen nada.
- El comportamiento no cambió: una tabla de modelos por propósito y política, capturada con la versión anterior, y los escenarios de fallback lo verifican.
- Ningún módulo importa todavía esta cadena; sin llamadas reales, claves ni dependencias nuevas.

## Consecuencias
- **Positivas:** cada paso se puede probar y reemplazar por separado; el costo se optimiza en un solo lugar; los proveedores reales se conectarán detrás del Gateway sin tocar a KOE; el Optimizer podrá usar `ModelPerformance` sin cambiar a los demás.
- **Negativas:** hasta conectarla, parte de lo construido no lo usa nadie; el motor de Workers (`koe-engine.ts`) conserva su propio enrutador de modelos y conviven los dos hasta que delegue en esta cadena, lo que requerirá su propia decisión. Las llaves opacas (`requestId`, `cacheScope`, ids de modelos permitidos) circulan por KOE sin que este las interprete.
- **Riesgos y mitigaciones:** que un módulo nombre un modelo o un proveedor (las pruebas lo impiden en todo el código); que el catálogo envejezca (es un dato, no código); que el costo estimado difiera del real (se declara como estimación).

## Referencias
ADR-0009 (autonomía por niveles), ADR-0011 (Backend Core), `AGENTS.md` §7.2, `docs/platform/README.md` §22.
