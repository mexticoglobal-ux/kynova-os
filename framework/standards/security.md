# Estándar: Seguridad

> Fuente normativa: `.claude/rules/security.md` y `AGENTS.md` §7. Este documento solo añade lo que no cubren; no los repite.

## Clasificación de datos
| Nivel | Contenido | Tratamiento |
|-------|-----------|-------------|
| Público | Contenido de marketing y documentación pública | Sin restricciones |
| Interno | Configuración no sensible y métricas agregadas | Solo usuarios autenticados de KYNOVA |
| Confidencial | Datos de negocio de un tenant | Aislado por tenant; acceso por rol |
| Restringido | Credenciales, datos personales sensibles, datos financieros y de pago | Cifrado, mínimo acceso, auditado y nunca enviado a IA sin necesidad |

Toda entidad nueva declara su nivel en `docs/modules/<módulo>.md`.

## Modelado de amenazas
1. Toda tarea L con banderas de seguridad o datos incluye un análisis de amenazas en su brief.
2. El análisis cubre: suplantación, manipulación, repudio, divulgación, denegación de servicio y elevación de privilegios.
3. Cada amenaza identificada tiene mitigación o riesgo aceptado registrado.

## Identidad y acceso
1. Autenticación robusta con soporte de segundo factor.
2. Sesiones con caducidad y revocación.
3. Roles por tenant con mínimo privilegio; los permisos se revisan periódicamente.
4. Accesos administrativos internos registrados y limitados en el tiempo.

## Secretos
1. Rotación periódica y rotación inmediata ante sospecha de exposición.
2. Un secreto por entorno; nunca compartido entre preview y producción.

## Auditoría
1. Registro inmutable de acciones sensibles: quién, qué, cuándo, tenant y resultado.
2. Retención de auditoría definida por plan y por requisitos legales.

## Vulnerabilidades
1. Escaneo de dependencias en CI.
2. Corrección de vulnerabilidades críticas de forma inmediata y altas en el siguiente ciclo.

## Preparación Enterprise
1. Cumplimiento de protección de datos: exportación y eliminación de datos por tenant y por persona.
2. Controles alineados con marcos de certificación de seguridad estándar del sector.
3. Inicio de sesión único para tenants Enterprise.
4. Registro de auditoría exportable por tenant.
