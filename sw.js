/* Service worker di Life RPG.
   Tiene una copia dell'app sul dispositivo, così si apre anche senza internet.
   - La pagina e i file dell'app (index.html, style.css, i18n.js, game.js, draw.js, sync.js, missions.js, audio.js, index.js): prima si prova la rete,
     così un aggiornamento arriva sempre tutto insieme (markup, stili e logica della stessa versione).
     Se la rete manca o è lenta (più di 4 secondi) si usa la copia salvata; la risposta arrivata in ritardo
     aggiorna comunque la copia, per la prossima volta.
   - Icone, manifest e librerie Firebase: si usa subito la copia salvata e intanto la si aggiorna
     (cambiano di rado e non devono "andare d'accordo" con il resto).
   - Tutto ciò che viene da altri siti (account Google e Firebase, Calendar) non viene toccato.
   - La musica (file audio) va sempre direttamente dalla rete: non viene salvata e quindi non c'è offline.
   I percorsi sono relativi, quindi funziona anche in una sottocartella (…/life-rpg/).

   Nota sugli aggiornamenti: con "prima la rete" per i file dell'app non serve più cambiare CACHE
   a ogni release per evitare HTML nuovo con JS vecchio. Cambiala solo se vuoi forzare la pulizia
   di tutta la copia salvata (per esempio se togli o rinomini dei file). */

const CACHE = 'life-rpg-v52';
const PAGE = './index.html';
const APP_FILES = ['./style.css', './i18n.js', './game.js', './draw.js', './sync.js', './missions.js', './audio.js', './index.js'];
const FILES = [
  './', PAGE, './manifest.webmanifest', './icon-192.png', './icon-512.png',
  ...APP_FILES,
];
// le librerie Firebase non si scaricano all'installazione: si salvano la prima volta che l'app le usa
const APP_PATHS = new Set(APP_FILES.map(f => new URL(f, self.location).pathname));
const WAIT_MS = 4000;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // un file alla volta: se ne manca uno (ad esempio un'icona) l'installazione non fallisce
    await Promise.all(FILES.map(f => cache.add(new Request(f, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('life-rpg-') && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// "prima la rete": key = dove si salva la copia (per la pagina, sempre index.html)
async function networkFirst(event, key) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key);
  const net = fetch(event.request.mode === 'navigate' ? event.request.url : event.request, { cache: 'no-cache' })
    .then(res => {
      if (res && res.ok && !res.redirected) cache.put(key, res.clone());
      return res;
    });
  // anche se si risponde con la copia salvata, la risposta di rete arrivata dopo aggiorna la copia
  event.waitUntil(net.catch(() => {}));
  if (!cached) {
    try { return await net; } catch (err) { return Response.error(); }
  }
  // con una copia già salvata non si aspetta la rete più di WAIT_MS
  const late = new Promise(res => setTimeout(() => res(null), WAIT_MS));
  try {
    const res = await Promise.race([net, late]);
    return res || cached;
  } catch (err) {
    return cached;
  }
}

// "prima la copia salvata", aggiornandola in background
async function cacheFirst(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const update = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  event.waitUntil(update);
  return cached || (await update) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // audio e richieste "a pezzi" (Range): vanno diretti alla rete, altrimenti alcuni browser non riproducono la musica
  if (req.headers.has('range') || req.destination === 'audio' || req.destination === 'video') return;
  if (req.mode === 'navigate') e.respondWith(networkFirst(e, PAGE));
  else if (APP_PATHS.has(url.pathname)) e.respondWith(networkFirst(e, url.pathname));
  else e.respondWith(cacheFirst(e));
});
