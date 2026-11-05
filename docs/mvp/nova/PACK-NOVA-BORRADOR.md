# Paquete de Nova Marketing Studio — borrador

> **Nada de esto es información confirmada de Nova.** Una búsqueda pública no encontró información sobre Nova Marketing Studio, y el repositorio no contiene su oferta; el único dato es el nombre y que existe como empresa de prueba. Lo que sigue es una **estructura con hipótesis típicas de un estudio de marketing**, para que Nova la corrija en vez de redactarla desde cero.
> 🟡 = hipótesis que Nova debe confirmar o corregir · ⬜ = dato que solo Nova puede dar y que no se ha rellenado.
> Este paquete son **datos del cliente**, no código (ADR-0006): se cargará como una versión que Nova aprueba. Nada de él se usa con prospectos reales hasta esa aprobación.

## 1. Ficha

| Dato | Valor |
|------|-------|
| Nombre comercial | Nova Marketing Studio |
| País y zona horaria | 🟡 Costa Rica, `America/Costa_Rica` ⬜ confirmar |
| Idioma de atención | 🟡 Español |
| Tratamiento al visitante | 🟡 "usted" ⬜ Nova decide ("usted" o "tú") |
| Moneda para presupuestos y precios | ⬜ |
| Sitio web donde irá el chat | ⬜ |
| Persona que recibe los traspasos | ⬜ nombre y contacto |

## 2. Catálogo de servicios

Cada servicio declara qué brechas del audit resuelve (`addresses`) y para qué etapa encaja (`fitsInfrastructure`: sin infraestructura / parcial / establecida). Esa información alimenta la recomendación (`recommendServices`).

| id | Servicio 🟡 | Qué resuelve | Etapa en la que encaja | Entregables ⬜ | Plazo ⬜ | Precio ⬜ |
|----|-------------|--------------|------------------------|---------------|----------|----------|
| `strategy` | Estrategia y plan de marketing digital | `analytics`, `advertising`, `social` | sin, parcial, establecida | ⬜ | ⬜ | ⬜ |
| `social` | Gestión de redes sociales | `social`, `capture` | sin, parcial, establecida | ⬜ | ⬜ | ⬜ |
| `content` | Contenido: foto, video y diseño | `social` | sin, parcial, establecida | ⬜ | ⬜ | ⬜ |
| `ads` | Publicidad pagada (Meta, Google) | `advertising`, `capture`, `analytics` | parcial, establecida | ⬜ | ⬜ | ⬜ |
| `web` | Sitio web y páginas de aterrizaje | `web`, `capture` | sin, parcial | ⬜ | ⬜ | ⬜ |
| `seo` | Posicionamiento en buscadores (SEO) | `web`, `capture` | parcial, establecida | ⬜ | ⬜ | ⬜ |
| `branding` | Identidad de marca | `web`, `social` | sin | ⬜ | ⬜ | ⬜ |
| `crm` | CRM y automatización del seguimiento | `followUp`, `automation` | parcial, establecida | ⬜ | ⬜ | ⬜ |
| `reporting` | Analítica y reportes | `analytics` | parcial, establecida | ⬜ | ⬜ | ⬜ |
| `ai` | Implementación de IA y asistentes | `ai`, `automation` | establecida | ⬜ | ⬜ | ⬜ |

**Regla:** NEX no menciona precios, plazos ni resultados que Nova no haya aprobado por escrito en esta tabla.

## 3. Preguntas frecuentes

Las respuestas son de Nova. La estructura es una hipótesis; **ninguna respuesta está redactada**. Si una pregunta no tiene respuesta aprobada, el visitante se traspasa a una persona.

| # | Pregunta 🟡 | Respuesta aprobada |
|---|-------------|--------------------|
| 1 | ¿Qué servicios ofrecen? | ⬜ (resumen del catálogo) |
| 2 | ¿Cuánto cuesta? | ⬜ ¿hay precios publicados, rangos o solo cotización? |
| 3 | ¿Cómo es el proceso para empezar? | ⬜ |
| 4 | ¿Cuánto tarda en verse resultados? | ⬜ (sin prometer resultados) |
| 5 | ¿Trabajan con mi tipo de negocio? | ⬜ sectores atendidos y no atendidos |
| 6 | ¿Hay contrato o permanencia mínima? | ⬜ |
| 7 | ¿La inversión en anuncios está incluida? | ⬜ |
| 8 | ¿Cómo y cada cuánto recibo reportes? | ⬜ |
| 9 | ¿Atienden fuera de la zona o del país? | ⬜ |
| 10 | ¿Puedo ver trabajos o casos anteriores? | ⬜ enlaces autorizados |

## 4. Criterios de calificación

Reglas por defecto del motor, a ajustar por Nova. Puntos: presupuesto (desconocido 0, bajo 1, medio 2, alto 3), plazo (explorando 0, más adelante 1, pronto 2, ahora 3), rol de decisión (ninguno 0, influye 1, decide 2), contacto dejado (1). **Caliente desde 7, tibio desde 4**, sobre 9.

