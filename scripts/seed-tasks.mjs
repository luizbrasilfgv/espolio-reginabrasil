import { readFile } from 'node:fs/promises';
import { initializeApp, deleteApp, applicationDefault } from 'firebase-admin/app';
import { initializeFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { useCliFirestoreCredential } from './prepare-seed-credential.mjs';
import { credential } from './credentials.mjs';
import { EMPTY, aggregate, validateTask, diff } from '../src/js/model.js';

const {values:args} = parseArgs({options:{
  project:{type:'string'}, 'admin-email':{type:'string'}, apply:{type:'boolean'}, 'firebase-cli':{type:'boolean'}
}});
if (!args.project || !args['admin-email']) throw Error('Uso: npm run seed -- --project ID --admin-email EMAIL [--firebase-cli] [--apply]');
if (args.project.startsWith('demo-') !== Boolean(process.env.FIRESTORE_EMULATOR_HOST)) throw Error('Projeto e emulador devem corresponder.');
const catalogPath = args.project.startsWith('demo-') ? '../tests/fixtures/tasks.json' : '../data/initial-tasks.json';
const raw = JSON.parse(await readFile(new URL(catalogPath,import.meta.url),'utf8'));
const ids = new Set(raw.map((t) => t.id));
const seed = raw.map((t) => ({id:t.id,...validateTask({...EMPTY,...t},t.id,ids)}));
const {totals} = aggregate(seed);
if (ids.size !== 34 || totals.resolved !== 3 || totals.scheduled !== 1 || totals.open !== 30) throw Error('Catálogo inicial inválido.');
const app = initializeApp({projectId:args.project,credential:applicationDefault()});
const authApp = args['firebase-cli'] ? initializeApp({projectId:args.project,credential:credential(true)},'auth-lookup') : app;
const db = initializeFirestore(app,{preferRest:!process.env.FIRESTORE_EMULATOR_HOST});
if (args['firebase-cli']) useCliFirestoreCredential(db);
const root = db.doc('estates/regina');
try {
  const admin = await getAuth(authApp).getUserByEmail(args['admin-email']);
  if (admin.disabled || !admin.emailVerified || !admin.providerData.some((p) => p.providerId === 'google.com')) {
    throw Error('A conta do administrador precisa existir no Auth com Google e e-mail verificado.');
  }
  const config = root.collection('config').doc('app');
  const roster = root.collection('config').doc('roster');
  const adminRef = root.collection('members').doc(admin.uid);
  const tasks = root.collection('tasks');
  await db.runTransaction(async (tx) => {
    const seq = Object.entries({U:10,P:13,S:11}).map(([prefix,last]) => ({prefix,last,ref:root.collection('idSequences').doc(prefix)}));
    const [cfg,people,member,...seqs] = await tx.getAll(config,roster,adminRef,...seq.map((s) => s.ref));
    const existing = await tx.get(tasks);
    const byId = new Map(existing.docs.map((doc) => [doc.id,doc.data()]));
    const missing = seed.filter((t) => !byId.has(t.id));
    const differences = seed.flatMap((t) => {
      if (!byId.has(t.id)) return [];
      const fields = diff(t,byId.get(t.id)).map(({key}) => key);
      return fields.length ? [{id:t.id,fields}] : [];
    });
    console.log(JSON.stringify({project:args.project,mode:args.apply?'gravação':'simulação',initial:seed.length,
      existing:byId.size,missing:missing.map((t)=>t.id),differences,administrator:member.exists?'presente':'a incluir'},null,2));
    if (!args.apply) return;
    if (member.exists && (member.get('role') !== 'admin' || member.get('accessStatus') !== 'active')) throw Error('O UID já tem outro papel.');
    const now = FieldValue.serverTimestamp();
    const displayName = (admin.displayName || admin.email.split('@')[0]).slice(0,100);
    if (!cfg.exists) tx.create(config,{appName:'Espólio Regina Brasil',dataReferenceDate:'2026-11-06',locale:'pt-BR',
      timeZone:'America/Sao_Paulo',aiEnabled:false,speechEnabled:true,allowManualEdits:true,seedVersion:'2026-11-06-v4',schemaVersion:1});
    if (!member.exists) tx.create(adminRef,{uid:admin.uid,email:admin.email,displayName,role:'admin',
      accessStatus:'active',approvedByUid:admin.uid,approvedAt:now,createdAt:now,updatedAt:now});
    const name = member.get('displayName') ?? displayName;
    if (!people.exists || people.get('names')?.[admin.uid] !== name) tx.set(roster,{names:{...people.get('names'),[admin.uid]:name}});
    seq.forEach(({prefix,last,ref},i) => {
      if (seqs[i].exists) return;
      const highest = Math.max(last,...[...byId.keys()].filter((id) => id.startsWith(prefix)).map((id) => Number(id.slice(1))).filter(Number.isSafeInteger));
      tx.create(ref,{prefix,last:highest,updatedAt:now});
    });
    for (const task of missing) {
      const eventId = randomUUID();
      const after = {...task,version:1,lastEventId:eventId,createdAt:now,updatedAt:now,updatedByUid:admin.uid};
      tx.create(tasks.doc(task.id),after);
      tx.create(root.collection('reginaEvents').doc(eventId),{eventId,taskId:task.id,actorUid:admin.uid,channel:'initial_import',
        operation:'create',summary:'Importação inicial · posição de 06/11/2026',baseVersion:0,resultVersion:1,
        createdAt:now,before:null,after,transcript:null});
    }
  });
  console.log(args.apply?'Importação confirmada pelo Firestore.':'Simulação concluída, sem gravação.');
} finally {
  if (authApp !== app) await deleteApp(authApp);
  await deleteApp(app);
}
