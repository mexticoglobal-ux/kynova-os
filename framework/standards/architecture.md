# Estándar: Arquitectura

> Fuente normativa: `.claude/rules/architecture.md` y `AGENTS.md` §7. Este documento solo añade lo que no cubren; no los repite.

## Mapa de capas

| Capa | Ubicación | Responsabilidad | Puede depender de |
|------|-----------|-----------------|-------------------|
| Presentación | `app/`, `components/` | Rutas, páginas, componentes e interacción | Módulos, contratos |
| Módulos | `lib/modules/<módulo>/` | Casos de uso de negocio | Contratos, datos, IA |
| Contratos | `lib/contracts/` | Esquemas y tipos compartidos | Nada del proyecto |
| Datos | `lib/db/` | Acceso a Supabase y tipos generados | Contratos |
| IA | `lib/ai/` | Proveedores, registro de modelos, AI Gateway | Contratos |
| Configuración | `config/` | Configuración de aplicación | Nada del proyecto |
| Plataforma | `wrangler.jsonc`, `supabase/` | Infraestructura declarada | — |

## Disparadores de ADR
Requiere ADR cualquier cambio en:
1. Plataforma de ejecución, despliegue o región.
2. Modelo de tenancy, autenticación o autorización.
3. Motor de base de datos, almacenamiento o colas.
4. Proveedor de IA principal o estrategia de enrutado de modelos.
5. Patrón de módulo o mapa de capas.
6. Dependencias que condicionan la arquitectura.
7. Contratos públicos con consumidores externos.

## Principios de escalado
1. Operaciones idempotentes para permitir reintentos seguros.
2. Trabajo largo o diferible fuera de la petición del usuario.
3. Límites, cuotas y presupuestos por tenant en todos los recursos compartidos.
4. Todo componente externo detrás de una interfaz propia para poder sustituirlo.
5. Degradación controlada: un fallo de IA o de un servicio externo no tumba el módulo.

## Integraciones
1. Cada integración externa se implementa como un adaptador con contrato propio.
2. Credenciales por tenant cifradas y con mínimo privilegio.
3. Webhooks y eventos externos se validan, se registran y se procesan de forma idempotente.

## Evolución Enterprise
La arquitectura debe admitir sin rediseño:
1. Varias regiones y residencia de datos por tenant.
2. Personalización de marca y configuración por tenant.
3. Extensiones de Marketplace aisladas por permisos.
4. Auditoría completa de acciones por tenant.
5. Planes con límites diferenciados.
