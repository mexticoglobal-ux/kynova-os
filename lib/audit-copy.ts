import type { AuditBand, AuditDimension, Infrastructure, MaturityLevel } from "@/lib/contracts/audit";

// Spanish copy of the Business Audit experience (questions, reactions, consultant summary).
// Pending: the other seven locales (known gap, same as the Creator Economy sample texts). Copy lives apart from lib/i18n
// until the audit copy is stable, so the dictionaries' shared shape test is not touched by an experiment.
// Wording is neutral wherever possible; only lead sentences vary by treatment ("usted" or "tú").

export type Treatment = "usted" | "tu";
export const TREATMENTS = ["usted", "tu"] as const satisfies readonly Treatment[];

export const pick = (treatment: Treatment, pair: readonly [string, string]) => (treatment === "usted" ? pair[0] : pair[1]);

export type DimensionCopy = {
  label: string;
  prompt: readonly [string, string];
  options: Record<MaturityLevel, string>;
  // NEX's short, human reaction to each answer: proof that it understood before moving on.
  reaction: Record<MaturityLevel, string>;
  // The consultant's view when this dimension is one of the biggest gaps.
  opportunity: { title: string; why: string; action: string };
  // What KYNOVA can prepare today (always as a draft) and what always waits for the owner's approval.
  automate: string;
  approval: string;
};

