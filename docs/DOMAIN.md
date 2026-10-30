# DOMAIN — KYNOVA OS

> Fuente única del lenguaje de negocio. Todo código, contrato, prompt y documento usa estos términos.
> Cambiar una definición estructural (Tenant, Workspace, Rol) requiere ADR.
> Contiene los conceptos transversales; las entidades propias de cada módulo se definen en `docs/modules/`.

## 1. Conceptos del negocio

| Concepto | Definición |
|----------|------------|
| **Usuario** | Persona con acceso autenticado a KYNOVA OS. Pertenece a uno o más tenants. |
| **Rol** | Conjunto de permisos que un usuario tiene dentro de un tenant o workspace. Determina qué puede ver y hacer. |
| **Plan** | Nivel de suscripción del tenant: Starter, Professional, Business o Enterprise. Define capacidades y límites de uso. |
| **Módulo** | Área funcional de negocio con sus propias pantallas, lógica y contratos. Se comunica con otros módulos solo mediante contratos. |
| **Lead** | Contacto potencial aún no convertido en cliente. |
| **Cliente** | Persona u organización con relación comercial activa o pasada con un tenant. |
| **Propiedad** | Activo inmobiliario gestionado por un tenant dentro del módulo Properties. |
| **Business Health Score** | Puntuación de 0 a 100 que resume el estado del negocio del tenant a partir de sus áreas funcionales. |
| **Acción recomendada** | Sugerencia priorizada que NEX genera a partir de los datos del tenant. Nunca se ejecuta sin confirmación del usuario. |
| **Business Assessment** | Autodiagnóstico guiado por NEX sobre la situación del negocio. La v0 usa 6 preguntas cerradas, vive solo en memoria durante la sesión y no crea ni actualiza ningún perfil de empresa. |

## 2. KYNOVA

| Término | Definición |
|---------|------------|
| **KYNOVA** | Marca y empresa que desarrolla y opera la plataforma. |
| **KYNOVA OS** | Sistema operativo de negocio con IA: plataforma SaaS multi-tenant que integra ventas, marketing, clientes, finanzas, automatización y analítica bajo una inteligencia común. |
| **KAF** | KYNOVA AI Framework: framework de ingeniería con el que se construye KYNOVA OS. No forma parte del producto. |

## 3. NEX

Asistente de IA de KYNOVA OS y núcleo de inteligencia del producto.
- Analiza los datos del tenant, responde preguntas, genera recomendaciones y ejecuta acciones autorizadas.
- Opera siempre dentro del tenant y con los permisos del usuario que lo invoca.
- Toda acción con efectos requiere confirmación explícita del usuario.
- Accede a modelos solo a través de la capa de IA de la plataforma.

## 4. Tenant

Organización cliente que contrata KYNOVA OS.
- Es la unidad de aislamiento de datos, facturación, plan y límites de uso.
- Todo dato de negocio pertenece a exactamente un tenant.
- Ningún usuario, proceso ni capacidad de NEX accede a datos de un tenant distinto al suyo.

## 5. Workspace

Espacio operativo dentro de un tenant (marca, sede o unidad de negocio).
- Un tenant tiene uno o más workspaces.
- Agrupa datos, configuración y usuarios de una parte del negocio.
- Los permisos pueden asignarse por workspace; el aislamiento de seguridad se garantiza por tenant.

## 6. CRM

Capacidad de gestión de relaciones comerciales del tenant.
- Cubre leads, clientes, oportunidades, interacciones y seguimiento.
- Se materializa en los módulos Sales y Clients.
- Es la fuente principal de datos comerciales para NEX y Analytics.

## 7. Marketplace

Catálogo de extensiones instalables por tenant.
- Incluye integraciones con servicios externos, plantillas, automatizaciones y capacidades de IA.
- Cada extensión declara los permisos y datos que necesita; el tenant los aprueba al instalarla.

## 8. Academy

Área de formación de KYNOVA OS.
- Ofrece contenidos, guías y certificaciones para que los usuarios aprovechen la plataforma.
- El progreso de aprendizaje pertenece al usuario dentro de su tenant.

## 9. AI Studio

Espacio donde el tenant configura y personaliza las capacidades de NEX.
- Permite ajustar conocimiento del negocio, tono, herramientas habilitadas y automatizaciones con IA.
- Opera dentro de los límites del plan y de las políticas de seguridad de la plataforma.
- No permite eludir el aislamiento entre tenants ni la confirmación de acciones con efectos.

## 10. Finance

Módulo de gestión financiera del tenant.
- Cubre ingresos, gastos, facturación, flujo de caja y previsiones.
- Alimenta el Business Health Score y las recomendaciones financieras de NEX.

## 11. Marketing

Módulo de captación y crecimiento del tenant.
- Cubre campañas, canales, contenidos, audiencias y rendimiento.
- Genera leads que se integran en el CRM.

## 12. Automation

Módulo de automatización de procesos del tenant.
- Define flujos que reaccionan a eventos o se ejecutan de forma programada.
- Puede incluir pasos con IA; las acciones con efectos externos requieren autorización previa del tenant.
- Todas las ejecuciones quedan registradas y son auditables.
