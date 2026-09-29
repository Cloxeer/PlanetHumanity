/** THIS FILE DOES: Reads/writes persisted UI preferences (theme, text size, motion) and applies them to the document, ROLE: UI, MAINTAINER NOTE: Every localStorage access is try/catch wrapped; private-browsing or blocked storage must never throw. **/
const PREFIX = 'ph:';

export function getPref(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // storage unavailable (private mode, quota, disabled) - preference just won't persist
  }
}

export function applyPrefs() {
  const html = document.documentElement;
  const theme = getPref('theme', 'light');
  const text = getPref('text', 'normal');
  const reduceOs = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motion = getPref('motion', reduceOs ? 'reduce' : 'normal');

  html.setAttribute('data-theme', theme);
  html.setAttribute('data-text', text);
  html.setAttribute('data-motion', motion);

  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = theme === 'dark' ? '#000000' : '#F5F5F7';

  return { theme, text, motion };
}
