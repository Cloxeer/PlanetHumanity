/** THIS FILE DOES: Wires the nav theme toggle button, swapping sun/moon icons and persisting via prefs, ROLE: UI, MAINTAINER NOTE: The click handler only flips one attribute + icon swap to stay under browser.themeToggleMsMax. **/
import { icon } from './icons.js';
import { getPref, setPref } from './prefs.js';

export function createThemeToggle(button, { onChange } = {}) {
  let theme = getPref('theme', 'light');

  function render() {
    button.replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'));
    button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }

  function set(next) {
    if (next !== 'light' && next !== 'dark') return;
    theme = next;
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#000000' : '#F5F5F7';
    setPref('theme', theme);
    render();
    onChange?.(theme);
  }

  function onClick() {
    set(theme === 'dark' ? 'light' : 'dark');
  }

  render();
  button.addEventListener('click', onClick);

  function destroy() {
    button.removeEventListener('click', onClick);
  }

  return { get theme() { return theme; }, set, destroy };
}
