/* Service worker di Life RPG.
   Tiene una copia dell'app sul dispositivo, così si apre anche senza internet.
   - La pagina: prima si prova la rete (così gli aggiornamenti arrivano da soli),
     e se manca la rete o è lenta si usa la copia salvata.
   - Icone, manifest, CSS e JS: si usa subito la copia salvata e intanto la si aggiorna.
   - Tutto ciò che viene da altri siti (account Google e Firebase, Calendar) non viene toccato.
   - La musica (file audio) va sempre direttamente dalla rete: non viene salvata e quindi non c'è offline.
   I percorsi sono relativi, quindi funziona anche in una sottocartella (…/life-rpg/).

   Nota sugli aggiornamenti: quando una release cambia insieme index.html e
   index.js/style.css/i18n.js, incrementa CACHE (es. 'life-rpg-v2'). Così
   activate() cancella la cache vecchia e il primo reload dopo l'update
   aspetta la rete per gli asset invece di servire quelli obsoleti, evitando
   disallineamenti tra markup nuovo e logica/stili vecchi. */

const CACHE = 'life-rpg-v41';
const PAGE = './index.html';
const FILES = [
  './', PAGE, './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './style.css', './i18n.js', './index.js',
  './firebase/firebase-app-compat.js', './firebase/firebase-auth-compat.js', './firebase/firebase-firestore-compat.js',
];

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

function fetchWithTimeout(url, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(url, { cache: 'no-cache' }).then(
      r => { clearTimeout(t); resolve(r); },
      err => { clearTimeout(t); reject(err); }
    );
  });
}

async function pageRequest(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(PAGE);
  try {
    // con una copia già salvata non si aspetta più di 4 secondi la rete; senza copia si aspetta e basta
    const res = cached ? await fetchWithTimeout(req.url, 4000) : await fetch(req.url, { cache: 'no-cache' });
    if (res && res.ok && !res.redirected) cache.put(PAGE, res.clone());
    return res;
  } catch (err) {
    return cached || Response.error();
  }
}

async function assetRequest(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  // cache: 'no-cache' forza il browser a rivalidare con la rete invece di
  // rispondere con la sua cache HTTP interna, così l'aggiornamento è reale
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
  if (new URL(req.url).origin !== self.location.origin) return;
  // audio e richieste "a pezzi" (Range): vanno diretti alla rete, altrimenti alcuni browser non riproducono la musica
  if (req.headers.has('range') || req.destination === 'audio' || req.destination === 'video') return;
  if (req.mode === 'navigate') e.respondWith(pageRequest(req));
  else e.respondWith(assetRequest(e));
});
