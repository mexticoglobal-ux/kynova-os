# Módulo: Academy

| Estado | Área |
|--------|------|
| Planificado | Plataforma (`docs/DOMAIN.md` §8) |

## Objetivo
Acelerar la adopción de KYNOVA OS enseñando a cada usuario a sacar el máximo partido de la plataforma y de NEX.

## Actores
- Usuarios del tenant.
- Administradores que asignan formación.

## Casos de uso
| Caso de uso | Prioridad |
|-------------|-----------|
| Consultar cursos y guías por módulo y nivel | Núcleo |
| Seguir el propio progreso de aprendizaje | Núcleo |
| Recibir formación contextual según lo que el usuario está haciendo | Ampliación |
| Asignar formación a usuarios del tenant | Ampliación |
| Obtener certificaciones | Ampliación |

## Fuera de alcance
- Soporte técnico y resolución de incidencias.

## Entidades
| Entidad | Descripción | Clasificación | Alcance |
|---------|-------------|---------------|---------|
| Curso | Conjunto ordenado de lecciones sobre un tema | Público | Plataforma |
| Lección | Unidad de aprendizaje dentro de un curso | Público | Plataforma |
| Progreso | Avance de un usuario en un curso | Confidencial | Usuario dentro del tenant |
| Certificación | Reconocimiento obtenido al completar un itinerario | Confidencial | Usuario dentro del tenant |

## Reglas de negocio
1. El progreso pertenece al usuario y solo lo ven él y los administradores de su tenant.
2. El contenido de un curso refleja la versión vigente del producto.

## Capacidades de NEX
| Capacidad | Nivel |
|-----------|-------|
| Responder dudas de uso de la plataforma | Informar |
| Recomendar la siguiente lección | Sugerir |

## Dependencias
- **Consume de:** Settings.
- **Provee a:** NEX.

## Métricas
- Usuarios que completan la formación inicial.
- Relación entre formación completada y uso de módulos.

## Preguntas abiertas
- Idiomas del contenido.
- Disponibilidad de certificaciones por plan.
