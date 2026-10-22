# ADR 032 · Company Integrations Framework

**Estado**: aceptada (Entrega 15).

## Contexto
Los AI Employees y el CEO AI necesitan saber si pueden trabajar con datos reales de Google, Meta, Shopify, etc. Sin una fuente única, cada módulo lo supondría por su cuenta y acabaría inventando datos.

## Decisión
1. `platform/integrations` define contratos, estados, capacidades y configuración no secreta. No llama a ninguna API y no depende de ningún sistema de negocio; la dirección de dependencia es siempre hacia el framework.
2. Un conector sin adaptador es «Disponible próximamente» y no se puede configurar. Nunca se asume «Conectada».
3. Estado por empresa en `ci_integrations` (una fila por `tenant_id` y conector, sin DELETE). Solo se guarda una referencia a una futura bóveda de secretos, jamás el secreto.
4. Los demás sistemas leen un mapa `conector → estado` y usan `requirements()` / `employeeCheck()`; informan qué falta en lugar de inventar.
5. Company Health es una función pura de reglas con pesos y umbrales fijos; un área que no aplica se excluye y se explica. La composición que reúne Perfil, Blueprint, Equipo IA e integraciones vive en `src/composition/`, no en el framework.
6. Reutilizamos el módulo `integrations` (misma ruta y mismos roles). La tabla nueva se añade a su pantalla sin tocar el Integrations Hub. API bajo `/api/v1/company-integrations`.
7. Nuevas plataformas = una definición más en el catálogo; sin cambios en el Core.

## Escala (10.000 empresas)
Una fila por empresa y conector con clave primaria `(tenant_id, connector)`; consultas acotadas por tenant; sin estado global ni trabajos programados; Health se calcula bajo demanda. No requiere rediseño.

## Consecuencias
Hoy ningún conector puede quedar conectado: el Health de integraciones «no aplica» y se explica así. Cuando exista un adaptador, solo se marca `available: true` y se llama a `report()`.
