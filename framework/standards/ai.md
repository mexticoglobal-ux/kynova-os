# Estándar: IA

> Fuente normativa: `.claude/rules/ai.md`. Este documento solo añade lo que la regla no cubre; no la repite.

## Selección de modelos
1. Elegir el modelo más pequeño que supere los umbrales de evals de la capacidad.
2. Cada entrada del registro de modelos declara: proveedor, identificador, capacidades, límite de contexto, coste, latencia esperada y modelo de respaldo.
3. Cambiar el modelo de una capacidad exige ejecutar sus evals con el modelo nuevo.

## Versionado de prompts
1. Cada prompt tiene identificador estable y versión SemVer.
2. MAJOR: cambia el contrato de entrada o salida. MINOR: cambia el comportamiento. PATCH: corrección de redacción sin cambio de comportamiento.
3. La versión de prompt en uso queda registrada en cada llamada.

## Evals
| Dimensión | Mide |
|-----------|------|
| Exactitud | Corrección de la respuesta frente al resultado esperado |
| Formato | Cumplimiento del contrato de salida |
| Seguridad | Resistencia a inyección de instrucciones y a mezcla entre tenants |
| Fidelidad | Ausencia de afirmaciones no respaldadas por los datos del tenant |
| Coste y latencia | Tokens y tiempo dentro del presupuesto |

Cada capacidad define umbrales mínimos por dimensión; un cambio que baja de umbral no se publica.

## Niveles de autonomía de NEX
| Nivel | Comportamiento |
|-------|----------------|
| Informar | Analiza y responde; sin acciones |
| Sugerir | Propone acciones que el usuario ejecuta |
| Ejecutar con confirmación | Ejecuta tras confirmación explícita por acción |

Toda capacidad declara su nivel; ningún nivel permite ejecutar acciones con efectos sin confirmación.

## Coste
1. El presupuesto por tenant de `.claude/rules/ai.md` se fija según el plan y se desglosa por capacidad.
2. Alertas al alcanzar umbrales de consumo; corte controlado al superar el presupuesto.
3. Caché, recorte de contexto y modelos más pequeños antes que aumentar presupuesto.

## Observabilidad
Además de los campos que exige `.claude/rules/ai.md`, cada llamada registra capacidad, versión de prompt,
proveedor, tokens separados por entrada y salida, y resultado de validación.

## Preparación Enterprise
1. Proveedores intercambiables por tenant según requisitos contractuales o de residencia.
2. Posibilidad de excluir datos de un tenant de cualquier uso fuera de su propia sesión.
3. Registro auditable de acciones ejecutadas por NEX.
