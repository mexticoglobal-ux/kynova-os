# Estándar: Datos

> Fuente normativa: `.claude/rules/data.md`. Este documento solo añade lo que la regla no cubre; no la repite.

## Modelado
1. Las entidades y sus nombres siguen `docs/DOMAIN.md`.
2. Una entidad pertenece a un único módulo propietario; otros módulos la consumen mediante contratos.
3. Cuando aplica, las entidades incluyen `workspace_id` además de `tenant_id`.
4. Columnas de auditoría en entidades de negocio: creador y último modificador, además de los timestamps.
5. Los estados de negocio se modelan con valores cerrados, nunca con texto libre.
6. Importes monetarios con tipo decimal exacto y moneda explícita.
7. Fechas y horas siempre con zona horaria.

## Ciclo de vida
1. Cada entidad declara su política de borrado: lógico o físico.
2. Cada entidad declara su retención y su clasificación según `framework/standards/security.md`.
3. Exportación y eliminación completas por tenant y por persona.

## Migraciones
1. Nombre de migración descriptivo del cambio lógico.
2. Las migraciones de expansión son compatibles con la versión anterior de la aplicación.
3. Operaciones costosas sobre tablas grandes se ejecutan sin bloqueo prolongado.

## Consultas
1. Paginación obligatoria en todo listado.
2. Sin consultas en bucle; cargar relaciones en lote.
3. Selección explícita de columnas.
4. Consultas frecuentes respaldadas por índices verificados con el plan de ejecución.

## Continuidad
1. Copias de seguridad automáticas con recuperación a un punto en el tiempo en producción.
2. Restauración probada periódicamente.

## Preparación Enterprise
1. Residencia de datos por región según el tenant.
2. Analítica sobre réplicas o almacenes separados del tráfico transaccional.
3. Particionado preparado para tablas de alto volumen.
