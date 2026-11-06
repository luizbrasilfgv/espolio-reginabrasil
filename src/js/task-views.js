import { TOPICS, PRIORITIES, STATUSES, GROUPS, FIELDS, SOURCES, aggregate, filterTasks, localDate,
  dateLabel, dateTime, display, diff, group, closed, money, normalize, thirdParty } from './model.js';
import { h, icon, route, taskRoute, btn, go, empty, header, select, input } from './ui.js';

const STATUS_ICONS = {total:'list', resolved:'check', scheduled:'calendar', open:'clock', closed_other:'list'};
const kpi = (key, count) => '<a class="panel kpi" href="' + route('pendencias', {group:key === 'total' ? '' : key, archive:'all'})
  + '">' + icon(STATUS_ICONS[key]) + '<strong>' + count + '</strong><span class="small muted">' + GROUPS[key] + '</span></a>';
const status = (task) => '<span class="chip ' + group(task) + '">' + h(STATUSES[task.statusCode]) + '</span>';
const priority = (task) => '<span class="chip ' + h(task.priority) + '">' + h(PRIORITIES[task.priority]) + '</span>';
const compact = (tasks, note, description = (t) => t.nextAction) => tasks.length ? '<ul class="compact-list">' + tasks.map((t) =>
  '<li><a href="' + taskRoute(t.id) + '"><strong>' + h(t.id + ' · ' + t.title) + '</strong><br><small class="muted wrap">' + h(description(t)) + '</small></a></li>').join('')
  + '</ul>' : '<p class="muted small">' + h(note) + '</p>';
const actorLabel = (event, names) => names[event.actorUid] ?? (event.channel === 'initial_import' ? 'Importação inicial' : 'Membro do painel');