export const DIMENSION_COPY: Record<AuditDimension, DimensionCopy> = {
  web: {
    label: "Presencia web",
    prompt: ["¿Cómo describiría el sitio web de su negocio?", "¿Cómo describirías el sitio web de tu negocio?"],
    options: {
      none: "No tengo sitio web",
      adHoc: "Solo una página básica o mis redes",
      defined: "Tengo un sitio propio y actualizado",
      optimized: "Mi sitio está pensado para captar clientes y lo mido",
    },
    reaction: {
      none: "Sin sitio, quien busca el negocio no tiene dónde confirmar que existe. Es de las brechas más rápidas de cerrar.",
      adHoc: "Una página básica sostiene la presencia, pero rara vez convierte visitas en consultas.",
      defined: "Un sitio propio y al día es una base sólida para captar clientes.",
      optimized: "Un sitio que capta y se mide es una ventaja que pocos negocios tienen.",
    },
    opportunity: {
      title: "Un sitio web que trabaje como vendedor",
      why: "Hoy quien busca el negocio no encuentra un lugar donde conocerlo y contactarlo, y una parte de esos interesados se pierde sin que nadie lo note.",
      action: "Crear o renovar el sitio con una propuesta clara, pruebas de confianza y un acceso directo para contactar.",
    },
    automate: "Preparar el borrador de la estructura y los textos del sitio a partir del perfil del negocio.",
    approval: "Aprobar los textos, las imágenes y la publicación del sitio.",
  },
  social: {
    label: "Redes sociales",
    prompt: ["¿Cómo usa las redes sociales para el negocio?", "¿Cómo usas las redes sociales para el negocio?"],
    options: {
      none: "No las uso para el negocio",
      adHoc: "Publico cuando puedo, sin un plan",
      defined: "Publico con un calendario y constancia",
      optimized: "Tengo una estrategia por red y mido sus resultados",
    },
    reaction: {
      none: "Hoy las redes son la primera vitrina de muchos clientes; no estar es invisible, no neutral.",
      adHoc: "Publicar sin plan agota y no construye audiencia; con un calendario simple cambia mucho.",
      defined: "La constancia con calendario es lo que más cuesta mantener, y ya la tiene.",
      optimized: "Medir qué red aporta clientes es lo que separa la actividad de los resultados.",
    },
    opportunity: {
      title: "Presencia constante en redes",
      why: "Sin una presencia regular, el negocio pierde la oportunidad de ser recordado por quienes todavía no están listos para comprar.",
      action: "Definir un calendario sencillo de contenido y concentrarse en una o dos redes donde estén sus clientes.",
    },
    automate: "Proponer un calendario de contenido y redactar borradores de publicaciones.",
    approval: "Aprobar cada publicación antes de que salga a las redes.",
  },
  capture: {
    label: "Captación de clientes",
    prompt: ["¿Cómo le llegan hoy los clientes nuevos?", "¿Cómo te llegan hoy los clientes nuevos?"],
    options: {
      none: "Solo por recomendaciones",
      adHoc: "Por mensajes directos y llamadas, de forma manual",
      defined: "Por formularios o un chat en mi sitio",
      optimized: "Por varios canales, sabiendo de dónde viene cada uno",
    },
    reaction: {
      none: "Las recomendaciones son oro, pero no se pueden aumentar a voluntad. Aquí está el mayor potencial.",
      adHoc: "Atender todo a mano funciona hasta que entran más consultas de las que se pueden contestar a tiempo.",
      defined: "Contar con un punto de entrada propio es la base para no depender de la suerte.",
      optimized: "Saber de dónde viene cada cliente permite invertir donde sí rinde.",
    },
    opportunity: {
      title: "Un camino claro para que lleguen clientes",
      why: "Es la dimensión que más pesa en el resultado: si captar depende de las recomendaciones o de contestar a mano, el crecimiento tiene techo.",
      action: "Crear un punto de entrada propio (formulario o chat) que reciba cada consulta y la deje registrada con su origen.",
    },
    automate: "Recibir y ordenar cada consulta, y preparar un resumen del interesado para atenderlo mejor.",
    approval: "Aprobar los mensajes que se envíen a un cliente por primera vez.",
  },
  followUp: {
    label: "Seguimiento",
    prompt: ["¿Cómo da seguimiento a quien muestra interés?", "¿Cómo das seguimiento a quien muestra interés?"],
    options: {
      none: "De memoria",
      adHoc: "Con notas u hoja de cálculo",
      defined: "Con una herramienta que me recuerda a quién contactar",
      optimized: "Con un proceso definido que mido",
    },
    reaction: {
      none: "La memoria falla justo cuando hay más trabajo; ahí se escapan las ventas que ya estaban casi cerradas.",
      adHoc: "Las notas funcionan, pero dependen de que alguien las revise a tiempo.",
      defined: "Una herramienta con recordatorios evita que un interesado se enfríe.",
      optimized: "Un proceso medido permite saber cuántas oportunidades se convierten y por qué.",
    },
    opportunity: {
      title: "Seguimiento que no deje enfriar a nadie",
      why: "Muchas ventas se deciden por quién responde primero y quién vuelve a escribir; sin un sistema, eso depende de la memoria de alguien.",
      action: "Registrar cada interesado con su siguiente paso y una fecha, y revisarlos cada día.",
    },
    automate: "Recordar a quién escribir hoy y preparar el borrador del mensaje de seguimiento.",
    approval: "Aprobar el envío de cualquier seguimiento a un cliente.",
  },
  automation: {
    label: "Automatización",
    prompt: ["¿Qué tareas repetitivas del negocio están automatizadas?", "¿Qué tareas repetitivas del negocio están automatizadas?"],
    options: {
      none: "Ninguna, todo lo hago a mano",
      adHoc: "Uso plantillas que copio y pego",
      defined: "Algunas respuestas y avisos se envían solos",
      optimized: "Mis herramientas están conectadas entre sí",
    },
    reaction: {
      none: "Hacerlo todo a mano consume el recurso más caro del negocio: el tiempo de quien lo dirige.",
      adHoc: "Las plantillas ya son un primer paso; falta que se ejecuten sin depender de nadie.",
      defined: "Automatizar lo repetitivo libera tiempo para lo que sí necesita criterio.",
      optimized: "Herramientas conectadas es un nivel que pocos negocios pequeños alcanzan.",
    },
    opportunity: {
      title: "Tiempo recuperado con tareas automáticas",
      why: "Las tareas repetitivas hechas a mano roban horas cada semana y son las primeras que se descuidan en las semanas de más trabajo.",
      action: "Elegir las dos tareas que más se repiten y dejarlas como un proceso fijo con aviso automático.",
    },
    automate: "Preparar las plantillas y el aviso de cada tarea repetitiva para que solo falte aprobarlas.",
    approval: "Aprobar cada automatización antes de activarla.",
  },
  analytics: {
    label: "Medición",
    prompt: ["¿Cómo mide qué le funciona y qué no?", "¿Cómo mides qué te funciona y qué no?"],
    options: {
      none: "No mido nada",
      adHoc: "Miro seguidores y “me gusta”",
      defined: "Mido contactos y ventas por canal",
      optimized: "Tengo tableros con metas y retorno de lo invertido",
    },
    reaction: {
      none: "Sin medir, cada decisión es una apuesta; con muy pocos números ya se decide mucho mejor.",
      adHoc: "Los seguidores se ven bien pero no pagan facturas; lo que importa son contactos y ventas.",
      defined: "Medir contactos y ventas por canal es lo que permite invertir con criterio.",
      optimized: "Con metas y retorno medidos, cada peso invertido se puede defender.",
    },
    opportunity: {
      title: "Decidir con números y no con intuición",
      why: "Sin saber de dónde vienen los clientes y qué cuesta conseguirlos, es difícil saber qué repetir y qué dejar de hacer.",
      action: "Empezar con tres números mensuales: contactos recibidos, clientes ganados y el canal de origen.",
    },
    automate: "Reunir esos números cada semana y resumirlos en lenguaje sencillo.",
    approval: "Aprobar qué datos se conectan y quién puede verlos.",
  },
  advertising: {
    label: "Publicidad",
    prompt: ["¿Invierte en publicidad para conseguir clientes?", "¿Inviertes en publicidad para conseguir clientes?"],
    options: {
      none: "No invierto en publicidad",
      adHoc: "Lo hago de forma ocasional",
      defined: "Invierto de forma regular",
      optimized: "Invierto y optimizo según el retorno que mido",
    },
    reaction: {
      none: "Sin publicidad el crecimiento depende solo del boca a boca; no es un error, pero sí un techo.",
      adHoc: "La publicidad ocasional rara vez aprende nada; la constancia es lo que la hace rentable.",
      defined: "Invertir con regularidad permite aprender qué mensajes funcionan.",
      optimized: "Optimizar por retorno es lo que convierte la publicidad en una inversión y no en un gasto.",
    },
    opportunity: {
      title: "Publicidad con un objetivo y un presupuesto claros",
      why: "Una inversión pequeña pero constante y medida suele rendir más que campañas esporádicas.",
      action: "Probar una campaña acotada con un objetivo definido y comparar su costo por contacto.",
    },
    automate: "Proponer el público, el mensaje y el presupuesto de una primera campaña de prueba.",
    approval: "Aprobar todo gasto publicitario y cada anuncio antes de activarlo.",
  },
  ai: {
    label: "Uso de IA",
    prompt: ["¿Usa inteligencia artificial en el trabajo del negocio?", "¿Usas inteligencia artificial en el trabajo del negocio?"],
    options: {
      none: "No la uso",
      adHoc: "La he probado alguna vez",
      defined: "La uso en algunas tareas",
      optimized: "Está integrada en mis procesos",
    },
    reaction: {
      none: "No pasa nada: la IA rinde mejor sobre procesos ordenados, y ese orden es lo primero que se construye.",
      adHoc: "Probarla es el comienzo; el valor aparece cuando se aplica a tareas concretas del día a día.",
      defined: "Usarla en tareas concretas ya la pone por delante de la mayoría.",
      optimized: "Con la IA integrada en los procesos, el negocio ya trabaja con un equipo ampliado.",
    },
    opportunity: {
      title: "Un asistente que absorba el trabajo repetitivo",
      why: "Responder, ordenar y resumir consume horas que podrían dedicarse a vender y a atender mejor.",
      action: "Empezar por una tarea concreta, como preparar respuestas y resúmenes, con revisión humana.",
    },
    automate: "Preparar respuestas, resúmenes y borradores para que solo falte revisarlos.",
    approval: "Aprobar qué tareas puede hacer el asistente por su cuenta y cuáles no.",
  },
};

