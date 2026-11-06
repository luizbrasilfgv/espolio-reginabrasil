import assert from 'node:assert/strict';
import { api, credential } from './credentials.mjs';

const [project,site] = process.argv.slice(2);
if (!project || !site || project === site) throw Error('Informe projeto e site separado.');
const origin = 'https://' + site + '.web.app';
const firestore = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(project) + '/databases/(default)';
const all = await Promise.all([
  fetch(origin), fetch(origin + '/manifest.webmanifest'), fetch(origin + '/sw.js'), fetch(origin + '/__/auth/iframe'),
  fetch('https://' + project + '.web.app'), fetch(firestore + '/documents/estates/regina/tasks/P11'),
  fetch(firestore + '/documents/estates/regina/reginaEvents?pageSize=1'),
  api(credential(true),firestore + '/collectionGroups/reginaEvents/indexes')
]);
const [home,manifest,worker,helper,atlas,task,events,indexes] = all;
for (const response of [home,manifest,worker,helper,atlas]) assert.equal(response.status,200,new URL(response.url).pathname);
assert.match(await home.text(),/<title>Espólio Regina Brasil<\/title>/);
assert.doesNotMatch(await atlas.text(),/<title>Espólio Regina Brasil<\/title>/);
assert.equal((await manifest.json()).display,'standalone');
assert.match(await worker.text(),/espolio-shell-/);
assert.doesNotMatch(helper.headers.get('x-frame-options') || '',/^deny$/i);
for (const response of [task,events]) {
  assert.equal(response.status,403,'leitura de dados sem autenticação');
  assert.equal((await response.json()).error.status,'PERMISSION_DENIED');
}
const states = (indexes.indexes || []).map((index) => index.state);
assert.ok(states.length,'Índice de histórico ausente.');
console.log(JSON.stringify({url:origin,hosting:home.status,atlas:atlas.status,manifest:manifest.status,
  serviceWorker:worker.status,authHelper:helper.status,anonymousTask:task.status,anonymousEvents:events.status,indexStates:states},null,2));
