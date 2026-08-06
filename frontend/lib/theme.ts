export type Theme = 'dark' | 'light';

/** Where the choice is kept. Read by the inline script before first paint. */
export const THEME_KEY = 'yu-theme';

/**
 * Applies the theme before anything renders.
 *
 * Inlined into the document head as a string, which is the only way to beat the
 * first paint: React has not run yet, and a theme applied afterwards is a flash
 * of the wrong one on every navigation. Reading `localStorage` synchronously
 * here is the cost of that, and it is a few microseconds.
 *
 * No stored choice means follow the system. Someone who has never touched the
 * toggle has still expressed a preference — in their OS settings.
 */
export const THEME_SCRIPT = `(function(){try{
var s=localStorage.getItem('${THEME_KEY}');
var t=s==='light'||s==='dark'?s:(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');
document.documentElement.setAttribute('data-theme',t);
}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

/** The theme in effect right now, as the document reports it. */
export const currentTheme = (): Theme =>
  document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

/**
 * Switches the theme and remembers it.
 *
 * Written to the attribute rather than to React state so the change reaches
 * everything at once — including the parts that read CSS variables directly,
 * like the canvas grid, which no re-render would reach.
 */
export const applyTheme = (theme: Theme): void => {
  document.documentElement.setAttribute('data-theme', theme);

  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private browsing, or storage full. The theme still applies for this
    // session; only remembering it fails, which is not worth an error.
  }
};
