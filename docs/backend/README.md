# Backend Core v1: cómo se pone en marcha

> Implementa ADR-0010 (propuesto, arquitectura congelada). Fecha: 2026-11-06. **Solo datos ficticios** y proyectos de desarrollo o Preview (ADR-0006): nada de esto está aprobado para datos reales.

## 1. Base de datos (proyecto de desarrollo)

Las migraciones están en `supabase/migrations/` y se aplican **en orden**, a un proyecto **desechable**, con aprobación (`AGENTS.md` §7.11). No uses `db push` sin aprobar el entorno.

| Orden | Archivo | Contenido |
|------:|---------|-----------|
| 1–2 | `20261031…`, `20261102…` | Tenancy base (ya aplicadas en el proyecto de desarrollo) |
| 3 | `20261106000100_backend_foundations.sql` | Roles (owner, admin, member, viewer), funciones auxiliares, particiones mensuales, `action_log` y `audit_log` de solo anexar |
| 4 | `20261106000200_crm_core.sql` | Organizaciones, contactos, identidades, leads, oportunidades, clientes, conversaciones, evaluaciones, paquetes |
| 5 | `20261106000300_messaging_and_governance.sql` | Mensajes (particionados), integraciones, aprobaciones, consentimientos, invitaciones |
| 6 | `20261106000400_business_functions.sql` | Funciones de negocio (empresa, equipo, prospectos, conversión, clientes, panel) |

**Ajustes en Supabase (Authentication), a cargo de quien administra el proyecto:**
- Permitir registro por correo (`Enable email signups`). La pantalla `/login` crea la cuenta en el primer ingreso.
- La plantilla del correo de acceso debe incluir el código: `{{ .Token }}`.
- El correo integrado de Supabase solo entrega a miembros del equipo: para personas externas hace falta un **SMTP propio** (límite ya documentado en `docs/supabase-spike/RESULTADO.md`).

Variables (ya existentes): `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`. **Sin ellas la aplicación arranca en modo demostración**, con datos ficticios en memoria y sin inicio de sesión.

## 2. Verificación

| Qué | Cómo |
|-----|------|
| SQL (aislamiento, roles, flujo comercial, solo anexar, ingesta, borrado de empresa) | `supabase/tests/backend_core.sql` e `isolation.sql`. Corren en CI (`rls-isolation.yml`, Postgres 16 efímero) |
| Aplicación | `npm run check` |

La prueba SQL no usa Supabase: sustituye `auth` con `00_bootstrap.sql`. Una corrida en verde es evidencia sobre el SQL, no sobre el proyecto de Supabase.

## 3. Roles

| Permiso | owner | admin | member | viewer |
|---------|:-----:|:-----:|:------:|:------:|
| Ver los datos de la empresa | sí | sí | sí | sí |
| Trabajar prospectos, clientes y conversaciones | sí | sí | sí | no |
| Aprobar lo que prepara NEX, gestionar el equipo, ver la empresa | sí | sí | no | no |
| Asignar administradores o propietarios, eliminar la empresa | sí | no | no | no |

Lo decide la base de datos (RLS y funciones). La interfaz solo oculta lo que no se puede hacer.

## 4. API (`/api/v1`)

Todas verifican la sesión con el servidor de autenticación, exigen origen propio en escrituras y responden sin caché. El tenant lo valida la base: si el usuario no pertenece, responde 403.

| Ruta | Para qué |
|------|----------|
| `GET /me` | Usuario, perfil y empresas; acepta invitaciones pendientes |
| `POST /companies`, `PATCH/DELETE /companies/{id}` | Crear, renombrar y eliminar (con el nombre escrito) |
| `GET/POST /team`, `PATCH/DELETE /team/{userId}`, `DELETE /invitations/{id}` | Equipo e invitaciones |
| `POST /prospects` | Guarda una conversación guiada completa. **El puntaje se recalcula en el servidor** |
| `GET /leads`, `PATCH /leads/{id}/status`, `POST /leads/{id}/win` | Pipeline y conversión de prospecto a cliente |
| `POST /approvals/{id}` | Aprobar o rechazar lo que NEX preparó |
| `GET/POST /clients`, `PATCH /clients/{id}` | Clientes (archivar, nunca borrar) |
| `GET/POST /conversations`, `DELETE /conversations/{id}`, `GET/POST …/messages` | Historial privado de NEX |
| `GET/POST /assessments` | Business Audit guardados |
| `GET /dashboard`, `GET /activity` | Panel con cifras reales y registro de actividad |
| `POST /inbound/{provider}` | **Puerta para futuras integraciones**: responde 501 mientras no exista el adaptador |

Interfaces para canales y pagos (sin implementar): `lib/integrations/types.ts`.

## 5. Límites conocidos

- Verificado: SQL en un Postgres efímero, y la aplicación con pruebas automáticas. **No verificado contra un proyecto real de Supabase** desde esta sesión.
- El primer contacto saliente aprobado queda **registrado y en cola**; ningún canal está conectado, así que nada sale de la plataforma.
- La región, la retención y el análisis legal siguen pendientes (ADR-0006, ADR-0010 P1, P2 y P6).
- Las pantallas nuevas están solo en español.
