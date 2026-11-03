# Módulo: {{Nombre}}

| Campo | Valor |
|-------|-------|
| **Estado** | {{planificado · en construcción · activo · deprecado}} |
| **Responsable** | {{Persona o equipo}} |
| **Ruta** | `app/{{módulo}}/` |
| **Lógica** | `lib/modules/{{módulo}}/` |
| **Contratos** | `lib/contracts/{{módulo}}/` |
| **Última actualización** | {{AAAA-MM-DD}} |

## Objetivo
{{Valor de negocio que aporta el módulo al tenant.}}

## Casos de uso
| Caso de uso | Actor | Estado |
|-------------|-------|--------|
| {{…}} | {{Rol}} | {{planificado · activo}} |

## Fuera de alcance
- {{…}}

## Entidades
| Entidad | Propietario | Clasificación | Alcance | Borrado | Retención |
|---------|-------------|---------------|---------|---------|-----------|
| {{…}} | Este módulo | {{Público · Interno · Confidencial · Restringido}} | {{tenant · workspace}} | {{lógico · físico}} | {{…}} |

## Contratos
| Contrato | Tipo | Consumidores |
|----------|------|--------------|
| {{…}} | {{entrada · salida · evento}} | {{…}} |

## API
| Método | Ruta | Propósito | Roles |
|--------|------|-----------|-------|
| {{…}} | {{…}} | {{…}} | {{…}} |

## Permisos por rol
| Rol | Ver | Crear | Editar | Borrar |
|-----|-----|-------|--------|--------|
| {{…}} | {{sí · no}} | {{sí · no}} | {{sí · no}} | {{sí · no}} |

## Capacidades de NEX
| Capacidad | Nivel de autonomía | Prompt |
|-----------|--------------------|--------|
| {{…}} | {{Informar · Sugerir · Ejecutar con confirmación}} | {{identificador y versión}} |

## Dependencias
- **Consume de:** {{módulos y contratos}}
- **Consumido por:** {{módulos}}
- **Servicios externos:** {{… o "ninguno"}}

## Métricas
- {{Indicador de negocio o técnico que mide el éxito del módulo}}

## Decisiones
- {{ADRs relacionados}}

## Deuda
- {{… o "ninguna"; la deuda activa se registra también en `docs/STATE.md`}}
