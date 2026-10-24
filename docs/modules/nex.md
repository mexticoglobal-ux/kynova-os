# Módulo: NEX

| Estado | Área |
|--------|------|
| Prototipo | Núcleo |

## Objetivo
Ofrecer al usuario un asistente que entiende su negocio, responde preguntas sobre sus datos y propone o ejecuta acciones autorizadas.
Definición del asistente: `docs/DOMAIN.md` §3.

## Actores
- Cualquier usuario del tenant, dentro de sus permisos.

## Casos de uso
| Caso de uso | Prioridad |
|-------------|-----------|
| Preguntar en lenguaje natural sobre los datos del negocio | Núcleo |
| Obtener resúmenes periódicos del negocio | Núcleo |
| Recibir recomendaciones con su justificación | Núcleo |
| Ejecutar una acción propuesta tras confirmarla | Ampliación |
| Retomar conversaciones anteriores | Ampliación |

## Fuera de alcance
- Configuración del comportamiento de NEX: corresponde a AI Studio.
- Acciones sobre datos a los que el usuario no tiene acceso.

## Entidades
| Entidad | Descripción | Clasificación | Alcance |
|---------|-------------|---------------|---------|
| Conversación | Intercambio de mensajes entre un usuario y NEX | Confidencial | Usuario dentro del tenant |
| Mensaje | Pregunta del usuario o respuesta de NEX | Confidencial | Usuario dentro del tenant |
| Capacidad | Tarea concreta que NEX sabe realizar, con su nivel de autonomía | Interno | Plataforma |
| Acción propuesta | Acción con efectos que NEX ofrece ejecutar y que requiere confirmación | Confidencial | Tenant |

## Reglas de negocio
1. Toda respuesta basada en datos indica de qué datos procede.
2. Si NEX no tiene datos suficientes, lo dice; no inventa.
3. Una acción propuesta caduca si los datos en que se basa cambian antes de confirmarla.
4. Las conversaciones solo son visibles para su autor.

## Capacidades de NEX
| Capacidad | Nivel |
|-----------|-------|
| Responder preguntas sobre el negocio | Informar |
| Resumir actividad de un periodo | Informar |
| Recomendar acciones | Sugerir |
| Ejecutar acciones en otros módulos | Ejecutar con confirmación |

## Dependencias
- **Consume de:** todos los módulos con datos, AI Studio.
- **Provee a:** Dashboard y todos los módulos.

## Métricas
- Preguntas respondidas con datos frente a respuestas sin datos.
- Valoración de utilidad de las respuestas por los usuarios.
- Acciones propuestas confirmadas.

## Preguntas abiertas
- Retención de conversaciones.
- Capacidades disponibles en cada plan.