export function dashboard(state) {
  const tasks = state.tasks;
  if (!tasks) return header('Visão geral', 'Painel do espólio') + empty('Carregando pendências…');
  const {totals, topics, priorities, statuses, percent} = aggregate(tasks);
  const live = tasks.filter((t) => !t.archived && !closed(t));
  const today = localDate();
  const queues = [
    ['Próximos compromissos', live.filter((t) => t.statusCode === 'agendado'), (t) => dateLabel(t.dueDate) + ' · ' + t.nextAction],
    ['Pagamentos a conferir', live.filter((t) => t.statusCode === 'pagamento_pendente'), (t) => t.nextAction],
    ['Retornos aguardados', live.filter(thirdParty), (t) => t.nextAction],
    ['Providências desta semana', filterTasks(live, {due:'week'}, state.user.uid, today), (t) => dateLabel(t.dueDate) + ' · ' + t.nextAction]
  ];
  const radar = [
    ['Vencidas', {due:'overdue'}, ''],
    ['Próximos 7 dias', {due:'week'}, ''],
    ['Aguardando terceiros', {view:'waiting'}, ''],
    ['Sem responsável', {owner:'none'}, ''],
    ['Dependem de outra ação', {view:'blocked'}, ''],
    ['Pendências críticas', {view:'critical'}, '']
  ];
  const max = Math.max(1, ...Object.values(topics).map((v) => v.total));
  const changes = (state.events || []).filter((e) => e.channel !== 'initial_import');
  const since = changes.filter((e) => state.previousVisit && e.createdAt?.toMillis() > state.previousVisit);
  const dependencies = [['U02','S02'],['P05','P06','S01'],['U09','P10','S10'],['P03','P11']].filter((ids) => ids.every((id) => tasks.some((t) => t.id === id)));
  return header('Visão geral', 'Painel do espólio', 'Acompanhe pendências, prazos e as últimas mudanças.',
    state.canEdit ? btn(icon('plus') + ' Nova pendência', 'new-task', 'primary') : '')
    + '<div class="kpis">' + ['total','resolved','scheduled','open', ...(totals.closed_other ? ['closed_other'] : [])].map((key) => kpi(key, totals[key])).join('') + '</div>'
    + '<section class="panel progress-box"><div class="row spread"><h2>Progresso geral</h2><strong>' + percent.toLocaleString('pt-BR',{maximumFractionDigits:1})
    + '% concluído</strong></div><progress aria-label="Percentual de pendências resolvidas" max="100" value="' + percent + '"></progress></section>'
    + '<div class="cols dashboard-cols"><section class="panel"><h2>Por assunto</h2><p class="small muted">Total e resolvidas em cada área.</p>'
    + Object.entries(topics).map(([key, n]) => '<a class="topic-row" href="' + route('pendencias', {topic:key,archive:'all'})
      + '"><span class="row spread"><span>' + h(TOPICS[key]) + '</span><small><strong>' + n.total + '</strong> · ' + n.resolved
      + ' resolv.</small></span><span class="bar" aria-hidden="true"><span style="width:' + n.total / max * 100 + '%"><i style="width:'
      + (n.total ? n.resolved / n.total * 100 : 0) + '%"></i></span></span></a>').join('')
    + '</section><section class="panel"><h2>Radar de prioridades</h2><p class="small muted">Atalhos para as pendências em andamento.</p><div class="radar">'
    + radar.map(([label, f]) => '<a href="' + h(route('pendencias', f)) + '"><strong>' + filterTasks(live, f, state.user.uid, today).length + '</strong>' + label + '</a>').join('')
    + '</div><h3 style="margin-top:16px">Prioridade operacional</h3><div class="row">'
    + Object.entries(priorities).map(([k,n]) => go(h(PRIORITIES[k]) + ' · ' + n, route('pendencias',{priority:k,archive:'all'}))).join('') + '</div></section></div>'
    + '<div class="cols">' + queues.map(([title, rows, desc]) => '<section class="panel"><h2>' + h(title) + '</h2>'
      + compact(rows.sort((a,b) => (a.dueDate || 'z').localeCompare(b.dueDate || 'z')).slice(0,4), 'Nenhum item nesta fila.', desc) + '</section>').join('') + '</div>'
    + '<div class="cols"><section class="panel"><h2>Vínculos gerenciais</h2><p class="muted small">Informações relacionadas que podem avançar em paralelo.</p>'
    + dependencies.map((ids) => '<div class="row">' + ids.map((id) => go(id, taskRoute(id), 'ghost')).join('<span aria-hidden="true">→</span>') + '</div>').join('')
    + '</section><section class="panel"><h2>Últimas mudanças</h2><p class="muted small">'
    + (state.previousVisit ? since.length + ' mudança(s) na atividade recente desde a última visita.' : 'Os próximos acessos mostram o que mudou desde esta visita.') + '</p>'
    + (changes.length ? changes.slice(0,3).map((e) => '<p class="wrap"><a href="' + taskRoute(e.taskId) + '">' + h(e.taskId)
      + '</a> · ' + h(e.summary) + '<br><small class="muted">' + h(actorLabel(e, state.names)) + ' · ' + h(dateTime(e.createdAt)) + '</small></p>').join('') : '<p class="muted">Nenhuma alteração após a importação.</p>')
    + go('Ver atividade', route('atividade'), 'ghost') + '</section></div><section class="panel"><h2>Distribuição por situação</h2><div class="row">'
    + Object.entries(statuses).filter(([,n]) => n).map(([k,n]) => go(h(STATUSES[k]) + ' · ' + n, route('pendencias',{statusCode:k,archive:'all'}))).join('')
    + '</div></section>';
}

