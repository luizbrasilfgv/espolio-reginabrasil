
import { TASK_ID, TOPICS, normalize } from './model.js';

const generic = new Set(('para com junto mesma mesmo cada sobre pelo pela esse essa este esta meus minhas voce agora depois ' +
  'pendencia tarefa conta cobranca pagamento pagar retirar guia fatura documento documentos processo parte caso ficou fazer ' +
  'feita feito separado separada avulso avulsa informe verificar confirmar levantar nao sentido faz ter manter pode precisa').split(' '));

function terms(text) {
  return new Set((normalize(text).match(/[a-z][a-z0-9]{2,}/g) || [])
    .filter((word) => !generic.has(word))
    .map((word) => word.replace(/(?:oes|ao)$/,'ao').replace(/s$/,'')));
}

export function matchLocalTasks(phrase, tasks) {
  const ids = (normalize(phrase).match(/\b[ups]\s*\d{2,6}\b/g) || []).map((id) => id.replace(/\s/g,'').toUpperCase()).filter((id) => TASK_ID.test(id));
  if (ids.length) return tasks.filter((task) => ids.includes(task.id));
  const spoken = terms(phrase);
  const matches = tasks.map((task) => {
    const title = terms(task.title);
    const matched = [...title].filter((word) => spoken.has(word));
    return {task,score:matched.length,coverage:matched.length / (title.size || 1)};
  }).filter(({score,coverage}) => score >= 2 || score === 1 && coverage >= .5)
    .sort((a,b) => b.score - a.score || b.coverage - a.coverage);
  const best = matches[0];
  return best ? matches.filter(({score,coverage}) => score === best.score && coverage === best.coverage).map(({task}) => task) : [];
}

const searchActions = [
  [['avisar','notificar','comunicar','informar'], /\b(?:avisa\w*|aviso|notific\w*|comunic\w*|informar)\b/],
  [['enviar','mandar','entregar','encaminhar'], /\b(?:envi\w*|entreg\w*|encaminh\w*)\b/],
  [['pedir','solicitar','requerer'], /\b(?:pedir|solicit\w*|requer\w*|requisic\w*)\b/],
  [['pagar','quitar','liquidar'], /\b(?:pagar|pagamento|quit\w*|liquid\w*)\b/]
];
const searchStop = new Set('ainda agora hoje gente minha meu dele dela vai vou vamos preciso precisamos somente apenas'.split(' '));
const actionBoundary = /[.!?;\n,]|\s+(?:mas|porem|se|caso|depois|enquanto|porque|quando|a nao ser que|e (?:nao|a gente|vamos|vou|preciso))\b/;
const negatedAction = /\b(?:nao|nem|se)(?:\s+(?:vou|vai|vamos|quer|quero|precisa|precisamos|pretendo|pretendemos|devo|deve|ter que|tem que))*\s*$/;

function matchesSearchVerb(word, verb) {
  if (word === verb) return true;
  if (word.length < 7 || word.length + 1 !== verb.length) return false;
  // Tolerate one omitted interior letter when finding links, never when proposing a write.
  const mismatch = [...word].findIndex((letter,index) => letter !== verb[index]);
  return mismatch > 0 && word.slice(mismatch) === verb.slice(mismatch + 1);
}

export function relatedTaskMatches(text, tasks) {
  const report = normalize(text);
  const intents = [...report.matchAll(/\b[a-z]{5,}\b/g)].flatMap((match) => {
    const action = searchActions.find(([verbs]) => verbs.some((verb) => matchesSearchVerb(match[0],verb)));
    if (!action || negatedAction.test(report.slice(Math.max(0,match.index - 55),match.index))) return [];
    const object = report.slice(match.index + match[0].length).split(actionBoundary,1)[0].trim();
    const subject = [...terms(object.split(/\s+/).slice(0,8).join(' '))].filter((word) => !searchStop.has(word));
    return subject.length ? [{registered:action[1],subject}] : [];
  });
  const ranked = tasks.flatMap((task) => {
    if (task.archived || ['resolvido','cancelado'].includes(task.statusCode)) return [];
    const actionText = normalize([task.title,task.nextAction].join(' '));
    const heading = terms([task.title,TOPICS[task.topic]].join(' '));
    const details = terms([task.description,task.nextAction].join(' '));
    const score = Math.max(0,...intents.map(({registered,subject}) => registered.test(actionText)
      ? subject.reduce((total,word) => total + (heading.has(word) ? 3 : details.has(word) ? 1 : 0),0) : 0));
    return score ? [{task,score}] : [];
  });
  return ranked.sort((a,b) => b.score - a.score).map(({task}) => task);
}

