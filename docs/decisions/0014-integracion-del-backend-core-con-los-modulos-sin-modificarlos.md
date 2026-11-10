# ADR-0014: El Backend Core se conecta a los módulos envolviendo sus reductores, sin modificarlos

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-10 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | plataforma · datos · tenancy · observabilidad · seguridad |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
El Backend Core (ADR-0011) quedó como contratos y utilidades que **nadie usaba**: un Event Bus que solo registra, una auditoría central, observabilidad, contratos de datos con RLS preparado, Storage y un Secrets Manager. Desde entonces se construyeron la cadena de IA (ADR-0012: KOE, AI Cost Optimizer y AI Gateway) y el runtime de agentes (ADR-0013), y los módulos de la plataforma siguen guardando su historia en sus propios registros de auditoría y de logs. Falta unir ambas mitades sin tocar ni los módulos ni KOE, NEX, el Gateway o el runtime, y sin conectar nada real.

## Problema
¿Cómo se conecta todo lo construido con el Backend Core de modo que cada hecho de cada módulo pase por el Event Bus y la auditoría central, se mida y se trace, y siga aislado por empresa, sin modificar ningún módulo y todavía en simulación?

## Criterios de decisión
- No modificar los módulos, KOE, NEX, el AI Gateway ni el runtime.
- La conexión va en un solo sentido: el Backend Core lee a los módulos; ningún módulo importa el Backend Core.
- Todo lleva `tenant_id`; una empresa nunca ve ni recibe lo de otra.
- Verificable: se puede probar que todo lo auditado pasó por el bus.
- Nada real: ni red, ni proveedor, ni datos reales; Supabase solo preparado.

## Opciones consideradas

### Opción A: Cada módulo publica por su cuenta al Event Bus
- **Ventajas:** el evento nace donde ocurre.
- **Inconvenientes:** obliga a modificar todos los módulos y a que cada uno conozca el Backend Core; una omisión deja un hueco silencioso.
- **Coste y esfuerzo:** alto y repartido.

### Opción B: Un conector que envuelve el reductor de cada módulo y lee sus registros que solo crecen
- **Ventajas:** los módulos no cambian; todo pasa por un solo lugar; la cobertura se puede verificar; el mismo conector sirve a los módulos que se creen después.
- **Inconvenientes:** depende de que cada módulo registre lo que hace en su traza (ya lo hacen todos); los eventos de dominio más ricos se derivan del estado, no de un aviso del módulo.
- **Coste y esfuerzo:** medio.

## Decisión
**Opción B**, en `lib/backend/integration/` (el Backend Core importa a los módulos; ningún módulo importa nada de ahí):
- `connector.ts`: el **conector**. Ejecuta el reductor del módulo **exactamente como es** y después lee lo que el módulo añadió a sus trazas. Cada entrada nueva se publica en el Event Bus (id determinista, bajo su empresa) y se registra en la auditoría central encadenada; cada intento rechazado también queda auditado. La llamada se cuenta, se mide y se traza, y **un solo id de traza** une el span, los eventos y los registros de auditoría. Sin empresa, la llamada se rechaza antes de tocar el módulo; una entrada de otra empresa dentro de una llamada nunca se publica.
- `bridges.ts`: **catorce puentes** (Workers, IA de KOE, AI Gateway, runtime de agentes, automatizaciones, Marketplace, Academy, CRM, Billing, Insights, Developer Platform, Communications, Organización y AI Studio). Un puente solo dice dónde guarda cada módulo sus trazas y cómo leer la empresa, el actor y el tipo de un evento. Pagos y referidos quedan declarados como no conectados: su libro no tiene una traza por empresa.
- **Telemetría de dominio**, derivada de los estados y nunca de los textos: cada llamada del AI Gateway deja el evento `koe.ai.call.recorded`, sus métricas y un span hijo con la duración que simuló; cada sesión de agente que cambia de estado deja `workers.session.changed`.
- `persistence.ts`: **Supabase preparado, sin datos reales**. Las filas siguen el contrato de datos de `platform_events`, `audit_log` y `storage_objects`. Una base simulada en memoria responde hoy; el adaptador de Supabase es perezoso, filtra cada lectura por empresa, solo inserta, no tiene actualizar ni borrar y **no escribe nada** mientras el entorno no admita datos reales (ninguno lo admite todavía).
- `archive.ts`: **Storage y Secrets Manager por contratos**. El archivo de la auditoría de una empresa se cifra con su llave (leída solo por nombre y propósito, ligada al id de la empresa), se valida contra las reglas del espacio, se guarda bajo la carpeta de la empresa y se registra en `storage_objects`. Nunca se devuelve ni se registra el contenido.
- `health.ts`, `coverage.ts`: **salud y cobertura**. Siete comprobaciones nuevas (bus, cadena de auditoría, cobertura del bus, aislamiento entre empresas, módulos conectados, persistencia, archivos y acceso a secretos), cada una también como métrica; y la prueba de que todo lo auditado tiene su evento.

Reglas que quedan fijadas y probadas:
- El reductor de cada módulo se llama tal cual: el resultado con y sin el conector es idéntico.
- Todo evento viaja por el Event Bus: cada centro de la plataforma está conectado o declarado, la historia de cada módulo se reenvía completa y la cobertura se verifica por empresa.
- Aislamiento total: eventos, auditoría, cadena de hashes, filas persistidas, archivos y sellos de cifrado son de cada empresa; las métricas no llevan empresa ni modelo; ni el bus ni la auditoría ni los logs llevan el texto de un prompt, una credencial o un dato personal.
- El conector solo publica: nadie se suscribe al bus todavía. Ningún módulo importa el Backend Core, y solo `bridges.ts` importa los centros de la cadena de IA y del runtime.
- Ninguna llamada de red, proveedor real, dato real, migración ni dependencia nueva. El RLS sigue preparado y sin activar.

## Consecuencias
- **Positivas:** toda la plataforma deja un rastro único, medible y verificable sin tocar un módulo; el día que se conecte Supabase solo hay que cambiar el adaptador de persistencia; KOE podrá leer el bus y la auditoría de cada empresa con `koeView`.
- **Negativas:** la integración vive en el Backend Core y hay que añadir un puente por cada módulo nuevo (una prueba lo exige); los eventos de dominio finos (por ejemplo, una factura emitida) aún no existen: hoy el módulo los comunica como entradas de su auditoría.
- **Riesgos y mitigaciones:** que un módulo deje de registrar algo en su traza (la cobertura lo detecta); que se publique algo de otra empresa (se cuenta como violación y la salud cae); que un día se active la escritura real sin pasar por su decisión (el adaptador la bloquea por política del entorno y una prueba lo comprueba).

## Referencias
ADR-0006 (persistencia y aislamiento), ADR-0011 (Backend Core), ADR-0012 (cadena de IA), ADR-0013 (runtime de agentes), `docs/platform/README.md` §21 y §25.
