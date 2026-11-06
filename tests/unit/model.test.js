import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EMPTY, aggregate, validateTask, filterTasks } from '../../src/js/model.js';
import { exportJSON, exportCSV, shareText } from '../../src/js/exports.js';
const original = JSON.parse(await readFile(new URL('../fixtures/tasks.json',import.meta.url),'utf8'));
const ids = new Set(original.map((t) => t.id));
const seed = original.map((t) => ({id:t.id,...validateTask({...EMPTY,...t},t.id,ids)}));
const get = (id) => seed.find((t) => t.id === id);

test('seed completo, estados distintos e distribuição exata',() => {
  assert.equal(ids.size,34);
  assert.equal(seed.length,34);
  const a = aggregate(seed);
  assert.deepEqual(a.totals,{total:34,resolved:3,scheduled:1,open:30,closed_other:0});
  assert.deepEqual(a.priorities,{urgente:10,proximos_dias:13,proximas_semanas:11});
  assert.deepEqual(Object.values(a.topics).map((t) => t.total),[9,7,6,5,3,2,2]);
  assert.deepEqual(seed.filter((t) => t.statusCode === 'resolvido').map((t) => t.id),['P02','P03','P12']);
  assert.deepEqual(seed.filter((t) => t.statusCode === 'agendado').map((t) => t.id),['U10']);
  assert.equal(get('U08').amountApproxBRL,null);
  assert.match(get('U08').nextAction,/1\.500/);
  assert.equal(get('U08').dueDate,'2026-11-10');
  assert.equal(get('P12').amountApproxBRL,250);
  assert.equal(get('P12').amountIsExact,false);
  assert.equal(get('P11').dueDate,null);
  assert.equal(seed.every((t) => !t.blockedByIds.length),true);
});
test('canceladas ficam no histórico e saem do total, do progresso e das distribuições de trabalho',() => {
  const cancelled = {...get('P13'),statusCode:'cancelado'};
  const tasks = seed.map((task) => task.id === cancelled.id ? cancelled : task);
  const result = aggregate(tasks);
  assert.deepEqual(result.totals,{total:33,resolved:3,scheduled:1,open:29,closed_other:1});
  assert.deepEqual(result.topics.imovel_contas,{total:8,resolved:3});
  assert.equal(result.priorities.proximos_dias,12);
  assert.equal(result.statuses.cancelado,1);
  assert.equal(result.percent,300 / 33);
  assert.equal(aggregate([cancelled]).percent,0);
  assert.equal(filterTasks(tasks,{group:'total',archive:'all'},'test').length,33);
  assert.deepEqual(filterTasks(tasks,{group:'closed_other',archive:'all'},'test'),[cancelled]);
});
test('busca acentuada, filtros combinados, atraso e arquivo',() => {
  const filter = (filters) => filterTasks(seed,filters,'test','2026-11-06').map((t) => t.id);
  assert.deepEqual(filter({q:'P11'}),['P11']);
  assert.deepEqual(filter({q:'DEBITO automatico',topic:'imovel_contas'}),['P11']);
  assert.deepEqual(filter({group:'resolved'}),['P02','P03','P12']);
  assert.deepEqual(filter({q:'U10',due:'week'}),['U10']);
  assert.ok(filterTasks(seed,{due:'overdue'},'test','2026-11-10').some((t) => t.id === 'U10'));
  assert.deepEqual(filter({archive:'archived'}),[]);
});
test('validação rejeita datas inexistentes e relações inválidas',() => {
  assert.throws(() => validateTask({...get('P11'),dueDate:'2026-02-30'},'P11',ids),/data/);
  assert.throws(() => validateTask({...get('P11'),blockedByIds:['P11']},'P11',ids),/Bloqueios/);
  assert.throws(() => validateTask({...get('P11'),relatedTaskIds:['S99']},'P11',ids),/Vínculos/);
});
test('exportações omitem referências internas e neutralizam fórmulas',() => {
  const tasks = [{...get('P11'),contactText:'a@example.com',protocolText:'1234567890',
    nextAction:'=teste a@example.com 1234567890'},...seed];
  for (const result of [exportJSON(tasks),exportCSV(tasks),shareText(tasks,'2026-11-06')]) {
    assert.doesNotMatch(result,/1234567890|1234567891|a@example.com|escritorio@example.test/);
  }
  assert.match(shareText(tasks,'2026-11-06'),/Agendadas: U10/);
  assert.match(shareText(tasks,'2026-11-06'),/Pendências imediatas:.*U08/);
  assert.match(exportCSV(tasks),/"'=teste/);
});
