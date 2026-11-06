import '../styles/app.css';
import { onAuthStateChanged } from 'firebase/auth';
import { limit, orderBy, query, updateDoc } from 'firebase/firestore';
import { auth, db, firebaseApp, aiOptions, emulator, configured, login, logout, finishLogin } from './firebase.js';
import { EMPTY, ROLES, ACCESS, TASK_ID, diff, localDate, sensitive } from './model.js';
import { col, ref, subscribeDoc, subscribeList, tasksQuery, eventsQuery, nextEvents,
  canWrite, ConflictError, saveTask, requestAccess, manageAccess } from './store.js';
import { h, icon, route, taskRoute, btn, banner, gate, shell, textarea, select, check } from './ui.js';
import { dashboard, taskList, taskResults, detail, activity, diffHtml } from './task-views.js';
import { taskFields, readTask, updateView, more, adminView, exportView, helpView } from './forms.js';
import { interpret, confirmation, duplicates } from './ai.js';
import { interpretLocally } from './local-interpretation.js';
import { editedReview, rebaseReview, reviewItems } from './proposal-review.js';
import { shareText, exportJSON, exportCSV, download } from './exports.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const live = document.querySelector('#announcer');
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
const sessionStops = [], privateStops = [], pageStops = [];
let state, page, modal, recognizer, installation;
let busy = false;
let generation = 0;
let authState = 'loading';
let generalError = '';
function fresh(user) {
  return {user,member:undefined,names:{},update:{text:'',consent:false,retain:false,proposals:[]},
    activityFilters:{},taskPages:new Map(),history:{}};
}
state = fresh(null);
function currentPage() {
  const [path,search=''] = location.hash.replace(/^#\/?/, '').split('?');
  if (path.startsWith('pendencia/')) return {name:'pendencia',id:path.slice('pendencia/'.length).toUpperCase(),filters:{}};
  const routes = ['painel','pendencias','atividade','atualizar','mais','acessos','exportar','ajuda'];
  return {name:routes.includes(path)?path:'painel',filters:Object.fromEntries(new URLSearchParams(search))};
}
page = currentPage();
const isActive = () => state.member?.accessStatus === 'active';
const isAdmin = () => isActive() && state.member.role === 'admin';
const canSuggest = () => state.canEdit && !!state.tasks;
const canAI = () => state.canEdit && state.config?.aiEnabled && aiOptions.verified && !!aiOptions.model && !!aiOptions.siteKey;
const activeTask = () => state.tasks?.find((t) => t.id === page.id) || state.detailTask;
const known = () => new Set((state.tasks || []).map((t) => t.id));
const capture = () => generation;
const valid = (session) => session === generation;
const stopAll = (items) => { for (const stop of items.splice(0)) stop(); };

function alertMessage(message, kind = '') {
  state.notice = {message,kind};
  live.textContent = message;
  paint();
}
function errorText(error) {
  if (error.code === 'permission-denied') return 'O Firebase recusou a operação. Confira seu acesso e tente novamente.';
  if (['unavailable','deadline-exceeded'].includes(error.code) || !navigator.onLine) return 'Sem conexão com o Firebase. A gravação não foi confirmada.';
  if (error.code?.startsWith('auth/')) return 'Não foi possível entrar com Google. Verifique a conexão e tente novamente.';
  return error instanceof Error && !error.code ? error.message : 'Não foi possível confirmar a operação. Tente novamente.';
}
function loginView() {
  if (!configured) return gate('Configuração necessária','O app Web precisa da configuração pública do Firebase.');
  if (authState === 'loading') return gate('Verificando sessão…','Aguarde a confirmação da sua conta Google.');
  if (!state.user) return gate('Bem-vindo ao painel','Entre com sua conta Google para acompanhar o trabalho da família.',
    banner(generalError,'error') + btn('Continuar com Google','login','primary') + btn('Usar janela do Google','login-popup','ghost')
    + '<p class="small muted">O administrador autoriza cada conta antes de liberar as pendências.</p>');
  if (state.authzError) return gate('Acesso indisponível',state.authzError,btn('Tentar novamente','reload','primary') + btn('Sair','logout'));
  if (state.member === undefined) return gate('Verificando acesso…',
    navigator.onLine ? 'Estamos consultando suas permissões no Firebase.' : 'Conecte-se à internet para confirmar sua autorização.',
    btn('Sair da conta Google','logout'));
  if (state.member) return gate('Acesso ' + (state.member.accessStatus === 'revoked' ? 'revogado' : 'suspenso'),
    'Fale com o administrador para revisar o acesso desta conta.',btn('Sair','logout'));
  if (state.accessRequest) {
    const rejected = state.accessRequest.status === 'rejected';
    return gate(rejected ? 'Solicitação rejeitada' : 'Acesso pendente',rejected
      ? 'Fale com o administrador se precisar solicitar uma revisão.' : 'Sua solicitação foi registrada. O painel abre quando o administrador aprovar seu acesso.',
    btn('Sair','logout') + '<p class="muted small wrap">' + h(state.user.email) + '</p>');
  }
  return gate('Solicite seu acesso','O administrador vai analisar a solicitação da sua conta Google.',
    banner(state.notice?.message,state.notice?.kind)
    + '<p class="small muted wrap">' + h(state.user.email) + '</p><form id="access-form" class="stack">'
    + textarea('Mensagem opcional','message','','maxlength="400"') + '<button type="submit" class="primary">Solicitar acesso</button></form>'
    + btn('Sair','logout','ghost'));
}
function paint(focus = false) {
  if (!isActive()) app.innerHTML = loginView();
  else {
    const notices = banner(!navigator.onLine ? 'Sem conexão. Os dados carregados podem estar desatualizados. Gravações precisam de internet.' : '')
      + banner(state.dataError,'error') + banner(state.notice?.message,state.notice?.kind);
    let body;
    switch (page.name) {
      case 'pendencias': body = taskList(state,page.filters); break;
      case 'pendencia': body = detail(state,activeTask()); break;
      case 'atividade': body = activity(state); break;
      case 'atualizar': body = updateView(state,canAI(),!!Speech); break;
      case 'mais': body = more(state); break;
      case 'acessos': body = adminView(state); break;
      case 'exportar': body = exportView(state,shareText(state.tasks || [])); break;
      case 'ajuda': body = helpView(!!installation); break;
      default: body = dashboard(state);
    }
    app.innerHTML = shell(page.name,state.member.displayName,ROLES[state.member.role],body,notices);
  }
  if (focus) app.querySelector('h1, main')?.focus({preventScroll:true});
}
function refresh() {
  if (dialog.open || app.querySelector('#filters details[open]')
    || app.contains(document.activeElement) && document.activeElement.matches('textarea,input,select')) {
    const results = app.querySelector('#task-results');
    if (results && state.tasks) {
      const q = app.querySelector('#filters [name=q]').value;
      results.innerHTML = taskResults(state,{...page.filters,q});
    }
    return;
  }
  paint();
}
function clearPrivate() {
  stopAll(privateStops);
  stopAll(pageStops);
  stopSpeech(true);
  if (dialog.open) dialog.close();
  dialog.replaceChildren();
  modal = null;
  const {user,member,accessRequest,authzError} = state;
  state = {...fresh(user),member,accessRequest,authzError};
  generation++;
  busy = false;
}
function deny(error) {
  if (error.code === 'permission-denied') {
    clearPrivate();
    state.member = null;
    state.authzError = 'O acesso foi alterado. Entre novamente para consultar seu perfil.';
    paint(true);
  } else {
    state.dataError = errorText(error);
    refresh();
  }
}
function guarded(callback) {
  const session = capture();
  return (...args) => { if (valid(session) && isActive()) callback(...args); };
}
function subscribePrivate() {
  const fail = guarded(deny);
  privateStops.push(subscribeDoc(db,'config','app',guarded((config) => {
    state.config = config;
    state.canEdit = canWrite(state.member,config);
    if (!state.canEdit && modal?.editing) closeModal();
    if (!config) state.dataError = 'O administrador ainda precisa concluir a configuração inicial.';
    refresh();
  }),fail));
  privateStops.push(subscribeDoc(db,'config','roster',guarded((roster) => { state.names = roster?.names || {}; refresh(); }),fail));
  function taskPage(cursor, key) {
    privateStops.push(subscribeList(tasksQuery(db,cursor),guarded((rows,last) => {
      state.taskPages.set(key,rows);
      state.tasks = [...new Map([...state.taskPages.values()].flat().map((t) => [t.id,t])).values()];
      if (rows.length === 200 && last && !state.taskPages.has(last.id)) {
        state.taskPages.set(last.id,[]);
        taskPage(last,last.id);
      }
      refresh();
    }),fail));
  }
  taskPage(null,'first');
  watchHistory('events',null,privateStops);
  try {
    const key = 'espolio-last-visit-' + state.user.uid;
    state.previousVisit = Number(localStorage.getItem(key)) || 0;
    localStorage.setItem(key,String(Date.now()));
  } catch { /* O armazenamento local é opcional. */ }
  subscribePage();
}
const mergeEvents = (head,tail = []) => [...new Map([...head,...tail].map((event) => [event.eventId,event])).values()];
function watchHistory(key, id, stops) {
  const isDetail = key === 'detailEvents';
  const info = state.history[key] = {tail:[]};
  const moreKey = isDetail ? 'moreDetail' : 'moreEvents';
  const errorKey = isDetail ? 'detailHistoryError' : 'eventsError';
  const same = () => !id || page.id === id;
  stops.push(subscribeList(eventsQuery(db,id),guarded((rows,last) => {
    if (!same()) return;
    if (info.tail.length && info.head?.length) info.tail = mergeEvents(info.head,info.tail);
    info.head = rows;
    state[key] = mergeEvents(rows,info.tail);
    if (!info.tail.length) { info.cursor = last; state[moreKey] = rows.length === 40; }
    state[errorKey] = '';
    refresh();
  }),guarded((error) => {
    if (!same()) return;
    if (error.code === 'permission-denied') return deny(error);
    state[errorKey] = error.code === 'failed-precondition'
      ? 'O índice do histórico está sendo preparado no Firebase. Volte em alguns minutos.' : errorText(error);
    refresh();
  })));
}
function subscribePage() {
  stopAll(pageStops);
  state.detailEvents = state.detailTask = state.detailError = state.detailHistoryError = null;
  state.detailLoading = state.moreDetail = false;
  if (!isActive()) return;
  if (page.name === 'acessos' && isAdmin()) {
    for (const [kind,key] of [['accessRequests','requests'],['members','members']]) {
      const q = kind === 'accessRequests' ? query(col(db,kind),orderBy('requestedAt','desc'),limit(100)) : query(col(db,kind),limit(100));
      pageStops.push(subscribeList(q,guarded((rows) => {
        if (isAdmin() && page.name === 'acessos') { state[key] = rows; refresh(); }
      }),guarded((error) => { state.adminError = errorText(error); refresh(); })));
    }
  }
  if (page.name !== 'pendencia' || !TASK_ID.test(page.id)) return;
  const id = page.id;
  state.detailLoading = true;
  pageStops.push(subscribeDoc(db,'tasks',id,guarded((task) => {
    if (page.id !== id) return;
    state.detailTask = task; state.detailLoading = false; refresh();
  }),guarded((error) => {
    if (page.id !== id) return;
    if (error.code === 'permission-denied') return deny(error);
    state.detailLoading = false; state.detailError = errorText(error); refresh();
  })));
  watchHistory('detailEvents',id,pageStops);
}
function onUser(user) {
  stopAll(sessionStops);
  clearPrivate();
  state = fresh(user);
  authState = 'ready';
  paint();
  if (!user) return;
  const {uid} = user;
  sessionStops.push(subscribeDoc(db,'members',uid,(member) => {
    if (state.user?.uid !== uid) return;
    const wasActive = isActive();
    const wasAdmin = isAdmin();
    state.member = member;
    state.authzError = '';
    const nowActive = isActive();
    if (wasActive && !nowActive) clearPrivate();
    if (!wasActive && nowActive) { state.notice = null; subscribePrivate(); }
    if (wasActive && nowActive && wasAdmin !== isAdmin()) subscribePage();
    state.canEdit = canWrite(member,state.config);
    if (!state.canEdit && modal?.editing) closeModal();
    if (wasActive !== nowActive) paint();
    else refresh();
  },(error) => {
    if (state.user?.uid !== uid) return;
    clearPrivate();
    state.member = null;
    state.authzError = errorText(error);
    paint();
  }));
  sessionStops.push(subscribeDoc(db,'accessRequests',uid,(request) => {
    if (state.user?.uid === uid) { state.accessRequest = request; if (!isActive()) refresh(); }
  },() => {}));
}

function filtersFrom(form) {
  return form ? Object.fromEntries([...new FormData(form)].filter(([,value]) => value && value !== 'active')) : page.filters;
}
window.addEventListener('hashchange',() => {
  if (location.hash === '#conteudo') return;
  const next = currentPage();
  if (page.name !== next.name || page.id !== next.id) {
    stopSpeech(true);
    closeModal();
    state.notice = null;
    page = next;
    subscribePage();
    window.scrollTo({top:0});
  } else page = next;
  paint(true);
});
window.addEventListener('offline',() => { stopSpeech(true); paint(); });
window.addEventListener('online',() => paint());
window.addEventListener('beforeinstallprompt',(event) => {
  event.preventDefault();
  installation = event;
  if (page.name === 'ajuda') refresh();
});
if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (configured) {
  onAuthStateChanged(auth,onUser);
  finishLogin().catch((error) => { generalError = errorText(error); if (!state.user) paint(); });
}
paint();

function openModal(title, content, options = {}) {
  modal = options;
  dialog.innerHTML = '<div class="dialog-head"><h2 id="dialog-title" tabindex="-1">' + h(title) + '</h2>'
    + btn('Fechar','close-modal','ghost') + '</div><div id="modal-error"></div>' + content;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('h2').focus();
}
function closeModal() { if (dialog.open) dialog.close(); }
dialog.addEventListener('close',() => {
  if (!dialog.open) { modal = null; dialog.replaceChildren(); refresh(); }
});
dialog.addEventListener('cancel',(event) => { if (busy) event.preventDefault(); });
function modalError(message) {
  const area = dialog.querySelector('#modal-error');
  area.innerHTML = banner(message,'error');
  area.scrollIntoView({block:'nearest'});
}
const formButtons = (label) => '<div class="row"><button class="primary" type="submit">' + h(label) + '</button>' + btn('Voltar','close-modal','ghost') + '</div>';
function openTask(base, draft = null, conflict = false, reason = '') {
  const values = draft || base || EMPTY;
  openModal(base ? 'Editar ' + base.id : 'Criar pendência',
    (conflict ? banner('Versão atual carregada. Revise seu rascunho antes de gravar novamente.') + diffHtml(base,values,state.names) : '')
    + '<form id="task-form"><div class="form-grid">' + taskFields(values,state.names)
    + '<div class="wide">' + textarea('Motivo ou resumo da mudança','reason',reason,'maxlength="400"') + '</div></div>'
    + '<p class="small muted">Informe um motivo se estiver cancelando ou reabrindo uma pendência.</p>'
    + formButtons('Revisar alteração') + '</form>',{editing:true,base});
}
function manualReview(payload) {
  openModal(payload.base ? 'Confirmar ' + payload.base.id : 'Confirmar nova pendência',
    '<p class="muted">A alteração e seu histórico serão gravados juntos.</p>'
    + diffHtml(payload.base,payload.values,state.names) + (payload.reason ? '<p class="wrap">' + h(payload.reason) + '</p>' : '')
    + '<div class="row">' + btn('Confirmar gravação','save-task','primary') + btn('Voltar à edição','back-task') + '</div>',
    {editing:true,payload});
}
function manageDialog(action, uid) {
  const existing = state.members?.find((m) => m.uid === uid);
  const request = state.requests?.find((r) => r.uid === uid);
  if (!existing && !request) return;
  const decision = action.startsWith('approve') ? 'approved' : action === 'reject-request' ? 'rejected' : null;
  const role = action === 'approve-viewer' ? 'viewer' : existing?.role || 'editor';
  openModal(decision === 'rejected' ? 'Rejeitar solicitação' : 'Confirmar acesso',
    '<p class="wrap">' + h(existing?.email || request.googleEmail) + '</p><form id="member-form" class="stack">'
    + (decision === 'rejected' ? '<p>Esta conta ficará sem acesso ao painel.</p>'
      : select('Perfil','role',{editor:'Editor',viewer:'Leitor'},role)
        + select('Acesso','status',decision ? {active:'Ativo'} : ACCESS,decision ? 'active' : existing?.accessStatus))
    + formButtons('Confirmar decisão') + '</form>',{uid,decision});
}
function editProposal(i, rebase = false) {
  const item = state.update.proposals[i];
  if (!item?.values) return;
  let base = item.base;
  let values = item.values;
  if (rebase && item.conflict) {
    const changes = Object.fromEntries(diff(base,values).map(({key,after}) => [key,after]));
    base = item.conflict;
    values = {...base,...changes};
  }
  openModal('Revisar proposta',
    (rebase ? banner('Compare a versão atual com o rascunho antes de selecionar novamente.') + diffHtml(base,values,state.names) : '')
    + '<form id="proposal-form"><div class="form-grid">' + taskFields(values,state.names)
    + (item.operation === 'split' ? '<h3 class="wide">Nova pendência</h3>' + taskFields(item.newTask,state.names,'new-') : '')
    + '<div class="wide">' + textarea('Evidência ou motivo da alteração','reason',item.userReason,'maxlength="400"') + '</div></div>'
    + formButtons('Aplicar à proposta') + '</form>',{editing:true,index:i,base});
}
function acceptProposal(i) {
  const item = state.update.proposals[i];
  if (!item?.values || item.conflict || !['pending','failed'].includes(item.decision)) return;
  const critical = item.values.statusCode === 'resolvido' && item.base?.statusCode !== 'resolvido'
    || item.base?.statusCode === 'resolvido' && item.values.statusCode !== 'resolvido'
    || item.values.statusCode === 'cancelado' && item.base?.statusCode !== 'cancelado';
  if (critical || item.needsClarification || item.duplicateIds?.length) {
    openModal('Aprovar esta alteração',
      '<form id="accept-form" class="stack"><p>' + h(item.values.title) + '</p>' + banner(item.clarificationQuestion)
      + (item.duplicateIds?.length ? banner('Verifique se o item já existe: ' + item.duplicateIds.join(', ') + '.') : '')
      + (critical || item.needsClarification ? textarea('Fato confirmado ou motivo','reason',item.userReason,'required maxlength="400"') : '')
      + check('Conferi os fatos e o escopo desta alteração.','verified',false,'required')
      + formButtons('Confirmar e gravar esta alteração') + '</form>',{editing:true,index:i});
  } else void commitProposal(i);
}
function stopSpeech(cancel = false) {
  if (!recognizer) return;
  const current = recognizer;
  if (cancel) {
    recognizer = null;
    current.abort();
    state.update.listening = false;
  } else current.stop();
}
function startSpeech() {
  if (!Speech || !state.config?.speechEnabled || !state.canEdit || recognizer) return;
  const session = capture();
  const speech = new Speech();
  recognizer = speech;
  speech.lang = 'pt-BR';
  speech.interimResults = true;
  speech.continuous = false;
  const initial = state.update.text.trim();
  let hasFinalSpeech = false;
  speech.onresult = (event) => {
    if (!valid(session) || recognizer !== speech || page.name !== 'atualizar') return;
    const results = Array.from(event.results);
    hasFinalSpeech = results.length > 0 && results.every((r) => r.isFinal);
    const spoken = results.map((r) => r[0].transcript).join(' ');
    state.update.text = [initial,spoken].filter(Boolean).join(' ').slice(0,2500);
    const field = app.querySelector('[name="transcript"]');
    if (field) field.value = state.update.text;
  };
  speech.onerror = (event) => {
    if (!valid(session) || recognizer !== speech) return;
    state.update.speechStatus = event.error === 'not-allowed'
      ? 'Permissão do microfone recusada. Digite sua atualização.' : 'Ditado interrompido. Revise o texto ou continue digitando.';
  };
  speech.onend = () => {
    if (!valid(session) || recognizer !== speech) return;
    recognizer = null;
    state.update.listening = false;
    if (state.update.speechStatus === 'Escutando…') {
      state.update.speechStatus = 'Ditado encerrado. Revise o texto e as sugestões.';
      if (hasFinalSpeech && canSuggest()) return suggestLocally();
    }
    paint();
  };
  state.update.listening = true;
  state.update.speechStatus = 'Escutando…';
  try { speech.start(); }
  catch { recognizer = null; state.update.listening = false; state.update.speechStatus = 'Microfone indisponível. Use o campo de texto.'; }
  paint();
}
async function withResult(work, source, after) {
  if (busy) return;
  if (!navigator.onLine) {
    if (dialog.open) modalError('Sem conexão. Sua alteração ainda não foi gravada.');
    else alertMessage('Sem conexão. Conecte-se para continuar.','error');
    return;
  }
  busy = true;
  if (source) source.disabled = true;
  const session = capture();
  try {
    const value = await work();
    if (valid(session)) after?.(value);
  } catch (error) {
    if (!valid(session)) return;
    if (error instanceof ConflictError && error.latest && modal?.payload) {
      const {base,values,reason} = modal.payload;
      const changes = Object.fromEntries(diff(base,values).map(({key,after:value}) => [key,value]));
      openTask(error.latest,{...error.latest,...changes},true,reason);
    } else if (dialog.open) modalError(errorText(error));
    else alertMessage(errorText(error),'error');
  } finally {
    if (valid(session)) busy = false;
    if (source?.isConnected) source.disabled = false;
  }
}
async function readOlder(taskScoped, source) {
  const key = taskScoped ? 'detailEvents' : 'events';
  const id = taskScoped ? page.id : null;
  const info = state.history[key];
  if (!info?.cursor) return;
  return withResult(() => nextEvents(db,id,info.cursor),source,([rows,last]) => {
    if (taskScoped && page.id !== id) return;
    info.tail = mergeEvents(info.tail,rows);
    state[key] = mergeEvents(info.head || [],info.tail);
    info.cursor = last;
    state[taskScoped?'moreDetail':'moreEvents'] = rows.length === 40;
    paint();
  });
}
function startLogin(popup, source) {
  if (busy) return;
  busy = true;
  source.disabled = true;
  generalError = '';
  const redirect = !emulator && !popup && (/Android|iPhone|iPad/i.test(navigator.userAgent) || matchMedia('(display-mode: standalone)').matches);
  login(redirect).catch((error) => { generalError = errorText(error); paint(); })
    .finally(() => { busy = false; if (source.isConnected) source.disabled = false; });
}
async function logoutNow() {
  if (busy) return;
  stopAll(sessionStops);
  clearPrivate();
  state.member = undefined;
  authState = 'loading';
  paint();
  try { await logout(); }
  catch (error) { generalError = errorText(error); onUser(auth.currentUser); }
}

document.addEventListener('click',(event) => {
  const source = event.target.closest('[data-action]');
  if (!source || source.disabled) return;
  const {action,index,uid} = source.dataset;
  const i = Number(index);
  if (action === 'close-modal') { if (!busy) closeModal(); return; }
  if (action === 'login' || action === 'login-popup') return startLogin(action === 'login-popup',source);
  if (action === 'logout') return void logoutNow();
  if (action === 'reload') return location.reload();
  if (!isActive() || busy) return;
  const task = activeTask();
  if (action === 'new-task' && state.canEdit) openTask(null);
  if (action === 'edit-task' && state.canEdit && task) openTask(task);
  if (action === 'archive-task' && state.canEdit && task) manualReview({base:task,values:{...task,archived:!task.archived}});
  if (action === 'back-task' && modal?.payload) openTask(modal.payload.base,modal.payload.values,false,modal.payload.reason);
  if (action === 'save-task' && state.canEdit && modal?.payload) {
    return void withResult(() => saveTask(db,state.user.uid,modal.payload),source,({id}) => {
      closeModal();
      if (page.id === id) alertMessage(id + ' gravada com histórico.','success');
      else { location.hash = taskRoute(id); live.textContent = id + ' gravada com histórico.'; }
    });
  }
  if (action === 'older-events' || action === 'older-detail') return void readOlder(action === 'older-detail',source);
  if (['approve-editor','approve-viewer','reject-request','manage-member'].includes(action) && isAdmin()) manageDialog(action,uid);
  if (action === 'new-utterance') {
    stopSpeech(true);
    Object.assign(state.update,{text:'',speechStatus:'',error:'',summary:'',proposals:[]});
    state.notice = null;
    paint();
    app.querySelector('[name="transcript"]')?.focus();
  }
  if (action === 'speech-start') startSpeech();
  if (action === 'speech-stop') stopSpeech();
  if (canSuggest() && ['edit-proposal','rebase-proposal'].includes(action)) editProposal(i,action === 'rebase-proposal');
  if (canSuggest() && action === 'accept-proposal') acceptProposal(i);
  if (canSuggest() && action === 'reject-proposal' && state.update.proposals[i]) {
    state.update.proposals[i].decision = 'rejected';
    paint();
    app.querySelector('#proposal-' + i)?.focus({preventScroll:true});
  }
  if (action === 'export-json' && state.tasks) download(exportJSON(state.tasks),'application/json','espolio-regina.json');
  if (action === 'export-csv' && state.tasks) download(exportCSV(state.tasks),'text/csv;charset=utf-8','espolio-regina.csv');
  if (action === 'copy-summary') {
    const field = document.querySelector('#whatsapp');
    if (!field) return;
    const manual = () => { field.focus(); field.select(); live.textContent = 'Texto selecionado. Use a opção Copiar do dispositivo.'; };
    if (navigator.clipboard) navigator.clipboard.writeText(field.value).then(() => alertMessage('Resumo copiado.','success')).catch(manual);
    else manual();
  }
  if (action === 'install' && installation) { void installation.prompt(); installation = null; }
});

document.addEventListener('input',(event) => {
  const field = event.target;
  if (field.form?.id === 'interpret-form') {
    if (field.name === 'transcript') state.update.text = field.value;
    if (field.name === 'consent') state.update.consent = field.checked;
    if (field.name === 'retain') state.update.retain = field.checked;
  }
  if (field.form?.id === 'filters' && field.name === 'q') {
    const result = app.querySelector('#task-results');
    if (result && state.tasks) result.innerHTML = taskResults(state,{...page.filters,q:field.value});
  }
});
document.addEventListener('submit',(event) => {
  const form = event.target;
  const values = new FormData(form);
  event.preventDefault();
  if (busy) return;
  const source = event.submitter;
  if (form.id === 'access-form' && state.user && !isActive()) {
    return void withResult(() => requestAccess(db,state.user,String(values.get('message'))),source,
      () => alertMessage('Solicitação registrada.','success'));
  }
  if (!isActive()) return;
  try {
    if (form.id === 'task-form' && state.canEdit && modal) {
      const base = modal.base;
      const draft = readTask(values,base,state.names,known());
      const reason = String(values.get('reason')).trim();
      if (base && !diff(base,draft).length) throw Error('Nenhum campo mudou.');
      if ((draft.statusCode === 'cancelado' && base?.statusCode !== 'cancelado'
        || base?.statusCode === 'resolvido' && draft.statusCode !== 'resolvido') && !reason) throw Error('Informe o motivo do cancelamento ou da reabertura.');
      return manualReview({base,values:draft,reason});
    }
    if (form.id === 'member-form' && isAdmin() && modal) {
      const {uid,decision} = modal;
      return void withResult(() => manageAccess(db,state.user.uid,uid,{role:values.get('role'),status:values.get('status'),decision}),source,
        () => { closeModal(); alertMessage('Decisão de acesso registrada.','success'); });
    }
    if (form.id === 'config-form' && isAdmin() && state.config) {
      if (values.has('ai') && (!aiOptions.verified || !aiOptions.model || !aiOptions.siteKey)) throw Error('A configuração de IA gratuita com App Check ainda não foi validada.');
      return void withResult(() => updateDoc(ref(db,'config','app'),{
        aiEnabled:values.has('ai'),speechEnabled:values.has('speech'),allowManualEdits:values.has('manual')
      }),source,() => alertMessage('Configuração atualizada.','success'));
    }
    if (form.id === 'filters') {
      const next = route('pendencias',filtersFrom(form));
      if (location.hash === next) paint();
      else location.hash = next;
    }
    if (form.id === 'activity-filters') { state.activityFilters = Object.fromEntries(values); paint(); }
    if (form.id === 'interpret-form' && canSuggest()) {
      if (source?.value === 'remote' && canAI()) void interpretText(source);
      else suggestLocally();
    }
    if (form.id === 'proposal-form' && canSuggest() && modal) {
      const item = state.update.proposals[modal.index];
      const base = modal.base;
      const draft = readTask(values,base,state.names,known());
      const child = item.operation === 'split' ? readTask(values,null,state.names,known(),'new-') : item.newTask;
      if (base && !diff(base,draft).length && item.operation !== 'split') throw Error('Nenhum campo mudou. Você pode rejeitar a proposta.');
      Object.assign(item,editedReview(item,base,draft),{newTask:base ? child : draft,decision:'pending',error:'',conflict:null,userReason:String(values.get('reason')).trim()});
      item.duplicateIds = duplicates(item,state.tasks || []).map((t) => t.id);
      closeModal();
      paint();
    }
    if (form.id === 'accept-form' && canSuggest() && modal) {
      const item = state.update.proposals[modal.index];
      if (!values.has('verified')) return;
      item.userReason = String(values.get('reason') || item.userReason).trim();
      if (values.has('reason') && !item.userReason) throw Error('Informe o fato confirmado ou motivo.');
      const index = modal.index;
      closeModal();
      void commitProposal(index);
    }
  } catch (error) {
    if (dialog.open) modalError(errorText(error));
    else alertMessage(errorText(error),'error');
  }
});

function suggestLocally() {
  const update = state.update;
  const text = update.text.trim();
  if (update.listening || update.saving) return;
  if (!text) return alertMessage('Digite ou dite o que aconteceu para analisar.');
  try {
    const result = interpretLocally(text,state.tasks,update.localService,update.localTaskId);
    Object.assign(update,result,{proposals:reviewItems(result.proposals),error:'',batchText:text,storeText:false,transcriptStored:false});
  } catch (error) {
    return alertMessage(errorText(error),'error');
  }
  state.notice = null;
  live.textContent = 'Interpretação disponível para revisão.';
  paint();
  app.querySelector('#update-review')?.focus();
}
async function interpretText(source) {
  const update = state.update;
  const text = update.text.trim();
  if (!update.consent || !text) return alertMessage('Escreva uma atualização e confirme o envio ao provedor.','error');
  if (sensitive(text)) return alertMessage('Remova possíveis dados sensíveis antes de enviar.','error');
  if (update.lastCall && Date.now() - update.lastCall < 12000) return alertMessage('Aguarde alguns segundos antes de uma nova interpretação.');
  const session = capture();
  Object.assign(update,{lastCall:Date.now(),busy:true,error:'',proposals:[],summary:'',consent:false,transcriptStored:false});
  const storeText = update.retain;
  update.retain = false;
  paint();
  await withResult(async () => {
    try { return await interpret(firebaseApp,{...aiOptions,today:localDate()},text,state.tasks || [],state.names); }
    catch { throw Error('Não foi possível interpretar com segurança. Verifique a disponibilidade da IA ou use a edição manual.'); }
  },source,(result) => Object.assign(update,result,{proposals:reviewItems(result.proposals),batchText:text,storeText}));
  if (valid(session)) {
    update.busy = false;
    paint();
    app.querySelector('#update-review')?.focus();
  }
}
async function commitProposal(index) {
  const update = state.update;
  const item = update.proposals[index];
  if (!item?.values || item.conflict || busy || update.saving) return;
  if (!navigator.onLine) {
    item.error = 'Sem conexão. Reconecte para gravar esta alteração.';
    paint();
    return;
  }
  const session = capture();
  update.saving = true;
  busy = true;
  item.error = '';
  paint();
  try {
    const result = await saveTask(db,state.user.uid,{...confirmation({...item,decision:'accepted'}),
      transcript:update.storeText && !update.transcriptStored ? update.batchText : null});
    if (!valid(session)) return;
    item.decision = 'done';
    item.taskId = result.id;
    update.transcriptStored = true;
    live.textContent = 'Alteração de ' + result.id + ' gravada.';
    if (item.base && item.operation !== 'split') {
      const applied = {...item.values,id:result.id,version:item.base.version + 1};
      for (const sibling of update.proposals) {
        if (!['pending','failed'].includes(sibling.decision) || sibling.base?.id !== result.id || sibling.base.version !== item.base.version) continue;
        const rebased = rebaseReview(sibling,applied);
        if (!rebased) {
          Object.assign(sibling,{conflict:applied,error:'Outra proposta alterou este campo. Compare as duas versões.'});
        } else if (!diff(rebased.base,rebased.values).length) {
          Object.assign(sibling,{decision:'informational',values:null,reason:'A alteração já foi contemplada em outra proposta gravada.'});
        } else Object.assign(sibling,rebased,{conflict:null,error:''});
      }
    }
  } catch (error) {
    if (!valid(session)) return;
    item.decision = 'failed';
    item.error = errorText(error);
    if (error instanceof ConflictError) item.conflict = error.latest;
  } finally {
    if (valid(session)) {
      update.saving = false;
      busy = false;
      paint();
      app.querySelector('#proposal-' + index)?.focus({preventScroll:true});
    }
  }
}
