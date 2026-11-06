import { normalize, validateTask } from './model.js';

const stop = new Set(['com','das','dos','para','pela','pelo','uma','sobre']);
const titleText = (title) => normalize(title).replace(/[^a-z0-9]+/g,' ').trim();
const terms = (text) => new Set(text.split(' ').filter((word) => word.length >= 3 && !stop.has(word)));
export const pairKey = (a,b) => [a.id,b.id].sort().join(':');

export function findDuplicatePairs(tasks, ignored) {
  const entries = tasks.filter((task) => !task.archived && task.statusCode !== 'cancelado').map((task) => {
    const title = titleText(task.title);
    const action = titleText(task.nextAction);
    return {task,title,words:terms(title),action,actionSize:terms(action).size};
  });
  const pairs = [];
  for (const [index,left] of entries.entries()) {
    for (let next = index + 1; next < entries.length; next++) {
      const right = entries[next];
      const key = pairKey(left.task,right.task);
      if (ignored.has(key)) continue;
      const shared = [...left.words].filter((word) => right.words.has(word)).length;
      const exact = left.title && left.title === right.title;
      const sameTopic = left.task.topic === right.task.topic;
      const similar = sameTopic && shared >= 3 && shared / Math.max(left.words.size,right.words.size) >= .75;
      const sameAction = sameTopic && shared >= 1 && left.actionSize >= 5 && left.action === right.action;
      if (exact || similar || sameAction) pairs.push({left:left.task,right:right.task,key,
        reason:exact ? 'Títulos iguais' : similar ? 'Títulos semelhantes' : 'Mesma próxima ação e assunto em comum'});
    }
  }
  return pairs;
}

export function mergedTaskValues(primary, duplicate, tasks) {
  if (duplicate.blockedByIds.length || tasks.some((task) =>
    !task.archived && task.id !== duplicate.id && task.blockedByIds.includes(duplicate.id))) {
    throw Error('A duplicada tem vínculos operacionais. Revise os bloqueios nas pendências antes de unificar.');
  }
  const values = {...primary};
  for (const field of ['description','nextAction','sourceNote','tags']) {
    const left = (primary[field] || '').trim();
    const right = (duplicate[field] || '').trim();
    if (!left) values[field] = right;
    else if (right && normalize(left) !== normalize(right)) values[field] = left + '\n' + right;
  }
  for (const field of ['dueDate','contactText','protocolText']) {
    if (!values[field]) values[field] = duplicate[field];
  }
  if (!values.ownerUid && !values.ownerLabel) {
    values.ownerUid = duplicate.ownerUid;
    values.ownerLabel = duplicate.ownerLabel;
  }
  if (values.amountApproxBRL == null) {
    values.amountApproxBRL = duplicate.amountApproxBRL;
    values.amountIsExact = duplicate.amountIsExact;
  }
  values.relatedTaskIds = [...new Set([...primary.relatedTaskIds,...duplicate.relatedTaskIds])]
    .filter((id) => id !== primary.id && id !== duplicate.id);
  return validateTask(values,primary.id,new Set(tasks.map(({id}) => id)));
}