export const unnecessary = /\b(?:nao faz sentido (?:ter|manter|deixar|abrir|criar)|nao (?:ha|tem|existe) (?:uma )?(?:conta|cobranca|fatura|pendencia|tarefa) (?:separada|individual|avulsa)|nao (?:precisa|precisamos) (?:mais )?(?:de|manter|ter|abrir|acompanhar)|(?:pode|podemos) (?:tirar|descartar|cancelar)|(?:deixou de ser|ficou) desnecessari[oa]|fica redundante)\b/;
const uncertain = /\b(?:acho que|talvez|sera que|nao sei|verificar se|conferir se|confirmar se|precisamos confirmar|caso)\b/;
const planned = /\b(?:vou|vamos|vai|irao|falta|preciso|precisamos|tenho que)\b/;
const negativeRelation = /\b(?:nao|nem)\s+(?:ja\s+)?(?:vem|vinha|vai|sai|consta|entra|inclui|cobre|(?:ta|esta|fica|e|era)\s+(?:junt\w*|inclus\w*|incluid\w*|embutid\w*|dentro|cobrad\w*))\b/;
const noCancel = /\bnao (?:pode|podemos) (?:tirar|descartar|cancelar)\b/;

function withoutIdDoubt(clause) {
  return clause.replace(/\bacho que e\s+(?:a\s*)?[ups]\s*\d{2,6}\b/g,'');
}

export function incorporatedIn(clause) {
  const statement = withoutIdDoubt(clause);
  if (/^se\b/.test(statement) || uncertain.test(statement) || negativeRelation.test(statement)) return null;
  const forward = /\b(?:vem(?:\s+cobrad\w*)?|sai|consta|entra|fica|faz parte|junt\w*|inclus\w*|incluid\w*|embutid\w*|cobrad\w*|tratad\w*|cobert\w*|dentro)\s+(?:junt\w*\s+)?(?:com|no|na|pelo|pela|ao|do|da|dentro do|dentro da)\s+/.exec(statement);
  const reverse = /\b(?:inclui|engloba|cobre|ja tem|ja cobra)\s+/.exec(statement);
  const relation = forward || reverse;
  if (!relation || relation.index === 0) return null;
  const left = statement.slice(0,relation.index);
  if (/\b(?:vai|iria|pode|deve)\s+(?:vir|entrar|ser|estar|ficar)\b/.test(left)) return null;
  const right = statement.slice(relation.index + relation[0].length).split(/\b(?:entao|portanto|por isso|logo|ou seja)\b/)[0];
  return {subject:forward ? left : right,reference:forward ? right : left,unnecessary:unnecessary.test(statement) && !noCancel.test(statement)};
}

export function generalTaskStatus(clause, task) {
  if (uncertain.test(withoutIdDoubt(clause)) || /^se\b/.test(clause)) return null;
  if (unnecessary.test(clause) && !noCancel.test(clause)) return 'cancelado';
  if (planned.test(clause) || /\b(?:nao|nem)\s+(?:resolvi|conclui|finalizei|terminei|paguei|quitei|foi|esta|iniciei|comecei)\b/.test(clause)) return null;
  if (/\b(?:resolvi|conclui|finalizei|terminei|(?:ja foi|ja esta) (?:resolvid[oa]|concluid[oa]|finalizad[oa]))\b/.test(clause)) return 'resolvido';
  if (/\b(?:paguei|quitei|(?:ja )?foi pag[oa]|ja esta pag[oa]|fiz o pagamento)\b/.test(clause)
    && /\b(?:pagamento|pagar|fatura|taxa|guia|boleto|tributo)\b/.test(normalize(task.title))) return 'resolvido';
  if (/\b(?:iniciei|comecei|em andamento|dei entrada)\b/.test(clause)) return 'em_andamento';
  return null;
}

