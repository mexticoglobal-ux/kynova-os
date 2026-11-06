# Modelo entidad-relación (ER) — Conversaciones y datos de prospectos

> Parte de [ADR-0010](../decisions/0010-conversaciones-y-datos-de-prospectos.md). **Propuesto, sin código.** Fecha: 2026-11-06.
> Columnas, índices y políticas de cada tabla: [data-catalog.md](data-catalog.md). Los diagramas usan Mermaid (GitHub los dibuja).
> Convenciones: identificadores en inglés, `snake_case`; toda tabla de negocio lleva `tenant_id`; `workspace_id` es nulo y reservado.

## 1. Vista general por dominios

```mermaid
flowchart LR
  subgraph P[Plataforma]
    tenants --- memberships
    tenants --- business_profiles
    tenants --- user_profiles
  end
  subgraph C[CRM]
    organizations --- contacts
    contacts --- contact_identities
    contacts --- leads
    leads --- opportunities
    opportunities --- customers
    pipelines --- pipeline_stages
    activities
    tasks
  end
  subgraph V[Conversaciones]
    integration_accounts --- conversations
    conversations --- messages
    messages --- attachments
    inbound_events
    outbox_messages
  end
  subgraph A[Evaluación y paquetes]
    pack_versions
    assessment_runs
    handoffs
  end
  subgraph G[Gobierno y auditoría]
    approval_requests
    work_agreements --- authorizations
    action_log
    audit_log
    consent_records
    data_requests
  end
  subgraph M[Pagos - reservado]
    payments --- payment_events
  end
  tenants -. tenant_id en todas .-> C
  tenants -. tenant_id en todas .-> V
  tenants -. tenant_id en todas .-> A
  tenants -. tenant_id en todas .-> G
  tenants -. tenant_id en todas .-> M
```

## 2. Núcleo comercial: del prospecto al cliente

```mermaid
erDiagram
  TENANTS ||--o{ CONTACTS : "tiene"
  TENANTS ||--o{ ORGANIZATIONS : "tiene"
  ORGANIZATIONS ||--o{ CONTACTS : "agrupa"
  CONTACTS ||--o{ CONTACT_IDENTITIES : "se identifica por"
  CONTACTS ||--o{ LEADS : "genera"
  CONTACTS ||--o{ OPPORTUNITIES : "participa en"
  LEADS ||--o| OPPORTUNITIES : "se convierte en"
  PIPELINES ||--o{ PIPELINE_STAGES : "define"
  PIPELINES ||--o{ OPPORTUNITIES : "ordena"
  PIPELINE_STAGES ||--o{ OPPORTUNITIES : "etapa actual"
  OPPORTUNITIES ||--o{ OPPORTUNITY_STAGE_HISTORY : "registra"
  OPPORTUNITIES }o--o| CUSTOMERS : "al ganarse crea o amplía"
  CONTACTS ||--o{ CUSTOMERS : "puede ser"
  ORGANIZATIONS ||--o{ CUSTOMERS : "puede ser"
  CONTACTS ||--o{ ACTIVITIES : "historial"
  LEADS ||--o{ ACTIVITIES : "referencia opcional"
  OPPORTUNITIES ||--o{ ACTIVITIES : "referencia opcional"
  CONTACTS ||--o{ TASKS : "seguimientos"
  CONTACTS ||--o{ CONTACT_TAGS : "etiquetas"
  TAGS ||--o{ CONTACT_TAGS : "etiqueta"

  CONTACTS {
    uuid id PK
    uuid tenant_id FK
    uuid workspace_id "reservado"
    uuid organization_id FK
    text display_name
    text lifecycle_stage "prospect lead customer former"
    uuid merged_into_id FK
    timestamptz anonymized_at
  }
  CONTACT_IDENTITIES {
    uuid id PK
    uuid tenant_id FK
    uuid contact_id FK
    text kind "email phone whatsapp facebook instagram web_visitor payment_customer"
    text value_normalized
    timestamptz verified_at
  }
  LEADS {
    uuid id PK
    uuid tenant_id FK
    uuid contact_id FK
    text status "new working qualified disqualified converted spam"
    text grade "hot warm cold human"
    smallint points
    uuid assessment_run_id FK
    uuid pack_version_id FK
    timestamptz next_action_at
  }
  OPPORTUNITIES {
    uuid id PK
    uuid tenant_id FK
    uuid lead_id FK
    uuid contact_id FK
    uuid pipeline_id FK
    uuid stage_id FK
    bigint amount_minor
    char currency
    text status "open won lost"
    uuid owner_user_id
  }
  CUSTOMERS {
    uuid id PK
    uuid tenant_id FK
    uuid contact_id FK
    uuid organization_id FK
    text status "active inactive"
    date since
  }
```

## 3. Conversaciones y canales

