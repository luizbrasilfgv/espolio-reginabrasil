import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, limit, serverTimestamp, writeBatch } from 'firebase/firestore';
import { EMPTY } from '../../src/js/model.js';
import { col, ref, tasksQuery, eventsQuery, saveTask, manageAccess, ConflictError } from '../../src/js/store.js';

const projectId = 'demo-espolio-regina';
const google = (uid) => ({email:uid+'@example.test',email_verified:true,name:uid,
  firebase:{sign_in_provider:'google.com',identities:{}}});
const actor = (uid) => env.authenticatedContext(uid,google(uid)).firestore();
const stamp = Timestamp.fromMillis(1000);
const data = {...EMPTY,id:'P11',title:'Tarefa de teste',nextAction:'Conferir informação.',version:1,
  lastEventId:'initial-event-0001',createdAt:stamp,updatedAt:stamp,updatedByUid:'admin'};
let env;
before(async () => {
  const rules = await readFile(process.env.TEST_RULES_FILE || 'firestore.rules','utf8');
  env = await initializeTestEnvironment({projectId,firestore:{rules}});
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [uid,role,accessStatus] of [['admin','admin','active'],['a','editor','active'],
      ['b','editor','active'],['viewer','viewer','active'],['revoked','editor','revoked']]) {
      await setDoc(ref(db,'members',uid),{uid,email:uid+'@example.test',displayName:uid,role,accessStatus,createdAt:stamp});
    }
    await setDoc(ref(db,'config','app'),{allowManualEdits:true,aiEnabled:false,speechEnabled:true});
    await setDoc(ref(db,'config','roster'),{names:{a:'a',b:'b',admin:'admin'}});
    await setDoc(ref(db,'tasks','P11'),data);
    await setDoc(ref(db,'idSequences','P'),{prefix:'P',last:13,updatedAt:stamp});
  });
});
after(async () => { await env?.cleanup(); });

