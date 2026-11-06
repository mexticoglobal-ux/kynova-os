# Arquitectura del Pipeline Comercial (MVP Comercial 1.1)

> Estado: **implementado en modo demostración** (en memoria, sin persistencia). Fecha: 2026-11-05.
> Solo existe el chat web. Todo lo demás está **declarado, no implementado**.

## Una sola entrada para todos los canales

```
 Chat web ──┐
 WhatsApp ──┤   (planned)
 Facebook ──┤   (planned)
 Instagram ─┤   (planned)      ┌──────────────┐     ┌───────────────┐
 Correo ────┼──► Handoff ─────►│ leadFromHandoff │──►│ Pipeline (Lead) │──► Dashboard de NEX
 Formularios┘   (conversación) └──────────────┘     └───────────────┘     └► Pipeline en /sales
                                                            ▲
 Stripe · PayPal · MakaPay · MakaWallet · SINPE ── PaymentEvent ──┘   (planned, sin código)
```

- Un canal de conversación termina en un **`Handoff`** (lo que el equipo necesita para continuar: quién es, qué pidió, diagnóstico, calificación, motivo, siguiente paso). El chat guiado ya lo produce.
- **`leadFromHandoff`** (`lib/pipeline.ts`) es el único adaptador hacia el Pipeline. Un canal nuevo solo debe producir un `Handoff` (o un `LeadIntake`); el Pipeline, el Dashboard y el resumen ejecutivo no cambian.
- Los métodos de pago se declaran como **`PaymentEvent`** ligados a un lead (`lib/contracts/pipeline.ts`). Hoy nada los produce ni los consume; la etapa `won` está reservada para ellos.
- `CHANNEL_STATUS` dice qué existe: solo `webChat` es `demo`; los otros diez canales y métodos de pago son `planned`.

## Qué es real y qué es demostración

| Pieza | Estado |
|-------|--------|
| Motor del audit, Business Score, calificación, recomendación | Real (determinista, probado) |
| Chat guiado → Handoff → Lead → Pipeline → Dashboard | Real dentro de la sesión del navegador |
| Prospectos "de la noche" | Ficticios, generados con el mismo motor |
| Solicitud de reunión | Preparada por NEX y aprobada por el propietario; **no se envía a nadie** |
| Persistencia | No existe: al recargar vuelven los datos de ejemplo |
| Canales y pagos | Solo declarados |

## Reglas que se respetan

- Contactar por primera vez a un prospecto (la solicitud de reunión) **espera la aprobación** del propietario (Nivel 3 de la Constitución y del ADR-0009 propuesto).
- Ninguna cifra del Dashboard está escrita a mano: se calcula de los prospectos (`digest`).
- Nada se guarda ni sale de la pantalla (ADR-0006: sin datos reales de prospectos antes de sus puertas).

## Qué falta para que sea real

Persistencia con RLS por empresa y registro de acciones (ADR de conversaciones y datos de prospectos), un adaptador por canal, y los eventos de pago.