```mermaid
erDiagram
  INTEGRATION_ACCOUNTS ||--o{ CONVERSATIONS : "recibe"
  CONTACTS ||--o{ CONVERSATIONS : "conversa"
  CONVERSATIONS ||--o{ MESSAGES : "contiene"
  MESSAGES ||--o{ ATTACHMENTS : "adjunta"
  CONVERSATIONS ||--o{ LEADS : "origina"
  INTEGRATION_ACCOUNTS ||--o{ INBOUND_EVENTS : "recibe crudos"
  INTEGRATION_ACCOUNTS ||--o{ OUTBOX_MESSAGES : "envía por"
  CONVERSATIONS ||--o{ OUTBOX_MESSAGES : "origina"
  APPROVAL_REQUESTS ||--o{ OUTBOX_MESSAGES : "autoriza"

  INTEGRATION_ACCOUNTS {
    uuid id PK
    uuid tenant_id FK
    text category "conversation payment"
    text provider "web_chat whatsapp facebook instagram email form stripe paypal makapay makawallet sinpe"
    text status "pending active paused error revoked"
    text secret_ref "puntero, nunca el secreto"
    text inbound_key_hash
  }
  CONVERSATIONS {
    uuid id PK
    uuid tenant_id FK
    uuid integration_account_id FK
    uuid contact_id FK
    text status "open waiting handed_off closed quarantined"
    text mode "guided human free"
    text external_thread_id
    timestamptz last_message_at
    timestamptz window_expires_at
  }
  MESSAGES {
    uuid id PK
    timestamptz created_at PK "clave de partición"
    uuid tenant_id
    uuid conversation_id
    text direction "in out system"
    text sender_kind "contact user nex system"
    text content_type
    text delivery_status
    text provider_message_id
  }
  INBOUND_EVENTS {
    uuid id PK
    timestamptz received_at PK "clave de partición"
    uuid integration_account_id FK
    text external_event_id
    boolean signature_valid
    jsonb payload
    text status
  }
  OUTBOX_MESSAGES {
    uuid id PK
    uuid tenant_id FK
    text idempotency_key "único"
    text status "pending sending sent failed cancelled"
    uuid approval_request_id FK
  }
```

## 4. Evaluación, paquetes, gobierno y auditoría

```mermaid
erDiagram
  CONTACTS ||--o{ ASSESSMENT_RUNS : "se evalúa"
  PACK_VERSIONS ||--o{ ASSESSMENT_RUNS : "reglas usadas"
  PACK_VERSIONS ||--o{ LEADS : "califica con"
  ASSESSMENT_RUNS ||--o| LEADS : "origina"
  LEADS ||--o{ HANDOFFS : "traspasa"
  LEADS ||--o{ APPROVAL_REQUESTS : "requiere"
  WORK_AGREEMENTS ||--o{ AUTHORIZATIONS : "agrupa"
  AUTHORIZATIONS ||--o{ ACTION_LOG : "ampara"
  APPROVAL_REQUESTS ||--o{ ACTION_LOG : "ampara"
  CONTACTS ||--o{ CONSENT_RECORDS : "otorga"
  CONTACTS ||--o{ DATA_REQUESTS : "solicita"
  CUSTOMERS ||--o{ PAYMENTS : "paga"
  OPPORTUNITIES ||--o{ PAYMENTS : "origina"
  PAYMENTS ||--o{ PAYMENT_EVENTS : "registra"

  PACK_VERSIONS {
    uuid id PK
    uuid tenant_id FK
    int version
    text status "draft approved retired"
    jsonb content "catálogo, FAQs, reglas, horario, mensajes"
    uuid approved_by
  }
  ASSESSMENT_RUNS {
    uuid id PK
    uuid tenant_id FK
    smallint engine_version
    jsonb answers
    smallint score
    jsonb result
  }
  APPROVAL_REQUESTS {
    uuid id PK
    uuid tenant_id FK
    text kind "meeting_request first_message opportunity customer_conversion payment_link"
    jsonb draft
    text status "pending approved rejected expired executed"
    uuid decided_by
  }
  ACTION_LOG {
    uuid id PK
    timestamptz occurred_at PK "clave de partición"
    uuid tenant_id
    text actor_type "user nex system integration"
    smallint level "1 2 3"
    text summary
    text reason
    uuid authorization_id
  }
  PAYMENTS {
    uuid id PK
    uuid tenant_id FK
    text provider
    text provider_payment_id
    bigint amount_minor
    char currency
    text status
  }
```

## 5. Reglas del modelo (resumen)

1. **Una sola identidad por persona** (`contacts`); prospecto, lead y cliente son **etapas y relaciones** de esa identidad, no tablas duplicadas.
2. **Toda referencia entre tablas de negocio es compuesta** `(tenant_id, id)`: la base impide que una fila apunte a otra empresa (ver [multitenancy.md](multitenancy.md)).
3. **Las tablas de mayor volumen** (`messages`, `inbound_events`, `action_log`, `audit_log`, `payment_events`) se **particionan por mes**; ninguna otra tabla se parte al inicio.
4. **Los hechos inmutables** (evaluaciones, traspasos, historial de etapas, consentimientos, registros de acción y auditoría, eventos de pago) **solo se insertan**.
5. **Ningún secreto en la base**: `integration_accounts.secret_ref` apunta a donde vive el secreto.
6. **Dinero** en unidades menores enteras (`bigint`) con moneda `char(3)`; nunca decimales ni flotantes.