| Decisión de Nova | Valor |
|------------------|-------|
| Rangos de presupuesto mensual que significan bajo, medio y alto, en su moneda | ⬜ |
| Qué cuenta como "ahora", "pronto" y "más adelante" | ⬜ |
| Presupuesto mínimo por debajo del cual no conviene atender | ⬜ |
| Tipos de cliente que no atiende (por tamaño, sector o ubicación) | ⬜ |
| Umbrales de caliente y tibio | 🟡 7 y 4 ⬜ confirmar |

## 5. Horarios

| Dato | Valor |
|------|-------|
| Días y horas de atención humana | ⬜ |
| Tiempo máximo de respuesta humana a un traspaso | ⬜ |
| Qué se promete fuera de horario | 🟡 Respuesta en el siguiente horario de atención ⬜ confirmar |

El asistente automatizado está disponible a cualquier hora; el horario aplica a las personas de Nova.

## 6. Reglas de escalado al asesor humano

NEX traspasa a Nova **solo cuando aporta valor**, y siempre en estos casos 🟡 (Nova confirma):
1. El visitante pide hablar con una persona.
2. Prospecto **caliente**.
3. Una pregunta sin respuesta aprobada.
4. Queja, reclamo o cobro.
5. Cualquier tema legal, contractual o de precios personalizados.
6. El visitante dice ser cliente actual.
7. El sistema duda de su propia clasificación o de lo entendido.

| Decisión de Nova | Valor |
|------------------|-------|
| Canal por el que recibe los traspasos (bandeja de KYNOVA y aviso) | ⬜ |
| Qué más justifica un traspaso inmediato | ⬜ |

## 7. Mensajes comerciales iniciales (borrador, tratamiento "usted")

Se muestran tal cual; ninguno promete precios ni resultados. Los textos entre llaves se rellenan con los datos de Nova.

| Momento | Mensaje 🟡 |
|---------|------------|
| Presentación | "Hola, soy el asistente automatizado de Nova Marketing Studio. Puedo ayudarle a conocer sus opciones y preparar su consulta con nuestro equipo. {aviso de datos}" |
| Invitación al audit | "¿Le parece si le hago unas preguntas breves, de unos dos minutos, sobre cómo está su negocio en lo digital? Así el equipo de Nova le atiende con propuestas a su medida." |
| Transición a las preguntas | "Perfecto. Responda según su situación actual; no hay respuestas buenas ni malas." |
| Resultado | "Según lo que usted nos indicó, su negocio está en un nivel {banda} ({puntaje} de 100). Lo que más impacto tendría mejorar: {brecha 1}, {brecha 2} y {brecha 3}. Servicios de Nova que ayudan con eso: {servicios}." |
| Calificación | "Para que el equipo prepare una propuesta realista: ¿cuál es su presupuesto mensual aproximado, para cuándo desea empezar y qué rol tiene en la decisión?" |
| Contacto | "¿A qué nombre y por qué medio prefiere que le contactemos?" |
| Cierre, caliente | "Gracias, {nombre}. Ya compartí con el equipo de Nova lo que me indicó. {persona} le contactará {plazo}." |
| Cierre, tibio | "Gracias, {nombre}. Le dejo información útil y el equipo puede contactarle para una llamada. ¿Le parece que le escriban {medio}?" |
| Cierre, frío | "Gracias, {nombre}. Le comparto información que puede serle útil y quedamos atentos si desea retomar." |
| Fuera de horario | "Nuestro equipo atiende {horario}. Su consulta quedó registrada y le responderán en el siguiente horario de atención." |
| Sin respuesta aprobada | "Esa consulta necesita a una persona del equipo. ¿Me deja su contacto y se la traslado?" |
| Cliente actual | "Gracias por escribirnos. Aviso a su equipo de Nova para que le atiendan." |

## 8. Preguntas para validar con Nova

Con estas respuestas el paquete deja de ser un borrador:
1. ¿Qué servicios vende hoy y cuáles no? ¿Hay paquetes?
2. ¿Muestra precios, rangos o solo cotiza? ¿En qué moneda?
3. ¿A qué tipo de empresa quiere llegar (sector, tamaño, ubicación) y a cuáles no?
4. ¿Cuál es hoy su mayor cuello de botella para conseguir clientes?
5. ¿Por dónde le escriben los prospectos hoy y cuántos al mes?
6. ¿Cuánto tarda hoy en responder y quién lo hace?
7. ¿Qué preguntas le hacen siempre? Con sus respuestas exactas.
8. ¿Cómo califica hoy a un prospecto? ¿Qué es un buen cliente para Nova?
9. ¿Cuándo prefiere que una persona tome la conversación?
10. ¿Qué horario tiene su equipo y qué se promete fuera de él?
11. ¿Quién recibe los traspasos y por dónde le gustaría enterarse?
12. ¿"Usted" o "tú"? ¿Tono formal o cercano?
13. ¿Qué casos o trabajos puede mostrar y con qué autorización?
14. ¿Qué considera un éxito en las primeras semanas (por ejemplo, N prospectos preparados al mes)?
15. ¿Tiene sitio web donde insertar el chat y quién lo administra?
