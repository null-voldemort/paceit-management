// The start-up screen (see index.html / public/splash.css) stays until the page behind it has finished settling:
// fonts loaded, data shown, lazy parts mounted and the layout quiet. Only then it fades out, so nothing shifts,
// flickers or "pops in" in front of the person.
const MIN_VISIBLE_MS = 900;
const QUIET_MS = 300;
const MAX_WAIT_MS = 8000;

let started = false;

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function fontsReady() {
  try {
    await Promise.all([
      ...[400, 500, 600, 700, 800].map((w) => document.fonts.load(`${w} 16px Fustat`, 'Abc123')),
      document.fonts.load('16px Kalpurush', 'অআকখ'),
      document.fonts.load('bold 16px Kalpurush', 'অআকখ'),
    ]);
    await document.fonts.ready;
  } catch { /* use whatever the browser has */ }
}

function pageQuiet(): Promise<void> {
  return new Promise((resolve) => {
    const root = document.getElementById('root');
    if (!root) return resolve();
    let timer = 0;
    const done = () => { obs.disconnect(); clearTimeout(timer); clearTimeout(cap); resolve(); };
    const arm = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const pending = Array.from(root.querySelectorAll('img')).some((i) => !i.complete);
        if (pending) arm(); else done();
      }, QUIET_MS);
    };
    const obs = new MutationObserver(arm);
    obs.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    const cap = window.setTimeout(done, MAX_WAIT_MS);
    arm();
  });
}

export async function hideSplash(): Promise<void> {
  if (started) return;
  started = true;
  const el = document.getElementById('splash');
  if (!el) return;
  const t0 = performance.now();
  await fontsReady();
  await frame();
  await pageQuiet();
  await frame();
  const wait = MIN_VISIBLE_MS - performance.now();
  if (wait > 0 && t0 < MIN_VISIBLE_MS) await new Promise((r) => setTimeout(r, wait));
  el.classList.add('splash-out');
  setTimeout(() => el.remove(), 800);
}
