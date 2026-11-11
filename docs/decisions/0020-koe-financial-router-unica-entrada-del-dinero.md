# ADR-0020: KOE Financial Router, la única entrada de todo movimiento de dinero

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-11 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | pagos · router · proveedores · idempotencia · multiempresa · auditoría |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
Billing, Marketplace y Partners necesitan mover dinero (cobros, reembolsos, pagos, créditos). Hoy cada uno decide por su cuenta o solo simula. Igual que el AI Gateway es el único punto hacia los modelos (ADR-0012), hace falta **un único punto hacia los proveedores de pago**: Billing → KOE Financial Router → Proveedor de Pago. Es arquitectura: ningún proveedor se conecta todavía, y KOE, NEX, AI Gateway, Runtime y Backend Core no cambian.

## Decisión
1. **`lib/contracts/platform/financial-router.ts`** (`reduceRouter`): reductor puro, determinista y multiempresa. Solo depende de contratos de la plataforma (`Money`, estados de pago y tasas de `payments.ts`/`currency.ts`); no importa nada de IA.
2. **Diez operaciones:** cobro de membresía, cobro de Marketplace, renovación, suscripción, cambio de plan, pago a partner, reembolso, crédito, comisión y factura. Las tres últimas más el crédito se asientan en el libro sin proveedor.
3. **Siete adaptadores con una sola interfaz** (`PaymentAdapter`): MakaPay, PayPal, Payoneer, Stripe, Apple Pay, Google Pay y Osmo. Todos `connected: false`; `execute` responde `notConnected`. Cada uno declara operaciones, monedas, métodos, precio y perfil. **Los precios y perfiles son valores de referencia a verificar**: ningún contrato real los respalda aún.
4. **Decisión automática:** `routeCandidates` filtra por operación, moneda, método y proveedores permitidos por la empresa y ordena según su política (costo, fiabilidad, velocidad o balanceada, con la fiabilidad observada en su propio historial). Una persona puede indicar un proveedor preferido; si falla, hay respaldo.
5. **Reintentos, tiempos, cortacircuitos y respaldo:** espera y reintento solo ante límite de tasa o tiempo agotado; una caída pasa directo al siguiente proveedor; el cortacircuitos se abre tras fallos repetidos y se prueba otra vez pasado el enfriamiento. **Un reembolso vuelve solo al proveedor que cobró, sin respaldo.** La simulación (incidentes, latencias) no sale del proceso.
6. **Idempotencia:** una operación por clave y empresa. Repetir la misma petición devuelve la misma operación; la misma clave con otro contenido se rechaza.
7. **Solo personas deciden el dinero (Nivel 3):** una persona puede pedir un cobro; NEX y el sistema solo lo preparan hasta que una persona lo aprueba. Pagos, reembolsos y créditos exigen **otra persona** distinta de quien los pidió.
8. **Monedas:** se liquida en la moneda de la operación; convertir exige que la empresa lo autorice y cargue una tasa, y queda registrado. La criptomoneda se representa pero no se liquida.
9. **Estados:** los de Payments (`pending`, `succeeded`, `failed`, `refunded`, `partiallyRefunded`, `disputed`) más los del flujo (espera de aprobación, aprobada, rechazada); los avisos del proveedor siguen la máquina de estados existente.
10. **Costos, historial y observabilidad:** comisión y neto por operación; `routerHistory` y `routerMetrics` (por estado, proveedor, comisiones y volumen por moneda, respaldos, reintentos, latencia); `routerObservations` entrega eventos y contadores como datos.
11. **Auditoría y Event Bus:** cada evento aceptado deja una entrada en `audit` con la forma que el conector del Backend Core ya lee; la prueba lo demuestra con el `Connector` existente.
12. **RLS:** `ROUTER_TABLES` declara las 6 tablas futuras (por empresa; intentos, créditos y auditoría de solo agregar), validadas con `auditPolicies`. No hay migración.
13. **Entradas de los módulos:** `chargeFromInvoice` (Billing), `chargeFromPurchase` (Marketplace) y `payoutFromPartner` (Partners) construyen la petición; `billingPaymentFromOperation` devuelve a Billing el `payment.record` de un cobro terminado. Billing sigue siendo quien lo registra, con su propia regla.

## Consecuencias
- **Pendiente con aprobación propia:** (a) registrar el puente en `lib/backend/integration/bridges.ts` (Backend Core) para que el Router corra por el Event Bus en producción; (b) la migración con RLS; (c) conectar cada proveedor, uno por decisión, con su contrato y claves por Wrangler; (d) que Billing y Partners invoquen el Router en lugar de registrar a mano; (e) cifras reales de comisiones.
- **Límites:** simulado de punta a punta; las tasas de cambio las aporta la empresa; no hay conciliación con extractos reales ni 3-D Secure/PCI (los datos de tarjeta nunca pasan por la plataforma).

## Referencias
ADR-0009, ADR-0012, ADR-0014, ADR-0019, `lib/contracts/platform/financial-router.test.ts`.
