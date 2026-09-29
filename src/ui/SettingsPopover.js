/** THIS FILE DOES: Glass popover for map display settings (dark mode, larger text, reduce motion), ROLE: UI, MAINTAINER NOTE: Shared by the globe gear button and the nav's phone-width gear button (dynamic-imported there); text/motion prefs use getPref/setPref exactly like the old FilterPanel Display section did. **/
import { getPref, setPref } from './prefs.js';

export function createSettingsPopover(anchorBtn, { theme, placement = 'left' } = {}) {
  const pop = document.createElement('div');
  pop.className = `ph-settings-popover ph-settings-${placement === 'below' ? 'below' : 'left'}`;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Map settings');
  pop.tabIndex = -1;
  pop.hidden = true;

  function switchRow(label, initialOn, onToggle) {
    const row = document.createElement('div');
    row.className = 'ph-settings-row';
    const span = document.createElement('span');
    span.textContent = label;
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'switch';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', label);
    let on = initialOn;
    const render = () => sw.setAttribute('aria-checked', String(on));
    render();
    sw.addEventListener('click', () => { on = !on; render(); onToggle(on); });
    row.append(span, sw);
    return { el: row, sync(v) { on = v; render(); } };
  }

  const darkRow = switchRow('Dark mode', theme?.theme === 'dark', (on) => theme?.set(on ? 'dark' : 'light'));
  const textRow = switchRow('Larger text', getPref('text', 'normal') === 'large', (on) => {
    document.documentElement.setAttribute('data-text', on ? 'large' : 'normal');
    setPref('text', on ? 'large' : 'normal');
  });
  const reduceOs = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionRow = switchRow('Reduce motion', getPref('motion', reduceOs ? 'reduce' : 'normal') === 'reduce', (on) => {
    document.documentElement.setAttribute('data-motion', on ? 'reduce' : 'normal');
    setPref('motion', on ? 'reduce' : 'normal');
  });

  pop.append(darkRow.el, textRow.el, motionRow.el);
  anchorBtn.insertAdjacentElement('afterend', pop);
  anchorBtn.setAttribute('aria-haspopup', 'dialog');
  anchorBtn.setAttribute('aria-expanded', 'false');

  let isOpen = false;
  let opener = null;

  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }
  function onPointerDown(e) {
    if (pop.contains(e.target) || anchorBtn.contains(e.target)) return;
    close();
  }

  function sync() {
    darkRow.sync(document.documentElement.getAttribute('data-theme') === 'dark');
    textRow.sync(getPref('text', 'normal') === 'large');
    const reduceOsNow = matchMedia('(prefers-reduced-motion: reduce)').matches;
    motionRow.sync(getPref('motion', reduceOsNow ? 'reduce' : 'normal') === 'reduce');
  }

  function open() {
    sync();
    isOpen = true;
    pop.hidden = false;
    opener = document.activeElement;
    anchorBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    pop.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    pop.hidden = true;
    anchorBtn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    if (opener && typeof opener.focus === 'function') opener.focus(); else anchorBtn.focus();
  }

  function toggle() { isOpen ? close() : open(); }

  function destroy() {
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    pop.remove();
  }

  return { open, close, toggle, destroy, sync, get isOpen() { return isOpen; } };
}
