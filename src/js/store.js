import { collection, doc, getDocFromServer, limit, onSnapshot, orderBy, query, runTransaction,
  serverTimestamp, where, startAfter, getDocsFromServer } from 'firebase/firestore';
import { diff, PREFIXES, validateTask } from './model.js';

export const ESTATE = 'estates/regina';
export const ref = (db, kind, id) => doc(db, ESTATE, kind, id);
export const col = (db, kind) => collection(db, ESTATE, kind);
export const data = (snap) => snap.exists() ? snap.data() : null;
export const canWrite = (member, config) => member?.accessStatus === 'active'
  && ['admin','editor'].includes(member.role) && config?.allowManualEdits === true;

export function subscribeDoc(db, kind, id, apply, fail) {
  return onSnapshot(ref(db, kind, id), {includeMetadataChanges: true}, (snap) => {
    if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) apply(data(snap));
  }, fail);
}

export function subscribeList(q, apply, fail) {
  return onSnapshot(q, {includeMetadataChanges: true}, (snap) => {
    if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) apply(snap.docs.map((row) => row.data()), snap.docs.at(-1));
  }, fail);
}
export const tasksQuery = (db, cursor) => query(col(db, 'tasks'), ...(cursor ? [startAfter(cursor)] : []), limit(200));
export const eventsQuery = (db, taskId = null, cursor = null) => query(col(db, 'reginaEvents'),
  ...(taskId ? [where('taskId', '==', taskId)] : []), orderBy('createdAt', 'desc'),
  ...(cursor ? [startAfter(cursor)] : []), limit(40));

export async function nextEvents(db, taskId, cursor) {
  const snap = await getDocsFromServer(eventsQuery(db, taskId, cursor));
  return [snap.docs.map((row) => row.data()), snap.docs.at(-1)];
}

export const loadTask = async (db, id) => data(await getDocFromServer(ref(db, 'tasks', id)));
export class ConflictError extends Error {
  constructor(latest) {
    super('Esta pendência mudou desde a sua revisão. Compare os dados atuais antes de confirmar.');
    this.latest = latest;
  }
}

async function ensureEditor(tx, db, uid) {
  const member = data(await tx.get(ref(db, 'members', uid)));
  const config = data(await tx.get(ref(db, 'config', 'app')));
  if (!canWrite(member, config)) throw Error('Seu perfil não pode gravar alterações.');
}

function stage(tx, db, uid, before, id, task, {channel, operation, summary, transcript = null}) {
  const eventRef = doc(col(db, 'reginaEvents'));
  const stamp = serverTimestamp();
  const after = {
    ...task, id, version: (before?.version ?? 0) + 1, lastEventId: eventRef.id,
    createdAt: before?.createdAt ?? stamp, updatedAt: stamp, updatedByUid: uid
  };
  tx.set(ref(db, 'tasks', id), after);
  tx.set(eventRef, {
    eventId: eventRef.id, taskId: id, actorUid: uid, channel, operation, summary,
    baseVersion: before?.version ?? 0, resultVersion: after.version, createdAt: stamp,
    before, after, transcript
  });
}