export const BAND_COPY: Record<AuditBand, { label: string; line: string }> = {
  initial: { label: "Inicial", line: "el negocio está empezando a construir su base digital" },
  basic: { label: "Básico", line: "ya hay algunas bases, pero todavía dependen mucho del esfuerzo manual" },
  intermediate: { label: "Intermedio", line: "la base está armada y hay margen claro para crecer con orden" },
  advanced: { label: "Avanzado", line: "el negocio opera con una base digital sólida" },
};

export const INFRASTRUCTURE_COPY: Record<Infrastructure, { label: string; line: string; first: string }> = {
  none: {
    label: "Sin infraestructura digital",
    line: "Todavía no tiene una base digital estable para captar y atender clientes.",
    first: "Primero lo básico: un lugar donde los clientes lo encuentren y un camino claro para contactarlo. Lo demás se apoya en eso.",
  },
  partial: {
    label: "Infraestructura parcial",
    line: "Tiene parte de la base armada, pero hay eslabones que frenan el resto.",
    first: "Cerrar primero el eslabón más débil: ampliar lo que ya funciona rinde menos que reparar lo que falta.",
  },
  established: {
    label: "Infraestructura establecida",
    line: "Tiene la base armada; lo que sigue es optimizar, medir y automatizar.",
    first: "Con la base lista, el mayor retorno está en medir con precisión y automatizar lo que hoy se hace a mano.",
  },
};

export const GENERIC_APPROVALS = [
  "Enviar o publicar cualquier mensaje dirigido a sus clientes.",
  "Cualquier gasto, contrato o compromiso en nombre del negocio.",
  "Compartir datos de clientes o conectar herramientas externas.",
] as const;

// What NEX says while it works. Every line describes something the engine really does:
// it does not claim to compare the business with other companies, because it does not.
export const ANALYSIS_STEPS: readonly (readonly [string, string])[] = [
  ["Estoy trabajando en el análisis de su empresa.", "Estoy trabajando en el análisis de tu empresa."],
  ["Estoy contrastando sus respuestas con nuestro marco de madurez digital.", "Estoy contrastando tus respuestas con nuestro marco de madurez digital."],
  ["Estoy identificando oportunidades de crecimiento.", "Estoy identificando oportunidades de crecimiento."],
  ["Estoy preparando sus primeras recomendaciones.", "Estoy preparando tus primeras recomendaciones."],
];

// How each gap reads in the plain-language status sentence next to the Business Score.
export const GAP_CLAUSE: Record<AuditDimension, string> = {
  web: "atraer más clientes",
  capture: "atraer más clientes",
  social: "hacerse ver en redes",
  followUp: "no perder oportunidades de venta",
  automation: "automatizar procesos",
  ai: "automatizar procesos",
  analytics: "decidir con números",
  advertising: "invertir en publicidad con retorno",
};
