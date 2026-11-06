
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EMPTY } from '../../src/js/model.js';
import { confirmation } from '../../src/js/ai.js';
import { interpretLocally } from '../../src/js/local-interpretation.js';

const seed = JSON.parse(await readFile(new URL('../fixtures/tasks.json',import.meta.url),'utf8'))
  .map((task) => ({...EMPTY,...task,version:1}));
const parse = (text,tasks = seed,context) => interpretLocally(text,tasks,context).proposals;
const changes = (items) => items.filter((item) => item.values);

test('um aviso condicional altera só a próxima ação dos destinatários mencionados',() => {
  const tasks = [
    {...EMPTY,id:'U05',title:'Banco Aurora — comunicação e extratos',nextAction:'Comunicar falecimento; solicitar extratos.'},
    {...EMPTY,id:'U06',title:'Banco Serra — comunicação e contas',nextAction:'Comunicar falecimento e verificar contas.'},
    {...EMPTY,id:'U07',title:'Banco Vale — comunicação e aplicações',nextAction:'Comunicar falecimento e solicitar extratos.'},
    {...EMPTY,id:'U08',title:'Fatura de cartão',nextAction:'Conferir a fatura.'}
  ];
  const text = 'a gente não vai mexer com fatura de cartão se está com débito automático não vai organizar pagamento de nenhum cartão do banco Aurora Serra a gente vai deixar rolar e vai só avisar os bancos se isso se os bancos já não tiverem sido avisados automaticamente via cartório né';
  const items = changes(parse(text,tasks));
  assert.deepEqual(items.map((item) => item.taskId),['U05','U06']);
  const conditional = 'Confirmar se a comunicação já foi feita por cartório. Se ainda não foi feita, comunicar falecimento.';
  assert.deepEqual(items.map((item) => ({id:item.taskId,...item.values})),[
    {...tasks[0],nextAction:conditional + ' Solicitar extratos.'},
    {...tasks[1],nextAction:conditional + ' Verificar contas.'}
  ]);
  assert.equal(changes(parse('Só avisar o Banco Aurora se o Banco Serra não tiver sido avisado.',tasks)).length,0);
  assert.equal(changes(parse('Só avisar o Banco Aurora se ele ainda não tiver sido avisado?',tasks)).length,0);
  const updated = tasks.map((task) => ({...task,...items.find((item) => item.taskId === task.id)?.values}));
  assert.equal(changes(parse(text,updated)).length,0);
});

test('Claro reconhece a conclusão e acrescenta a observação, mantendo a proposta sem gravar',() => {
  const [item] = changes(parse('A internet e a TV a cabo da Claro Net já está resolvido. Já estou com o documento aqui.'));
  assert.equal(item.taskId,'P01');
  assert.equal(item.values.statusCode,'resolvido');
  assert.match(item.values.sourceNote,/documento está em mãos/);
  assert.equal(confirmation(item),null);
});

test('Light diferencia titularidade de pagamento e não recria a fatura registrada',() => {
  const items = parse('Transferi a titularidade da Light pro meu nome e já paguei a fatura de novembro.');
  assert.deepEqual(items.map((p) => p.taskId),['P02','P12']);
  assert.deepEqual(changes(items),[]);
  const [bill] = changes(parse('Faltava pagar a conta da Light de dezembro e já paguei.'));
  assert.equal(bill.values.statusCode,'resolvido');
  assert.match(bill.values.title,/dezembro/);
  assert.deepEqual(bill.values.relatedTaskIds,['P02']);
});

test('Naturgy diferencia débito de pagamento e a fala seguinte retém o assunto',() => {
  const items = parse('Transferi a titularidade da Naturgy pro meu nome, mas preciso verificar o débito automático.');
  assert.deepEqual(items.map((p) => p.taskId),['P03','P11']);
  const [bill] = changes(parse('Ainda não paguei a fatura de dezembro.',seed,'Naturgy'));
  assert.equal(bill.values.statusCode,'pagamento_pendente');
  assert.match(bill.values.title,/Naturgy/);
  assert.equal(changes(parse('Acho que paguei a Light.')).length,0);
});

test('uma fala conclui, cancela e cria vínculo somente nas pendências indicadas',() => {
  const items = changes(parse('Concluí a P01 e pode cancelar P11. Vincule P01 a P11.'));
  assert.deepEqual(items.map((p) => [p.taskId,p.values.statusCode]),[['P01','resolvido'],['P11','cancelado']]);
  assert.ok(items[0].values.relatedTaskIds.includes('P11'));
  assert.deepEqual(items[0].values.blockedByIds,[]);
});