const limitedNotice = /\b(?:so|somente|apenas)\s+(?:(?:vamos|vou|vai)\s+)?(?:avisar|notificar|comunicar)\s+(.{2,100}?)\s*,?\s+se\s+(?:isso\s+se\s+)?/;
const missingNotice = /^(?:(.{1,70}?)\s+)?nao\s+(?:tiver(?:em)?\s+sido|tenha(?:m)?\s+sido|foi|foram)\s+(?:avisad|notificad|comunicad)[oa]s?\b/;
const collective = /^(?:(?:aos?|as?|os?)\s+)?(?:bancos|instituicoes|empresas|orgaos|fornecedores|escritorios|cartorios)$/;
const recipientTypes = new Set('banco instituicao empresa orgao fornecedor escritorio cartorio'.split(' '));
const directNotice = /^(?:Avisar|Comunicar|Notificar)\b.+?(?=\s+e\s+(?:solicitar|verificar|pedir|conferir|confirmar|levantar|acompanhar)\b|[.;]|$)/iu;

function withNoticeCheck(task, verification) {
  if (task.nextAction.startsWith(verification)) return task.nextAction;
  const step = directNotice.exec(task.nextAction);
  if (!step) return null;
  const rest = task.nextAction.slice(step[0].length).replace(/^(?:\s+e\s+|[.;]\s*)/iu,'').trim();
  const instruction = step[0].charAt(0).toLowerCase() + step[0].slice(1);
  const nextAction = verification + ' Se ainda não foi feita, ' + instruction + '.'
    + (rest ? ' ' + rest.charAt(0).toUpperCase() + rest.slice(1) : '');
  return nextAction.length <= 1000 ? nextAction : null;
}

export function conditionalNoticeChoices(clause, original, tasks) {
  const condition = /^se\s+(o|a)\s+([a-z]+(?:\s+[a-z]+){0,4}?)\s+(?:ainda\s+)?nao\s+(?:avisou|comunicou|notificou)[,\s]+(?:(?:a gente|nos)\s+)?(?:vai|vamos|iremos)\s+(?:avisar|comunicar|notificar)\b/.exec(clause);
  if (!condition) return [];
  const start = clause.indexOf(condition[2],condition[1].length + 4);
  const issuer = original.slice(start,start + condition[2].length);
  const verification = 'Confirmar se a comunicação já foi feita ' + (condition[1] === 'o' ? 'pelo ' : 'pela ') + issuer + '.';
  return tasks.flatMap((task) => {
    const nextAction = withNoticeCheck(task,verification);
    return nextAction && nextAction !== task.nextAction ? [{task,nextAction}] : [];
  });
}

export function conditionalNotifications(clause, original, tasks, prior = '') {
  const action = limitedNotice.exec(clause);
  if (!action) return null;
  const context = clause.slice(0,action.index);
  if (/\b(?:nao|talvez)(?:\s+(?:vamos|vai|vou))?\s*$/.test(context)) return null;
  const after = action.index + action[0].length;
  const condition = missingNotice.exec(clause.slice(after));
  if (!condition) return null;
  const subject = (condition[1] || '').replace(/\b(?:ja|ainda)\b/g,'').trim();
  const withoutArticle = (value) => value.trim().replace(/^(?:aos?|as?|os?)\s+/,'');
  if (subject && !/^(?:eles?|elas?)$/.test(subject) && withoutArticle(subject) !== withoutArticle(action[1])) return null;

  const source = /^\s*(?:automaticamente\s+|previamente\s+)?(?:via|por|pel[oa]s?)\s+(.+?)(?:\s+ne\b|$)/.exec(clause.slice(after + condition[0].length));
  const label = source?.[1].trim().replace(/^(?:o|a|os|as)\s+/,'');
  const from = label ? clause.indexOf(label,after + condition[0].length) : -1;
  const issuer = from >= 0 && original.length === clause.length ? original.slice(from,from + label.length) : label;
  const verification = 'Confirmar se a comunicação já foi feita' + (issuer ? ' por ' + issuer : '') + '.';
  const scope = collective.test(action[1].trim()) ? prior + ' ' + context : action[1];
  const spoken = terms(scope);
  const ids = new Set((normalize(scope).match(/\b[ups]\s*\d{2,6}\b/g) || []).map((id) => id.replace(/\s/g,'').toUpperCase()));

  return tasks.flatMap((task) => {
    const [recipient, subject] = task.title.split(/\s+[—–]\s+/);
    const names = [...terms(recipient)].filter((word) => !recipientTypes.has(word));
    const nameMatch = subject && names.length && names.every((word) => spoken.has(word));
    if (!ids.has(task.id) && !nameMatch) return [];
    const nextAction = withNoticeCheck(task,verification);
    return nextAction ? [{task,nextAction}] : [];
  });
}
