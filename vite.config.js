import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/@firebase/firestore/')) return 'firestore';
          if (id.includes('/@firebase/auth/')) return 'auth';
        }
      }
    }
  },
  plugins: [{
    name: 'static-app-shell',
    generateBundle(_, bundle) {
      const assets = ['/', '/offline.html', '/manifest.webmanifest', '/mark.svg', '/icon-192.png',
        '/icon-512.png', '/icon-maskable.png', ...Object.keys(bundle)
          .filter((path) => /^assets\/.*\.(?:js|css)$/.test(path)).map((path) => '/' + path)];
      const hash = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 16);
      this.emitFile({type: 'asset', fileName: 'sw.js', source: serviceWorker('espolio-shell-' + hash, assets)});
    }
  }]
});

function serviceWorker(cache, assets) {
  return 'const CACHE = ' + JSON.stringify(cache) + ';\nconst STATIC = ' + JSON.stringify(assets) + ';\n' +
    'self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC))));\n' +
    'self.addEventListener("activate", (event) => event.waitUntil((async () => {\n' +
    '  const keys = await caches.keys();\n' +
    '  await Promise.all(keys.filter((key) => key.startsWith("espolio-shell-") && key !== CACHE).map((key) => caches.delete(key)));\n' +
    '  await self.clients.claim();\n' +
    '})()));\n' +
    'self.addEventListener("fetch", (event) => {\n' +
    '  const {request} = event;\n' +
    '  const url = new URL(request.url);\n' +
    '  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/__/")) return;\n' +
    '  if (request.mode === "navigate") {\n' +
    '    event.respondWith(fetch(request).catch(async () => (await caches.match("/")) || caches.match("/offline.html")));\n' +
    '  } else if (!url.search && STATIC.includes(url.pathname)) {\n' +
    '    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));\n' +
    '  }\n' +
    '});\n';
}