test('dependência operacional tem direção e o desbloqueio não altera o status associado',() => {
  const [link] = changes(parse('P01 bloqueia P11.'));
  assert.equal(link.taskId,'P11');
  assert.deepEqual(link.values.blockedByIds,['P01']);
  const tasks = seed.map((task) => task.id === 'P11' ? {...task,blockedByIds:['P01']} : task);
  const items = parse('Concluí a P01.',tasks);
  assert.ok(items.some((p) => p.taskId === 'P11' && !p.values && /poderá avançar/.test(p.reason)));
  assert.equal(changes(parse('Se P01 estiver pronta, pode cancelar P11.')).length,0);
});

test('cria uma tarefa ligada à anterior sem fechar ou reabrir a anterior',() => {
  const items = changes(parse('Resolvi a P01 e cria uma pendência para guardar o protocolo vinculada a ela.'));
  assert.equal(items.length,2);
  assert.match(items[1].values.title,/guardar o protocolo/i);
  assert.deepEqual(items[1].values.relatedTaskIds,['P01']);
  assert.equal(items[1].values.statusCode,'nao_iniciado');
});

test('documentos do escritório em preparação não são tratados como entregues',() => {
  const items = changes(parse('O escritório Meirelles Quintela. Vamos mandar CPF e identidade. Um familiar já me mandou os dele e estou juntando os meus.'));
  assert.deepEqual(items.map((item) => item.taskId),['U02','U01']);
  assert.ok(items.every((item) => item.values.statusCode === 'em_andamento'));
  assert.match(items[0].values.sourceNote,/ainda sem confirmação de entrega/);
  assert.match(items[1].values.sourceNote,/Parte da documentação foi recebida/);
  assert.ok(items[0].values.relatedTaskIds.includes('U01'));
  assert.equal(changes(parse('O escritório Meirelles Quintella vai enviar a lista de documentos.')).length,0);
});

test('ditado sobre o precatório mantém a lista de documentos e registra o encaminhamento à irmã',() => {
  const items = parse('A gente comunicou o escritório da U02 sobre o precatório e o falecimento da pessoa eles mandaram já um e-mail indicando o que a gente deveria separar CPF CNPJ identidade comprovante de residência e estado civil eu já tô juntando a certidão de óbito digitalizada para mandar tudo para o e-mail da minha irmã ela que vai fazer a entrega no escritório eu acho que é esse o nome do escritório');
  assert.deepEqual(items.map(({taskId}) => taskId),['U02','U01']);
  const [office,documents] = items.map(({values}) => values);
  assert.equal(office.statusCode,'em_andamento');
  assert.match(office.sourceNote,/Recebimento das orientações/);
  assert.match(office.sourceNote,/avisado do falecimento/);
  assert.match(office.sourceNote,/ainda sem confirmação de entrega/);
  assert.match(office.nextAction,/por e-mail à irmã, que fará a entrega/);
  assert.deepEqual(office.relatedTaskIds,['S02','U01']);
  assert.match(documents.nextAction,/contratos, faturas e correspondências/);
  assert.match(documents.nextAction,/informação sobre estado civil, certidão de óbito digitalizada/);
  assert.doesNotMatch(documents.nextAction,/CNPJ/);
  assert.match(documents.sourceNote,/Conferir no e-mail do escritório se foi solicitado/);
});

test('consolidação por assunto reconhece paráfrases sem depender do ID dito',() => {
  for (const phrase of [
    'a cobrança da água acho que é ap 13 não existe ela tá junto com o condomínio então não faz sentido ter uma pendência de cobrança de água',
    'O condomínio já inclui água e esgoto, por isso não faz sentido manter uma tarefa só para a água.',
    'A conta de água e esgoto. Ela vem no mesmo boleto do condomínio, então não precisamos manter uma cobrança separada.'
  ]) {
    const items = changes(parse(phrase));
    assert.deepEqual(items.map(({taskId,operation}) => [taskId,operation]),[['P13','cancel']]);
    assert.match(items[0].values.nextAction,/P04/);
    assert.ok(items[0].userReason);
  }
  assert.equal(changes(parse('A conta de água vem junto com o condomínio?')).length,0);
  assert.equal(changes(parse('A água não vem junto com o condomínio, então precisamos manter a pendência.')).length,0);
});

test('interpreta ação e cobertura em outros assuntos cadastrados',() => {
  const [paid] = changes(parse('Já paguei a taxa de incêndio.'));
  assert.equal(paid.taskId,'S09');
  assert.equal(paid.values.statusCode,'resolvido');
  const [started] = changes(parse('Comecei a localizar o processo do inventário do pai.'));
  assert.equal(started.taskId,'P05');
  assert.equal(started.values.statusCode,'em_andamento');
  const [covered] = changes(parse('A taxa de incêndio já está incluída no condomínio, então pode tirar essa pendência separada.'));
  assert.equal(covered.taskId,'S09');
  assert.equal(covered.values.statusCode,'cancelado');
  assert.match(covered.values.nextAction,/P04/);
});
