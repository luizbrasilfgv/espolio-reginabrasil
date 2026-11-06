import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EMPTY } from '../../src/js/model.js';
import { candidates, parseProposals, confirmation, safeContext } from '../../src/js/ai.js';
const tasks = JSON.parse(await readFile(new URL('../fixtures/tasks.json',import.meta.url),'utf8'))
  .map((t)=>({...EMPTY,...t,version:1}));
const root = (proposals) => JSON.stringify({schemaVersion:1,language:'pt-BR',summary:'Alterações sugeridas.',proposals});
const item = (taskId, patch, extra={}) => ({taskId,patch,operation:'update',newTask:null,sourceType:'relato_familiar',
  confidence:'high',reason:'Fato informado.',needsClarification:false,clarificationQuestion:null,...extra});
const parse = (items) => parseProposals(root(items),tasks,tasks,'Naturgy, Claro e RioPax');
test('candidatos distinguem titularidade, fatura e débito automático',() => {
  const ids = candidates('Naturgy no débito automático, e uma pessoa pagou a Light de novembro',tasks).map((t) => t.id);
  for (const id of ['P02','P03','P11','P12']) assert.ok(ids.includes(id),id);
  assert.doesNotMatch(JSON.stringify(safeContext(tasks)),/1234567891|escritorio@example.test/);
});
test('JSON, chaves privilegiadas, referência inventada e candidatos são verificados',() => {
  assert.throws(() => parseProposals('sem json',tasks,tasks,''));
  for (const patch of [{role:'admin'},{version:99},{updatedByUid:'attacker'},{protocolText:'0000'},{sourceType:'documento'}]) {
    assert.throws(() => parse([item('P01',patch)]));
  }
  assert.throws(() => parse([item('P99',{nextAction:'Conferir.'})]));
});
test('prévia começa sem escrita habilitada, apenas a seleção individual vira payload',() => {
  const {proposals} = parse([item('P01',{nextAction:'Aguardar protocolo.'}),item('P11',{nextAction:'Conferir débito.'}),
    item('U09',{nextAction:'Aguardar a data informada.'})]);
  assert.equal(proposals.length,3);
  assert.deepEqual(proposals.map(confirmation),[null,null,null]);
  proposals[1].decision = 'accepted';
  proposals[2].decision = 'rejected';
  assert.equal(proposals.filter((p) => confirmation(p)).length,1);
  assert.equal(confirmation(proposals[1]).base.id,'P11');
  assert.throws(() => parse([item('U09',{statusCode:'resolvido'})]));
});
test('avisa duplicidade Naturgy e deixa desdobramento explícito',() => {
  const newTask = {title:'Naturgy — débito automático',topic:'imovel_contas',priority:'proximos_dias',
    statusCode:'a_conferir',nextAction:'Verificar.',relatedTaskIds:['P11']};
  const p = parse([item(null,{}, {operation:'create',newTask})]).proposals[0];
  assert.ok(p.duplicateIds.includes('P11'));
  const split = parse([item('P01',{nextAction:'Aguardar.'},{operation:'split',newTask})]).proposals[0];
  split.decision = 'accepted';
  assert.equal(confirmation(split).split.title,newTask.title);
});