export async function saveTask(db, uid, {base = null, values, reason = '', channel = 'manual', operation, transcript = null, split = null}) {
  const clean = validateTask(values, base?.id);
  const child = split ? validateTask(split, null) : null;
  const note = reason.trim();
  if (note.length > 400) throw Error('Limite o resumo da alteração a 400 caracteres.');
  if ((clean.statusCode === 'cancelado' && base?.statusCode !== 'cancelado'
    || base?.statusCode === 'resolvido' && clean.statusCode !== 'resolvido') && !note) {
    throw Error('Informe o motivo do cancelamento ou da reabertura.');
  }
  if (base && !child && !diff(base, clean).length) throw Error('Nenhum campo mudou.');
  const transaction = runTransaction(db, async (tx) => {
    await ensureEditor(tx, db, uid);
    const before = base ? data(await tx.get(ref(db, 'tasks', base.id))) : null;
    if (base && before?.version !== base.version) throw new ConflictError(before);
    let allocatedId;
    if (!base || child) {
      const prefix = PREFIXES[(child ?? clean).priority];
      const seq = ref(db, 'idSequences', prefix);
      const previous = data(await tx.get(seq));
      if (!Number.isInteger(previous?.last) || previous.last >= 999999) throw Error('A sequência de IDs não está disponível.');
      const last = previous.last + 1;
      allocatedId = prefix + String(last).padStart(2, '0');
      if ((await tx.get(ref(db, 'tasks', allocatedId))).exists()) throw Error('O próximo ID já existe. Solicite revisão da sequência.');
      tx.update(seq, {prefix, last, updatedAt: serverTimestamp()});
    }
    const id = base?.id ?? allocatedId;
    const mode = child ? 'split' : !base ? 'create' : clean.archived !== before.archived ? 'archive'
      : clean.statusCode === 'resolvido' && before.statusCode !== 'resolvido' ? 'complete' : operation ?? 'update';
    const summary = note || (mode === 'create' ? 'Pendência criada' : mode === 'archive'
      ? (clean.archived ? 'Pendência arquivada' : 'Pendência restaurada') : 'Pendência atualizada');
    if (child) {
      clean.relatedTaskIds = [...new Set([...clean.relatedTaskIds, allocatedId])];
      child.relatedTaskIds = [...new Set([...child.relatedTaskIds, id])];
      validateTask(clean, id);
      validateTask(child, allocatedId);
    }
    stage(tx, db, uid, before, id, clean, {channel, operation: mode, summary, transcript});
    if (child) stage(tx, db, uid, null, allocatedId, child, {channel, operation: 'split', summary, transcript: null});
    return {id, childId: child ? allocatedId : null};
  });
  try {
    return await transaction;
  } catch (error) {
    if (base && ['permission-denied','aborted','failed-precondition'].includes(error.code)) {
      const latest = await loadTask(db,base.id).catch(() => null);
      if (latest && latest.version !== base.version) throw new ConflictError(latest);
    }
    throw error;
  }
}

export async function requestAccess(db, user, message) {
  const token = await user.getIdTokenResult();
  return runTransaction(db, async (tx) => {
    const target = ref(db, 'accessRequests', user.uid);
    if ((await tx.get(target)).exists()) throw Error('Sua solicitação já foi registrada.');
    tx.set(target, {
      uid: user.uid, googleEmail: token.claims.email, googleDisplayName: token.claims.name ?? '',
      requestText: message.trim(), status: 'pending', requestedAt: serverTimestamp(), lastUpdatedAt: serverTimestamp()
    });
  });
}

export async function manageAccess(db, actor, uid, {role, status, decision}) {
  return runTransaction(db, async (tx) => {
    const memberRef = ref(db, 'members', uid);
    const requestRef = ref(db, 'accessRequests', uid);
    const rosterRef = ref(db, 'config', 'roster');
    const existing = data(await tx.get(memberRef));
    const incoming = data(await tx.get(requestRef));
    const roster = data(await tx.get(rosterRef));
    if (decision && incoming?.status !== 'pending') throw Error('A solicitação já foi analisada.');
    if (decision === 'rejected') {
      tx.update(requestRef, {status: decision, lastUpdatedAt: serverTimestamp()});
      return;
    }
    if (!existing && !incoming) throw Error('Solicitação não encontrada.');
    if (existing?.role === 'admin') throw Error('O administrador principal é gerenciado pelo proprietário.');
    const displayName = existing?.displayName ?? (incoming.googleDisplayName || incoming.googleEmail.split('@')[0]);
    const now = serverTimestamp();
    const names = {...roster?.names};
    if (status === 'active') names[uid] = displayName;
    else delete names[uid];
    tx.set(memberRef, {
      uid, email: existing?.email ?? incoming.googleEmail, displayName, role, accessStatus: status,
      approvedByUid: actor, approvedAt: now, updatedAt: now, createdAt: existing?.createdAt ?? now
    });
    tx.set(rosterRef, {names});
    if (decision) tx.update(requestRef, {status: decision, lastUpdatedAt: now});
  });
}
