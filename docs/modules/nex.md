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
| Hacer un autodiagnóstico guiado del negocio (Business Assessment v0) | Ampliación |

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
| Autodiagnóstico (v0) | Respuestas a 6 preguntas cerradas y su resumen con 2–3 módulos recomendados por reglas | Confidencial | Solo en memoria durante la sesión; no se guarda |

## Reglas de negocio
1. Toda respuesta basada en datos indica de qué datos procede.
2. Si NEX no tiene datos suficientes, lo dice; no inventa.
3. Una acción propuesta caduca si los datos en que se basa cambian antes de confirmarla.
4. Las conversaciones solo son visibles para su autor.
5. El autodiagnóstico v0 recomienda módulos con reglas deterministas basadas solo en las respuestas del usuario, indica las respuestas que realmente justifican cada recomendación (máximo 3 módulos; el tercero solo con evidencia suficiente; el sector Inmobiliario siempre incluye Propiedades; los empates se resuelven de forma determinista sin favorecer el orden del menú), avisa de que los módulos enlazados pueden contener datos de demostración, muestra "Autodiagnóstico orientativo · no se guarda" y no persiste nada. Guardar o reutilizar sus resultados requiere ADR de datos y tenancy.

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
