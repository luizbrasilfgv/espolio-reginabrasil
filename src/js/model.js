export const TOPICS = {
  imovel_contas: 'Imóvel e contas', juridico_patrimonio: 'Jurídico e patrimônio',
  bancos_financas: 'Bancos e finanças', funeral_cinzas: 'Funeral e cinzas',
  saude_reembolsos: 'Saúde e reembolsos', documentos_inss: 'Documentos e INSS',
  outros_contratos: 'Outros contratos'
};
export const PRIORITIES = {
  urgente: 'Urgente', proximos_dias: 'Próximos dias', proximas_semanas: 'Próximas semanas'
};
export const PREFIXES = { urgente: 'U', proximos_dias: 'P', proximas_semanas: 'S' };
export const STATUSES = {
  nao_iniciado: 'Não iniciado', nao_confirmado: 'Não confirmado', a_conferir: 'A conferir',
  a_investigar: 'A investigar', em_andamento: 'Em andamento', em_analise: 'Em análise',
  aguardando_escritorio: 'Aguardando escritório', aguardando_riopax: 'Aguardando RioPax',
  aguardando_resposta: 'Aguardando resposta', pagamento_pendente: 'Pagamento pendente',
  decisao_futura: 'Decisão futura', agendado: 'Agendado', resolvido: 'Resolvido', cancelado: 'Cancelado'
};
export const SOURCES = {
  documento: 'Documento', relato_familiar: 'Relato familiar', resposta_terceiro: 'Resposta de terceiro',
  inferencia_ia: 'Inferência da IA', indefinido: 'A confirmar'
};
export const GROUPS = { total: 'Total sem canceladas', open: 'Em aberto', scheduled: 'Agendadas', resolved: 'Resolvidas', closed_other: 'Canceladas' };
const groupFilters = {
  total: (task) => group(task) !== 'closed_other',
  pending: (task) => !closed(task)
};
export const ROLES = { admin: 'Administrador', editor: 'Editor', viewer: 'Leitor' };
export const ACCESS = { active: 'Ativo', suspended: 'Suspenso', revoked: 'Revogado' };
export const FIELDS = {
  title: 'Título', topic: 'Assunto', priority: 'Prioridade', statusCode: 'Situação',
  ownerUid: 'Responsável cadastrado', ownerLabel: 'Responsável', description: 'Descrição',
  nextAction: 'Próxima ação', dueDate: 'Prazo', relatedTaskIds: 'Vínculos gerenciais',
  blockedByIds: 'Bloqueios confirmados', protocolText: 'Protocolo interno', contactText: 'Contato institucional',
  amountApproxBRL: 'Valor informado', amountIsExact: 'Valor exato', sourceType: 'Fonte',
  sourceNote: 'Ressalvas e contexto', archived: 'Arquivada', tags: 'Tags'
};
export const EMPTY = {
  title: '', topic: 'imovel_contas', priority: 'proximos_dias', statusCode: 'nao_iniciado',
  ownerUid: null, ownerLabel: null, description: '', nextAction: '', dueDate: null,
  relatedTaskIds: [], blockedByIds: [], protocolText: null, contactText: null,
  amountApproxBRL: null, amountIsExact: false, sourceType: 'indefinido', sourceNote: '', archived: false, tags: ''
};
export const TASK_ID = /^[UPS](0[1-9]|[1-9][0-9]{1,5})$/;
export const normalize = (value = '') => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const group = ({statusCode}) => ({resolvido: 'resolved', agendado: 'scheduled', cancelado: 'closed_other'})[statusCode] ?? 'open';
export const closed = (task) => ['resolved','closed_other'].includes(group(task));
export const thirdParty = (task) => task.statusCode.startsWith('aguardando_');
export const localDate = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date);
export const plusDays = (iso, days) => {
  const date = new Date(iso + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export const dateLabel = (iso) => iso ? iso.split('-').reverse().join('/') : 'Sem prazo confirmado';
export const money = (amount) => new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format(amount);
export function dateTime(timestamp) {
  if (!timestamp) return '—';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return new Intl.DateTimeFormat('pt-BR', {dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo'}).format(date);
}
export function display(key, value, names = {}) {
  if (value == null || value === '') return '—';
  if (key === 'ownerUid') return names[value] ?? 'Membro cadastrado';
  if (key === 'dueDate') return dateLabel(value);
  if (key === 'amountApproxBRL') return money(value);
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value)) return value.join(', ') || '—';
  const choices = {topic: TOPICS, priority: PRIORITIES, statusCode: STATUSES, sourceType: SOURCES};
  return choices[key]?.[value] ?? String(value);
}
export function diff(before, after) {
  return Object.keys(FIELDS).filter((key) => !equal(before?.[key] ?? null, after?.[key] ?? null))
    .map((key) => ({ key, before: before?.[key] ?? null, after: after?.[key] ?? null }));
}
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === value;
}
export function sensitive(value) {
  return /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b(?:pix|cpf|conta bancária|agência bancária)\s*[:#-]?\s*[\w@+.-]{5,}/iu.test(value);
}
export function validateTask(input, id, knownIds) {
  const clean = {};
  const lengths = {
    title: 140, ownerLabel: 100, description: 2400, nextAction: 1000, sourceNote: 2000,
    protocolText: 250, contactText: 250, tags: 200
  };
  for (const [key, length] of Object.entries(lengths)) {
    const value = input[key];
    const nullable = ['ownerLabel','protocolText','contactText'].includes(key);
    if (nullable && !value) { clean[key] = null; continue; }
    if (typeof value !== 'string' || value.length > length) throw Error('Confira o campo ' + FIELDS[key] + '.');
    clean[key] = value.trim();
  }
  if (!clean.title || !clean.nextAction) throw Error('Preencha o título e a próxima ação.');
  for (const [key, options] of Object.entries({topic: TOPICS, priority: PRIORITIES, statusCode: STATUSES, sourceType: SOURCES})) {
    if (!Object.hasOwn(options, input[key])) throw Error('Escolha uma opção válida em ' + FIELDS[key] + '.');
    clean[key] = input[key];
  }
  clean.dueDate = input.dueDate || null;
  if (clean.dueDate && !validDate(clean.dueDate)) throw Error('Informe uma data válida.');
  for (const key of ['relatedTaskIds','blockedByIds']) {
    const ids = input[key];
    if (!Array.isArray(ids) || ids.length > 10 || new Set(ids).size !== ids.length
      || ids.some((value) => !TASK_ID.test(value) || value === id || (knownIds && !knownIds.has(value)))) {
      throw Error(FIELDS[key] + ' deve conter até 10 IDs existentes, sem repetir o item atual.');
    }
    clean[key] = ids;
  }
  clean.ownerUid = input.ownerUid || null;
  if (clean.ownerUid && (typeof clean.ownerUid !== 'string' || clean.ownerUid.length > 128 || !clean.ownerLabel)) throw Error('Responsável inválido.');
  clean.amountApproxBRL = input.amountApproxBRL ?? null;
  if (clean.amountApproxBRL !== null && (!Number.isFinite(clean.amountApproxBRL) || clean.amountApproxBRL < 0
    || clean.amountApproxBRL > 1e9)) throw Error('Informe um valor entre zero e R$ 1 bilhão.');
  clean.amountIsExact = clean.amountApproxBRL !== null && input.amountIsExact === true;
  clean.archived = input.archived === true;
  return clean;
}
export function aggregate(tasks) {
  const totals = {total: 0, resolved: 0, scheduled: 0, open: 0, closed_other: 0};
  const topics = Object.fromEntries(Object.keys(TOPICS).map((k) => [k, {total: 0, resolved: 0}]));
  const priorities = Object.fromEntries(Object.keys(PRIORITIES).map((k) => [k, 0]));
  const statuses = Object.fromEntries(Object.keys(STATUSES).map((k) => [k, 0]));
  for (const task of tasks) {
    const kind = group(task);
    totals[kind]++;
    statuses[task.statusCode]++;
    if (kind === 'closed_other') continue;
    totals.total++;
    topics[task.topic].total++;
    if (kind === 'resolved') topics[task.topic].resolved++;
    priorities[task.priority]++;
  }
  return {totals, topics, priorities, statuses, percent: totals.total ? 100 * totals.resolved / totals.total : 0};
}
export function filterTasks(tasks, filters, uid, today = localDate()) {
  const term = normalize(filters.q).trim();
  const matchesGroup = Object.hasOwn(groupFilters, filters.group)
    ? groupFilters[filters.group] : (task) => group(task) === filters.group;
  return tasks.filter((task) => {
    if ((filters.archive || 'active') === 'active' && task.archived) return false;
    if (filters.archive === 'archived' && !task.archived) return false;
    if (filters.group && !matchesGroup(task)) return false;
    for (const key of ['topic','priority','statusCode']) if (filters[key] && task[key] !== filters[key]) return false;
    if (filters.owner === 'mine' && task.ownerUid !== uid) return false;
    if (filters.owner === 'none' && (task.ownerUid || task.ownerLabel)) return false;
    if (filters.owner?.startsWith('uid:') && task.ownerUid !== filters.owner.slice(4)) return false;
    if (filters.owner?.startsWith('name:') && task.ownerLabel !== filters.owner.slice(5)) return false;
    if (filters.due === 'overdue' && (!task.dueDate || task.dueDate >= today || closed(task))) return false;
    if (filters.due === 'week' && (!task.dueDate || task.dueDate < today || task.dueDate > plusDays(today, 7) || closed(task))) return false;
    if (filters.due === 'none' && task.dueDate) return false;
    if (filters.view === 'waiting' && (!thirdParty(task) || closed(task))) return false;
    if (filters.view === 'blocked' && (!task.blockedByIds.some((id) => !tasks.some((other) => other.id === id && closed(other))) || closed(task))) return false;
    if (filters.view === 'critical' && (task.priority !== 'urgente' || closed(task))) return false;
    if (!term) return true;
    if (TASK_ID.test(term.toUpperCase())) return task.id === term.toUpperCase();
    return normalize([task.id, task.title, task.description, task.nextAction, task.ownerLabel, task.tags, task.sourceNote,
      TOPICS[task.topic]].join(' ')).includes(term);
  }).sort((a, b) => a.id.localeCompare(b.id, 'pt-BR', {numeric:true}));
}
