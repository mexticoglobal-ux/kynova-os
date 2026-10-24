# Workflow: Release

> Base: paso de despliegue de `kyn-ship`. Todo paso que afecte a producción sigue `AGENTS.md` §7.11.

## Propósito
Publicar versiones del producto y del framework de forma predecible, verificada y reversible.

## Cuándo aplica
- Release del producto KYNOVA OS a preview o producción.
- Release del framework KAF.

## A. Release del producto

### 1. Preparación
1. Rama principal con la verificación de `AGENTS.md` §7.9 y los evals en verde.
2. Pull requests incluidos revisados y fusionados.
3. Determinar la versión SemVer del producto y actualizar `package.json`.
4. Redactar las notas de release: cambios, migraciones, riesgos y pasos de reversión.
5. Confirmar que existen las configuraciones y secretos requeridos en el entorno de destino.

### 2. Preview
1. Desplegar a preview.
2. Verificar los flujos críticos, las rutas nuevas y las capacidades de NEX afectadas.
3. Registrar el resultado de la verificación.

### 3. Aprobación
Aprobación explícita con: versión, notas de release, resultado de preview, migraciones y plan de reversión.

### 4. Producción
1. Aplicar solo las migraciones de expansión aprobadas.
2. Desplegar la aplicación.
3. Verificar salud, flujos críticos, errores, latencia y coste de IA.
4. Etiquetar la versión en git como `vX.Y.Z`.

### 5. Posterior
1. Planificar las migraciones de contracción en una release posterior.
2. Actualizar `docs/STATE.md` con la versión publicada y los pendientes.

### Reversión
- Ante degradación, volver a la versión anterior de la aplicación antes de investigar.
- Las migraciones de expansión son compatibles con la versión anterior; no se revierten salvo plan aprobado.
- Toda reversión en producción abre el workflow `incident.md`.

## B. Release del framework

1. Confirmar que `framework/REGISTRY.md` refleja todos los componentes y estados.
2. Mover las entradas de `[Unreleased]` a la nueva versión en `framework/CHANGELOG.md`.
3. Actualizar `framework/VERSION` según SemVer.
4. Crear el pull request con `framework/templates/pr.md`.
5. Tras fusionar, etiquetar en git como `kaf-vX.Y.Z`.

## Definición de terminado
Producto: versión desplegada y verificada en producción, etiqueta creada, notas publicadas y memoria actualizada.
Framework: catálogo, changelog y versión coherentes, pull request fusionado y etiqueta creada.

## Salida
Versión etiquetada, notas de release, resultado de verificación y estado actualizado en `docs/STATE.md`.