export function taskList(state, filters) {
  const heads = header('Controle de trabalho', 'Pendências', 'Busque por ID, título ou assunto.',
    state.canEdit ? btn(icon('plus') + ' Nova pendência', 'new-task', 'primary') : '');
  if (!state.tasks) return heads + empty('Carregando pendências…');
  const owners = {};
  for (const t of state.tasks) {
    if (t.ownerUid) owners['uid:' + t.ownerUid] = state.names[t.ownerUid] || t.ownerLabel;
    else if (t.ownerLabel) owners['name:' + t.ownerLabel] = t.ownerLabel + ' (histórico)';
  }
  return heads + '<section class="panel toolbar"><div class="row" aria-label="Filtros rápidos">'
    + go('Minhas pendências', route('pendencias',{owner:'mine'})) + go('Aguardando terceiros', route('pendencias',{view:'waiting'}))
    + go('Próximos 7 dias', route('pendencias',{due:'week'})) + go('Dependem de outra ação', route('pendencias',{view:'blocked'}))
    + '</div><form id="filters" class="toolbar">' + input('Buscar pendências', 'q', filters.q, 'placeholder="Ex.: P11, Naturgy ou reembolso" maxlength="120"', 'search')
    + '<details' + (Object.keys(filters).some((k) => k !== 'q') ? ' open' : '') + '><summary>Filtros combináveis</summary><div class="form-grid">'
    + select('Assunto','topic',TOPICS,filters.topic,'Todos os assuntos') + select('Situação','statusCode',STATUSES,filters.statusCode,'Todas as situações')
    + select('Grupo','group',Object.fromEntries(Object.entries(GROUPS).filter(([k])=>k!=='total')),filters.group,'Todos os grupos')
    + select('Prioridade','priority',PRIORITIES,filters.priority,'Todas as prioridades')
    + select('Responsável','owner',{mine:'Minhas pendências',none:'Sem responsável',...owners},filters.owner,'Todos os responsáveis')
    + select('Prazo','due',{week:'Próximos 7 dias',overdue:'Vencidas',none:'Sem prazo'},filters.due,'Todos os prazos')
    + select('Fila','view',{waiting:'Aguardando terceiros',blocked:'Com bloqueio confirmado',critical:'Prioridade urgente'},filters.view,'Todas as filas')
    + select('Arquivo','archive',{active:'Visíveis',archived:'Arquivadas',all:'Todas'},filters.archive || 'active')
    + '</div></details><div class="row"><button type="submit" class="primary">Aplicar filtros</button>'
    + go('Limpar', route('pendencias'), 'ghost') + '</div></form></section><div id="task-results">'
    + taskResults(state, filters) + '</div>';
}

export function taskResults(state, filters) {
  const tasks = filterTasks(state.tasks || [], filters, state.user.uid);
  const body = Object.entries(TOPICS).map(([key,label]) => {
    const rows = tasks.filter((t) => t.topic === key);
    if (!rows.length) return '';
    return '<section class="task-group"><h2>' + h(label) + ' <small class="muted">· ' + rows.length + '</small></h2>'
      + rows.map((t) => '<a class="task-row" href="' + taskRoute(t.id) + '"><div class="row spread"><span class="kicker">'
        + h(t.id) + (t.archived ? ' · Arquivada' : '') + '</span><span class="row">' + status(t) + priority(t) + '</span></div><h3 class="wrap">'
        + h(t.title) + '</h3><p class="small muted wrap">' + h(t.nextAction) + '</p><small class="muted">'
        + h(t.ownerLabel || 'Sem responsável') + ' · ' + h(dateLabel(t.dueDate)) + '</small></a>').join('') + '</section>';
  }).join('');
  return '<p class="muted small">' + tasks.length + ' pendência(s)</p>' + (body || empty('Nenhum resultado', 'Ajuste a busca ou limpe os filtros.'));
}

export function diffHtml(before, after, names) {
  const items = diff(before, after);
  return items.length ? '<div class="diff">' + items.map(({key, before:b, after:a}) => '<div><strong>' + h(FIELDS[key])
    + '</strong><small class="muted"> · Antes / Depois</small><del>' + h(display(key,b,names)) + '</del><ins>'
    + h(display(key,a,names)) + '</ins></div>').join('') + '</div>' : '<p class="muted">Sem alteração de campos.</p>';
}
const eventKinds = {manual:'Manual', ai_approved:'Sugestão aprovada', initial_import:'Importação inicial'};
const eventOperations = {create:'Criação', update:'Atualização', complete:'Conclusão', correction:'Correção', archive:'Arquivo', split:'Desdobramento'};
export function eventList(events, names, links = true) {
  if (!events?.length) return '<p class="muted">Nenhum evento neste recorte.</p>';
  return '<ol class="plain-list">' + events.map((e) => '<li class="audit"><p><strong class="wrap">' + h(e.summary)
    + '</strong>' + (links ? ' · <a href="' + taskRoute(e.taskId) + '">' + h(e.taskId) + '</a>' : '')
    + '<br><small class="muted">' + h(actorLabel(e, names)) + ' · ' + h(dateTime(e.createdAt)) + ' · ' + h(eventKinds[e.channel]) + '</small></p>'
    + '<details><summary>' + h(eventOperations[e.operation]) + ' · versão ' + h(e.resultVersion) + '</summary>'
    + diffHtml(e.before, e.after, names) + (e.transcript ? '<p class="wrap"><strong>Texto incluído pelo autor</strong><br>' + h(e.transcript) + '</p>' : '')
    + '</details></li>').join('') + '</ol>';
}

