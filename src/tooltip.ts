// macOS-style tooltips. Any element with a title (or data-tip) gets one after a short delay.
// A shortcut can be added with data-key, e.g. data-key="⌘S".
let tip: HTMLDivElement | null = null;
let timer = 0;
let current: HTMLElement | null = null;

function el() {
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'tooltip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

function hide() {
  clearTimeout(timer);
  current = null;
  tip?.classList.remove('on');
}

function show(target: HTMLElement) {
  const text = target.dataset.tip;
  if (!text) return;
  const t = el();
  t.innerHTML = '';
  t.appendChild(document.createTextNode(text));
  if (target.dataset.key) {
    const k = document.createElement('span');
    k.className = 'tipKey';
    k.textContent = target.dataset.key;
    t.appendChild(k);
  }
  t.classList.add('on');
  const r = target.getBoundingClientRect();
  const tr = t.getBoundingClientRect();
  let x = r.left + r.width / 2 - tr.width / 2;
  x = Math.max(8, Math.min(window.innerWidth - tr.width - 8, x));
  let y = r.bottom + 8;
  if (y + tr.height > window.innerHeight - 8) y = r.top - tr.height - 8;
  t.style.left = `${Math.round(x)}px`;
  t.style.top = `${Math.round(y)}px`;
}

export function installTooltips() {
  document.addEventListener('mouseover', (e) => {
    const target = (e.target as HTMLElement).closest?.('[title],[data-tip]') as HTMLElement | null;
    if (target === current) return;
    hide();
    if (!target) return;
    // take over the native title so the browser doesn't show a second tooltip
    const title = target.getAttribute('title');
    if (title) {
      target.dataset.tip = title;
      if (!target.getAttribute('aria-label')) target.setAttribute('aria-label', title);
      target.removeAttribute('title');
    }
    current = target;
    timer = window.setTimeout(() => current === target && show(target), 550);
  });
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('keydown', hide, true);
  window.addEventListener('blur', hide);
  document.addEventListener('scroll', hide, true);
}