test('somente membros Google ativos leem tarefas, config e eventos',async () => {
  const wrong = env.authenticatedContext('admin',{...google('admin'),firebase:{sign_in_provider:'password',identities:{}}}).firestore();
  for (const db of [env.unauthenticatedContext().firestore(),actor('stranger'),actor('revoked'),wrong]) {
    await assertFails(getDoc(ref(db,'tasks','P11')));
    await assertFails(getDocs(tasksQuery(db)));
    await assertFails(getDoc(ref(db,'config','app')));
    await assertFails(getDocs(eventsQuery(db)));
  }
  for (const uid of ['admin','a','b','viewer']) await assertSucceeds(getDocs(tasksQuery(actor(uid))));
  await assertFails(getDocs(col(actor('viewer'),'tasks')));
  await assertFails(getDocs(query(col(actor('viewer'),'members'),limit(20))));
});
test('solicitação própria, e-mail verificado, aprovação e revogação',async () => {
  const db = actor('stranger');
  const form = {uid:'stranger',googleEmail:'stranger@example.test',googleDisplayName:'stranger',requestText:'',status:'pending',
    requestedAt:serverTimestamp(),lastUpdatedAt:serverTimestamp()};
  await assertFails(setDoc(ref(db,'accessRequests','stranger'),{...form,role:'admin'}));
  await assertFails(setDoc(ref(db,'accessRequests','stranger'),{...form,googleEmail:'fake@example.test'}));
  await assertFails(setDoc(ref(db,'accessRequests','other'),form));
  await assertSucceeds(setDoc(ref(db,'accessRequests','stranger'),form));
  await assertSucceeds(getDoc(ref(db,'accessRequests','stranger')));
  await assertFails(getDoc(ref(actor('a'),'accessRequests','stranger')));
  await assertFails(setDoc(ref(db,'members','stranger'),{role:'admin',accessStatus:'active'}));
  await assertFails(updateDoc(ref(db,'accessRequests','stranger'),{status:'approved'}));
  await assertFails(updateDoc(ref(actor('a'),'members','a'),{role:'admin'}));
  await assertFails(updateDoc(ref(actor('admin'),'members','admin'),{accessStatus:'revoked'}));
  await manageAccess(actor('admin'),'admin','stranger',{role:'viewer',status:'active',decision:'approved'});
  await assertSucceeds(getDoc(ref(db,'tasks','P11')));
  await manageAccess(actor('admin'),'admin','stranger',{role:'viewer',status:'revoked',decision:null});
  await assertFails(getDoc(ref(db,'tasks','P11')));
});
test('auditoria atômica, conflito com dois editores e proibição de adulteração',async () => {
  const one = actor('a'), two = actor('b'), viewer = actor('viewer');
  await assertFails(updateDoc(ref(viewer,'tasks','P11'),{title:'Viewer'}));
  await assertFails(updateDoc(ref(one,'tasks','P11'),{nextAction:'Sem evento',version:2,updatedAt:serverTimestamp(),updatedByUid:'a'}));
  const eventId = 'arbitrary-event-0001';
  await assertFails(setDoc(ref(one,'reginaEvents',eventId),{eventId,taskId:'P11',actorUid:'a'}));
  const result = await Promise.allSettled([
    saveTask(one,'a',{base:data,values:{...data,nextAction:'Primeira opção'}}),
    saveTask(two,'b',{base:data,values:{...data,nextAction:'Segunda opção'}})
  ]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length,1);
  assert.ok(result.find((r) => r.status === 'rejected').reason instanceof ConflictError);
  const current = (await getDoc(ref(one,'tasks','P11'))).data();
  assert.equal(current.version,2);
  const e = (await getDoc(ref(one,'reginaEvents',current.lastEventId))).data();
  assert.equal(e.before.nextAction,data.nextAction);
  assert.equal(e.after.nextAction,current.nextAction);
  assert.equal(e.actorUid,current.updatedByUid);
  assert.equal(e.createdAt.toMillis(),current.updatedAt.toMillis());
  await assertFails(updateDoc(ref(one,'reginaEvents',e.eventId),{summary:'alterado'}));
  await assertFails(deleteDoc(ref(one,'reginaEvents',e.eventId)));
  await assertFails(deleteDoc(ref(one,'tasks','P11')));
  const fakeId = 'forged-event-00000001';
  const forged = writeBatch(one);
  const forgedAfter = {...current,version:3,nextAction:'Forjada',lastEventId:fakeId,updatedByUid:'a',updatedAt:serverTimestamp()};
  forged.set(ref(one,'tasks','P11'),forgedAfter);
  forged.set(ref(one,'reginaEvents',fakeId),{...e,eventId:fakeId,actorUid:'a',baseVersion:2,resultVersion:3,
    createdAt:serverTimestamp(),before:{...current,nextAction:'Histórico falso'},after:forgedAfter});
  await assertFails(forged.commit());
});
test('sequência exige tarefa e tarefa exige a sequência; desdobramento é indivisível',async () => {
  const db = actor('a');
  await assertFails(updateDoc(ref(db,'idSequences','P'),{last:14,updatedAt:serverTimestamp()}));
  const created = await saveTask(db,'a',{values:{...EMPTY,title:'Criação',nextAction:'Conferir.'}});
  assert.equal(created.id,'P14');
  const base = (await getDoc(ref(db,'tasks',created.id))).data();
  const split = await saveTask(db,'a',{base,values:base,split:{...EMPTY,title:'Filha',nextAction:'Verificar.'},channel:'ai_approved'});
  assert.deepEqual(split,{id:'P14',childId:'P15'});
  const main = (await getDoc(ref(db,'tasks','P14'))).data();
  const child = (await getDoc(ref(db,'tasks','P15'))).data();
  assert.deepEqual(main.relatedTaskIds,['P15']);
  assert.deepEqual(child.relatedTaskIds,['P14']);
  assert.equal((await getDoc(ref(db,'reginaEvents',child.lastEventId))).get('channel'),'ai_approved');
});

test('regras combinadas preservam as permissões do Atlas e isolam o espólio',{skip:!process.env.TEST_RULES_FILE},async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db,'usuarios','atlas-leitor'),{email:'atlas-leitor@example.test',papel:'aprovado'});
    await setDoc(doc(db,'boletins','somente-atlas'),{title:'Boletim fictício'});
    await setDoc(doc(db,'boletins_privado','somente-admin'),{title:'Boletim privado fictício'});
  });
  const atlasUser = actor('atlas-leitor');
  await assertSucceeds(getDoc(doc(atlasUser,'boletins','somente-atlas')));
  await assertFails(getDoc(doc(atlasUser,'boletins_privado','somente-admin')));
  await assertFails(getDocs(tasksQuery(atlasUser)));
  await assertSucceeds(getDocs(tasksQuery(actor('admin'))));
  await assertFails(getDoc(doc(actor('admin'),'boletins','somente-atlas')));
});