export function detail(state, task) {
  if (!task) return go(icon('back') + ' Pendências', route('pendencias'), 'ghost')
    + empty(state.detailLoading ? 'Carregando pendência…' : 'Pendência indisponível', state.detailError || 'Confira o ID e seu acesso.');
  const rows = [
    ['Situação', status(task)], ['Prioridade', priority(task)], ['Responsável', h(state.names[task.ownerUid] || task.ownerLabel || 'Sem responsável')],
    ['Prazo', h(dateLabel(task.dueDate))], ['Fonte', h(SOURCES[task.sourceType])],
    ...(task.amountApproxBRL == null ? [] : [['Valor informado',h((task.amountIsExact ? '' : 'Aproximado · ') + money(task.amountApproxBRL))]]),
    ...(task.protocolText ? [['Protocolo interno',h(task.protocolText)]] : []),
    ...(task.contactText ? [['Contato institucional',h(task.contactText)]] : []),
    ...(task.tags ? [['Tags',h(task.tags)]] : [])
  ];
  const links = (ids) => ids?.length ? '<div class="row">' + ids.map((id) => go(h(id), taskRoute(id))).join('') + '</div>'
    : '<p class="muted small">Nenhum registrado.</p>';
  return '<div>' + go(icon('back') + ' Pendências', route('pendencias'), 'ghost') + '</div>'
    + header(task.id + ' · ' + TOPICS[task.topic], task.title, task.archived ? 'Pendência arquivada' : '',
      state.canEdit ? btn('Editar', 'edit-task', 'primary') + btn(task.archived ? 'Restaurar' : 'Arquivar', 'archive-task') : '')
    + '<section class="panel stack"><div class="next-action"><h2>Próxima ação</h2><p class="wrap">' + h(task.nextAction) + '</p></div><dl class="task-meta">'
    + rows.map(([name,value]) => '<div><dt>' + h(name) + '</dt><dd>' + value + '</dd></div>').join('') + '</dl>'
    + '<div><h2>Contexto</h2><p class="wrap">' + h(task.description || 'Sem descrição adicional.') + '</p></div>'
    + '<div><h2>Fonte e ressalvas</h2><p class="wrap">' + h(task.sourceNote || 'Nenhuma ressalva registrada.') + '</p></div></section>'
    + '<div class="cols"><section class="panel"><h2>Vínculos gerenciais</h2><p class="muted small">Use estas referências para acompanhar providências relacionadas.</p>'
    + links(task.relatedTaskIds) + '</section><section class="panel"><h2>Bloqueios confirmados</h2>' + links(task.blockedByIds)
    + '</section></div><section class="panel"><h2>Histórico</h2><p class="muted small">Versão ' + h(task.version) + ' · ' + h(dateTime(task.updatedAt)) + '</p>'
    + (state.detailHistoryError ? '<p class="banner error">' + h(state.detailHistoryError) + '</p>' : state.detailEvents
      ? eventList(state.detailEvents, state.names, false) : '<p role="status">Carregando histórico…</p>')
    + (state.moreDetail ? btn('Carregar eventos anteriores','older-detail') : '') + '</section>';
}

export function activity(state) {
  const filters = state.activityFilters;
  const term = normalize(filters.q).trim();
  const events = (state.events || []).filter((e) => (!filters.actor || e.actorUid === filters.actor) && (!term
    || normalize([e.taskId,e.summary,e.after?.title,actorLabel(e,state.names),eventKinds[e.channel]].join(' ')).includes(term)));
  const names = Object.fromEntries((state.events || []).map((e) => [e.actorUid, actorLabel(e,state.names)]));
  return header('Registro de trabalho', 'Atividade', 'Consulte autoria, data e o antes e depois de cada mudança.')
    + '<section class="panel stack"><form id="activity-filters" class="form-grid">'
    + input('Buscar por ID ou alteração','q',filters.q,'maxlength="100"','search')
    + select('Autor','actor',names,filters.actor,'Todos os autores') + '<div class="wide"><button type="submit" class="primary">Filtrar atividade</button></div></form>'
    + (state.eventsError ? '<p class="banner error">' + h(state.eventsError) + '</p>' : state.events
      ? eventList(events,state.names) : '<p role="status">Carregando atividade…</p>')
    + (state.moreEvents ? '<div>' + btn('Carregar eventos anteriores', 'older-events') + '</div>' : '') + '</section>';
}
