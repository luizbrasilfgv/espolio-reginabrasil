import { TOPICS, PRIORITIES, STATUSES, group, localDate, plusDays, normalize } from './model.js';
export function shareText(tasks, today = localDate()) {
  const lines = ['*Espólio Regina Brasil — resumo semanal*', 'Situação registrada no painel familiar.'];
  const through = plusDays(today,7);
  const inProgress = new Set(['em_andamento','em_analise','aguardando_escritorio','aguardando_riopax','aguardando_resposta']);
  for (const [key,label] of Object.entries(TOPICS)) {
    const rows = tasks.filter((t) => t.topic === key && !t.archived);
    if (!rows.length) continue;
    const resolved = rows.filter((t) => group(t) === 'resolved');
    const scheduled = rows.filter((t) => group(t) === 'scheduled');
    const open = rows.filter((t) => group(t) === 'open');
    const ongoing = open.filter((t) => inProgress.has(t.statusCode));
    const immediate = open.filter((t) => t.priority === 'urgente' || (t.dueDate && t.dueDate <= through));
    const ids = (items) => items.map((task) => task.id).join(', ');
    lines.push('', '*' + label + '*');
    if (resolved.length) lines.push('Resolvidas no controle: ' + ids(resolved));
    if (scheduled.length) lines.push('Agendadas: ' + ids(scheduled));
    if (ongoing.length) lines.push('Em andamento ou aguardando: ' + ids(ongoing));
    if (immediate.length) lines.push('Pendências imediatas: ' + ids(immediate));
    if (open.length) lines.push('Total em aberto: ' + open.length);
  }
  return lines.join('\n');
}
function redact(text, internal = []) {
  let result = text || '';
  for (const value of internal.filter(Boolean)) {
    const pieces = value.split(/[\n;,]/).map((v) => v.trim()).filter((v) => v.length > 3);
    for (const part of pieces) result = result.split(part).join('[omitido]');
  }
  if (/\b(cpf|pix|endere[cç]o|conta banc[áa]ria|ag[êe]ncia banc[áa]ria|cart[ãa]o de cr[ée]dito)\b/i.test(normalize(result))) {
    return '[consulte a ação no painel privado]';
  }
  return result.replace(/\bhttps?:\/\/\S+|[\w.+-]+@[\w.-]+\.\w+|(?:\+?\d[\d ()./-]{5,}\d)|R\$\s*[\d.,]+|\b\d{5,}\b/giu, '[omitido]');
}
function publicRows(tasks) {
  return tasks.map((t) => ({
    id:t.id, assunto:TOPICS[t.topic], prioridade:PRIORITIES[t.priority], situacao:STATUSES[t.statusCode],
    responsavel:t.ownerUid || t.ownerLabel ? 'Atribuído no painel' : 'Sem responsável',
    proxima_acao:redact(t.nextAction,[t.contactText,t.protocolText,t.ownerLabel]),
    vencimento:t.dueDate || null, atualizado_em:t.updatedAt?.toDate?.().toISOString() ?? null, arquivada:t.archived
  }));
}
export const exportJSON = (tasks) => JSON.stringify({schemaVersion:1, exportedAt:new Date().toISOString(), tasks:publicRows(tasks)},null,2);
const cell = (value) => {
  const text = String(value ?? '');
  return '"' + (/^\s*[=+@\-\t\r]/.test(text) ? "'" : '') + text.replaceAll('"','""') + '"';
};
export function exportCSV(tasks) {
  const fields = ['id','assunto','prioridade','situacao','responsavel','proxima_acao','vencimento','atualizado_em','arquivada'];
  return '\ufeff' + [fields.join(';'),...publicRows(tasks).map((row) => fields.map((k) => cell(row[k])).join(';'))].join('\r\n');
}
export function download(data, type, name) {
  const url = URL.createObjectURL(new Blob([data],{type}));
  const a = Object.assign(document.createElement('a'),{href:url,download:name});
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
