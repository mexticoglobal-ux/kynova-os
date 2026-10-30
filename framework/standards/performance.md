# Estándar: Rendimiento

> Fuente normativa: este documento. Aplica a interfaz, API, datos e IA.

## Objetivos de experiencia (percentil 75, móvil)
| Métrica | Objetivo |
|---------|----------|
| Largest Contentful Paint | ≤ 2,5 s |
| Interaction to Next Paint | ≤ 200 ms |
| Cumulative Layout Shift | ≤ 0,1 |
| Time to First Byte | ≤ 600 ms |

## Presupuestos de interfaz
1. JavaScript inicial por ruta: ≤ 200 KB comprimido.
2. Renderizado en servidor por defecto; JavaScript de cliente solo donde hay interacción.
3. Componentes pesados y no críticos cargados de forma diferida.
4. Imágenes optimizadas, dimensionadas y con carga diferida fuera de la primera vista.
5. Fuentes autoalojadas, en subconjunto y sin bloquear el renderizado.

## Presupuestos de API y datos (percentil 95)
| Operación | Objetivo |
|-----------|----------|
| Lectura | ≤ 300 ms |
| Escritura | ≤ 500 ms |
| Consulta individual a base de datos | ≤ 100 ms |

1. Paginación obligatoria y tamaños de página acotados.
2. Caché en el borde para contenido público; caché por tenant para datos de lectura frecuente con invalidación explícita.
3. Trabajo que excede el presupuesto se ejecuta fuera de la petición.

## Presupuestos de IA
| Métrica | Objetivo |
|---------|----------|
| Tiempo hasta el primer token | ≤ 1,5 s |
| Respuesta completa estándar | ≤ 10 s |

1. Streaming en respuestas largas.
2. Contexto mínimo necesario por llamada.
3. Caché del gateway para peticiones deterministas sin datos privados.

## Medición
1. Métricas reales de usuario en producción y métricas de laboratorio en CI.
2. Una regresión que supera un presupuesto bloquea la release o se registra como deuda aprobada.
3. Los presupuestos se revisan al cambiar de plan de escalado.
