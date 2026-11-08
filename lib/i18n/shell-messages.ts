// The words of the navigation shell that are new in the Premium Experience (favorites, recents, quick search, theme, install, offline).
// Spanish and English exist today; any other language falls back to Spanish until its dictionary is added, like the platform modules do.
export type ShellText = {
  skip: string; collapse: string; expand: string; favorites: string; recents: string; navigation: string; platform: string;
  addFavorite: (name: string) => string; removeFavorite: (name: string) => string; noFavorites: string;
  search: string; searchTitle: string; searchPlaceholder: string; searchEmpty: string; searchHint: string;
  themeToLight: string; themeToDark: string; install: string; offline: string; online: string;
};

const es: ShellText = {
  skip: "Saltar al contenido", collapse: "Contraer la barra lateral", expand: "Expandir la barra lateral", favorites: "Favoritos", recents: "Recientes", navigation: "Navegación", platform: "Plataforma",
  addFavorite: (name) => `Añadir ${name} a favoritos`, removeFavorite: (name) => `Quitar ${name} de favoritos`, noFavorites: "Fije pantallas con la estrella para tenerlas a mano.",
  search: "Buscar", searchTitle: "Búsqueda rápida", searchPlaceholder: "Buscar una pantalla…", searchEmpty: "No hay resultados.", searchHint: "↑ ↓ para moverse · Enter para abrir · Esc para cerrar",
  themeToLight: "Cambiar a NOVA Light", themeToDark: "Cambiar a NOVA Dark", install: "Instalar la app", offline: "Sin conexión: puede ver lo que ya cargó.", online: "Conexión restablecida.",
};

const en: ShellText = {
  skip: "Skip to content", collapse: "Collapse the sidebar", expand: "Expand the sidebar", favorites: "Favorites", recents: "Recent", navigation: "Navigation", platform: "Platform",
  addFavorite: (name) => `Add ${name} to favorites`, removeFavorite: (name) => `Remove ${name} from favorites`, noFavorites: "Pin screens with the star to keep them at hand.",
  search: "Search", searchTitle: "Quick search", searchPlaceholder: "Search for a screen…", searchEmpty: "No results.", searchHint: "↑ ↓ to move · Enter to open · Esc to close",
  themeToLight: "Switch to NOVA Light", themeToDark: "Switch to NOVA Dark", install: "Install the app", offline: "You are offline: you can see what already loaded.", online: "Back online.",
};

export const shellText = (locale: string): ShellText => (locale === "en" ? en : es);
