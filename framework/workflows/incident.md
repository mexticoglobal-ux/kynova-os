# Workflow: Incident

> Base: `AGENTS.md` §4, workflow W4. Prioridad: restablecer el servicio, después corregir, después aprender.

## Propósito
Contener y resolver fallos en producción minimizando el impacto sobre los tenants.

## Cuándo aplica
Cualquier fallo en producción con impacto activo o riesgo inminente sobre usuarios, datos, seguridad o coste.

## Severidad

| Nivel | Criterio | Respuesta |
|-------|----------|-----------|
| SEV1 | Caída total, pérdida o exposición de datos, brecha de seguridad o fuga entre tenants | Inmediata; todo lo demás se detiene |
| SEV2 | Funcionalidad crítica degradada para muchos tenants o coste de IA descontrolado | Prioritaria |
| SEV3 | Funcionalidad no crítica degradada o impacto limitado | Planificada |

## Pasos

### 1. Detectar y clasificar
1. Registrar hora de inicio, síntoma, alcance y tenants afectados.
2. Asignar severidad.

### 2. Contener
1. Elegir la acción de menor riesgo que detenga el impacto: revertir la versión, desactivar la funcionalidad o limitar el tráfico.
2. Ante sospecha de exposición de datos o de secretos: rotar credenciales y bloquear el acceso afectado.
3. Toda acción en producción sigue `AGENTS.md` §7.11.

### 3. Diagnosticar
1. Reproducir fuera de producción.
2. Identificar la causa raíz con evidencia de logs, métricas y cambios recientes.

### 4. Corregir
1. Fix mínimo en una rama dedicada con prueba de regresión.
2. Verificación de `AGENTS.md` §7.9 en verde; `/code-review` y `/security-review` siempre, sea cual sea el tamaño.
3. Desplegar con aprobación siguiendo `release.md`.
4. Verificar que el síntoma desaparece y las métricas se normalizan.

### 5. Cerrar y aprender
1. Registrar el incidente en `docs/STATE.md`: severidad, duración, impacto, causa raíz y acciones.
2. En SEV1 y SEV2, postmortem sin culpables con: cronología, causa raíz, qué funcionó, qué falló y acciones preventivas.
3. Convertir las acciones preventivas en tareas, reglas, hooks o ADRs.

## Definición de terminado
Servicio restablecido, causa raíz identificada y corregida, prueba de regresión en verde, incidente registrado
y acciones preventivas asignadas.

## Salida
Registro del incidente, corrección desplegada, postmortem en SEV1 y SEV2, y acciones preventivas.
