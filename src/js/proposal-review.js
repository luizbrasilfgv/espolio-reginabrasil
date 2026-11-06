
import { diff } from './model.js';

const linkFields = ['relatedTaskIds','blockedByIds'];
const operationFor = (item,base,values) => {
  if (item.operation === 'split' || !base) return item.operation;
  if (values.statusCode !== base.statusCode) {
    if (values.statusCode === 'resolvido') return 'complete';
    if (values.statusCode === 'cancelado') return 'cancel';
    if (base.statusCode === 'resolvido') return 'reopen';
  }
  return item.operation === 'correct' ? 'correct' : 'update';
};

export function reviewItems(proposals) {
  return proposals.flatMap((item) => {
    if (!item.base || !item.values || item.operation === 'split') return [item];
    const changes = diff(item.base,item.values);
    const details = changes.filter(({key}) => !linkFields.includes(key));
    const links = changes.filter(({key}) => linkFields.includes(key));
    if (!links.length) return [item];
    const parts = details.length ? [{...item,values:{...item.base,...Object.fromEntries(details.map(({key,after}) => [key,after]))}}] : [];
    for (const {key,before,after} of links) {
      const added = after.filter((id) => !before.includes(id));
      const removed = before.filter((id) => !after.includes(id));
      for (const id of [...added,...removed]) {
        const remove = removed.includes(id);
        const value = remove ? before.filter((linked) => linked !== id) : [...before,id];
        const relation = key === 'blockedByIds' ? 'dependência operacional' : 'vínculo gerencial';
        const reason = (remove ? 'Remover ' : 'Registrar ') + relation + ' com ' + id + '.';
        parts.push({...item,operation:'update',reviewLabel:reason.slice(0,-1),reason,userReason:'',
          values:{...item.base,[key]:value}});
      }
    }
    return parts;
  });
}

export function rebaseReview(item, latest) {
  if (!item.base || !latest) return null;
  const patch = {};
  for (const {key,before,after} of diff(item.base,item.values)) {
    const current = latest[key];
    if (linkFields.includes(key)) {
      const removed = new Set(before.filter((id) => !after.includes(id)));
      const added = after.filter((id) => !before.includes(id));
      patch[key] = [...new Set([...current.filter((id) => !removed.has(id)),...added])];
      if (patch[key].length > 10) return null;
    } else {
      if (JSON.stringify(current ?? null) !== JSON.stringify(before)) return null;
      patch[key] = after;
    }
  }
  const values = {...latest,...patch};
  return {...item,base:latest,values,operation:operationFor(item,latest,values)};
}

export function editedReview(item, base, values) {
  return {...item,base,values,operation:operationFor(item,base,values)};
}
