
import { TASK_ID, normalize } from './model.js';

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
