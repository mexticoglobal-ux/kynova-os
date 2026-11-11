# ADR-0019: Programa de Partners con comisiones recurrentes calculadas sobre lo que Billing cobró

| Campo | Valor |
|-------|-------|
| **Estado** | Propuesto |
| **Fecha** | 2026-11-10 |
| **Decisores** | Jeffrey Hernandez |
| **Etiquetas** | partners · referidos · comisiones · multiempresa · auditoría |
| **Sustituye a** | — |
| **Sustituido por** | — |

## Contexto
El Centro de Referidos (ADR anterior, Sprint 8) es un programa de afiliados genérico con comisión única por venta. KYNOVA necesita su programa oficial de Partners: personas o empresas que traen clientes y ganan una **comisión mensual recurrente** sobre la membresía que cada cliente paga, con niveles, ventana de validación y retiro mínimo. Sin modificar KOE, NEX, Gateway, Runtime ni Backend Core, y sin conectar ningún medio de pago.

## Decisión
1. **Un reductor propio y puro** (`lib/contracts/platform/partners.ts`, `reducePartners`), multiempresa: todo registro lleva `tenantId` de la empresa que corre el programa y todo evento se valida contra esa empresa. Reutiliza `makeCode`, `linkFor`, `normalizeEmail` (Referidos), `fraudSignals`, la regla de «solo personas» (`actors.ts`) y los pagos de Billing. No se tocó el Centro de Referidos.
2. **Niveles:** Registered 7 %, Silver 9 %, Gold 12 %. Platinum, Diamond y Elite están en el catálogo con `locked: true` y sin porcentaje: ningún evento puede asignarlos; la plataforma los definirá y activará después.
3. **Base de cálculo = lo pagado.** La comisión se calcula sobre el pago real de la membresía (`membershipEventsFromBilling` lee Billing, nunca lo modifica) con el porcentaje del partner **ese día**; un cambio de nivel posterior no reescribe comisiones.
4. **Recurrente mientras el cliente esté activo:** una comisión por cada factura pagada, nunca dos por la misma. Si el cliente deja de pagar, queda **pausado** y no genera comisión hasta que vuelva a pagar; al cancelar, termina.
5. **Cambio de plan:** la comisión del período ya pagado se **recalcula** (en el lugar mientras valida; como ajuste positivo o negativo después) y las siguientes salen del nuevo monto.
6. **Ventana de validación de 15 días:** reembolso, fraude o contracargo dentro de la ventana la anulan; después, quedan como ajuste negativo que se recupera del siguiente pago. Solo lo validado entra al saldo.
7. **Retiro:** mínimo USD 100 acumulados. Nivel 3: una persona solicita, **otra distinta** aprueba y una tercera, distinta de ambas, lo registra como pagado con una referencia externa. NEX y el sistema nunca.
8. **Medios de pago:** MakaPay, Payoneer, PayPal, Stripe y Osmo solo existen como interfaz (`PayoutRailAdapter`, `connected: false`); el reductor los rechaza. `manual` (transferencia fuera de la plataforma) es el único utilizable.
9. **Auditoría y Event Bus:** cada evento aceptado deja una entrada en `audit`, con la forma que el conector del Backend Core ya lee. La prueba lo envuelve con `Connector` y comprueba eventos por empresa, auditoría central y cobertura, **sin cambiar el Backend Core**.
10. **RLS:** `PARTNER_TABLES` declara las 8 tablas futuras (por empresa; clics, ajustes y auditoría de solo agregar); una prueba las pasa por `auditPolicies` de la plataforma. **No se escribió ni aplicó ninguna migración.**
11. **Panel del partner:** `partnerDashboard` (estado, nivel, código, enlace, embudo, clientes con su estado, comisiones, saldo, pagos) y `programSummary` son lecturas; no hay pantalla nueva.

## Consecuencias
- **Pendiente con aprobación propia:** (a) registrar el puente en `lib/backend/integration/bridges.ts` (una entrada) para que el reductor corra por el Event Bus en producción, además de actualizar la guarda de `integration.test.ts`; hoy la prueba lo demuestra con el mismo `Connector`. (b) la migración con RLS (kyn-data, ADR y aprobación de producción). (c) el punto público `/r/{código}` con protección anti-abuso. (d) conectar un medio de pago, con su propia decisión.
- **Límites:** porcentajes de los niveles superiores, criterios de ascenso y moneda única (USD) quedan por definir; el cierre por contracargo pausa al cliente hasta que vuelva a pagar; los datos reales de clientes siguen bloqueados por ADR-0006.

## Referencias
ADR-0009 (niveles de autonomía), ADR-0014 (integración con el Backend Core), ADR-0017/0018, `lib/contracts/platform/partners.test.ts`.
