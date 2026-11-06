import { EMPTY, TOPICS, PRIORITIES, STATUSES, SOURCES, ROLES, ACCESS, validateTask, dateTime, localDate } from './model.js';
import { h, icon, route, btn, go, header, empty, banner, select, input, textarea, check } from './ui.js';
import { diffHtml } from './task-views.js';
import { operationLabels } from './ai.js';

const wide = (html) => '<div class="wide">' + html + '</div>';
export function taskFields(task, names, stem = '') {
  const id = (name) => stem + name;
  const relation = (key) => task[key].join(', ');
  const options = {...names};
  if (task.ownerUid && !Object.hasOwn(options,task.ownerUid)) options[task.ownerUid] = (task.ownerLabel || 'Membro') + ' (inativo)';
  return wide(input('Título',id('title'),task.title,'required maxlength="140"'))
    + select('Assunto',id('topic'),TOPICS,task.topic) + select('Prioridade',id('priority'),PRIORITIES,task.priority)
    + select('Situação',id('statusCode'),STATUSES,task.statusCode) + input('Prazo confirmado',id('dueDate'),task.dueDate,'','date')
    + select('Responsável cadastrado',id('ownerUid'),options,task.ownerUid,'Sem atribuição por conta')
    + input('Nome informado (histórico)',id('ownerLabel'),task.ownerLabel,'maxlength="100"')
    + wide(textarea('Próxima ação',id('nextAction'),task.nextAction,'required maxlength="1000"'))
    + wide(textarea('Descrição',id('description'),task.description,'maxlength="2400"'))
    + select('Fonte',id('sourceType'),SOURCES,task.sourceType) + input('Tags opcionais',id('tags'),task.tags,'maxlength="200"')
    + wide(textarea('Ressalvas e contexto da fonte',id('sourceNote'),task.sourceNote,'maxlength="2000"'))
    + wide('<details><summary>Vínculos e referências internas</summary><div class="form-grid">'
      + input('IDs relacionados (separados por vírgula)',id('relatedTaskIds'),relation('relatedTaskIds'),'maxlength="100"')
      + input('IDs de bloqueios confirmados',id('blockedByIds'),relation('blockedByIds'),'maxlength="100"')
      + input('Contato institucional',id('contactText'),task.contactText,'maxlength="250"')
      + input('Protocolo interno',id('protocolText'),task.protocolText,'maxlength="250"')
      + input('Valor informado (R$)',id('amountApproxBRL'),task.amountApproxBRL,'step="0.01" min="0" max="1000000000"','number')
      + check('Valor exato confirmado',id('amountIsExact'),task.amountIsExact) + '</div></details>');
}

export function readTask(form, base, names, known, stem = '') {
  const get = (key) => String(form.get(stem + key) ?? '').trim();
  const draft = {...EMPTY};
  for (const key of Object.keys(EMPTY)) draft[key] = get(key);
  draft.archived = base?.archived || false;
  draft.amountApproxBRL = get('amountApproxBRL') ? Number(get('amountApproxBRL')) : null;
  draft.amountIsExact = form.has(stem + 'amountIsExact');
  if (draft.ownerUid) draft.ownerLabel = names[draft.ownerUid] || (draft.ownerUid === base?.ownerUid ? base.ownerLabel : '');
  for (const key of ['relatedTaskIds','blockedByIds']) draft[key] = get(key).split(/[\s,]+/).filter(Boolean).map((id) => id.toUpperCase());
  return validateTask(draft,base?.id,known);
}

export function updateView(state, aiEnabled, speechSupported) {
  const data = state.update;
  const items = data.proposals || [];
  const review = items.filter((p) => p.decision === 'pending' || p.decision === 'failed').length;
  const rejected = items.filter((p) => p.decision === 'rejected').length;
  const done = items.filter((p) => p.decision === 'done').length;
  return header('Registre uma mudança', 'Atualizar', 'Digite ou dite uma atualização e revise antes de gravar.')
    + (state.canEdit ? '<section class="panel stack"><h2>Voz ou texto</h2>'
    + '<p class="small muted">As sugestões locais são feitas no próprio app. Pode mencionar mais de uma ação na mesma fala.</p>'
    + (data.localService ? '<p class="small muted">Contexto da conversa: ' + h(data.localService) + '. Diga o nome da empresa para mudar de assunto.</p>' : '')
    + '<form id="interpret-form" class="stack">' + textarea('Texto da atualização','transcript',data.text,'maxlength="2500" rows="5" placeholder="Descreva o que aconteceu e o que falta conferir."')
    + '<p class="small muted">O ditado usa o reconhecimento do navegador, que pode recorrer a um serviço remoto. Você pode corrigir a transcrição e interpretar novamente.</p>'
    + '<div class="row">' + (speechSupported && state.config?.speechEnabled
      ? btn(icon('mic') + (data.listening ? ' Parar ditado' : ' Iniciar ditado'),data.listening?'speech-stop':'speech-start')
      : '<span class="muted small">Ditado indisponível. Use o campo de texto.</span>') + '</div>'
    + (data.speechStatus ? '<p role="status" class="small muted">' + h(data.speechStatus) + '</p>' : '')
    + '<div class="row"><button class="primary" type="submit"' + (data.busy || data.listening || data.saving || !state.tasks ? ' disabled' : '') + '>Analisar e mostrar alterações</button>' + btn('Nova fala','new-utterance','ghost',data.saving?'disabled':'') + '</div>'
    + (aiEnabled ? check('Aceito enviar este texto ao provedor. O nível gratuito pode usar o conteúdo para melhorar produtos. Removi dados pessoais, financeiros e documentos sigilosos.', 'consent',data.consent)
      + check('Incluir o texto original apenas no primeiro evento confirmado deste lote.', 'retain',data.retain)
      + '<div><button type="submit" name="provider" value="remote"' + (data.busy || data.listening ? ' disabled' : '') + '>' + (data.busy?'Interpretando…':'Interpretar com Gemini') + '</button></div>' : '')
    + '</form><div class="row">' + go('Editar manualmente', route('pendencias')) + btn(icon('plus') + ' Nova pendência', 'new-task')
    + '</div></section>' : empty('Edição indisponível', 'Seu perfil atual permite consultar o controle.'))
    + banner(data.error,'error')
    + (data.summary ? '<section class="panel stack"><h2 id="update-review" tabindex="-1">'
      + (review + done + rejected ? 'Revisar alterações uma por uma' : 'Nenhuma alteração pronta para gravar') + '</h2>'
      + '<p class="wrap">' + h(data.summary) + '</p>'
      + (review + done + rejected ? '<p class="muted small">' + review + ' para revisar · ' + done + ' gravadas · ' + rejected + ' rejeitadas</p>' : '')
      + '</section>' : '')
    + items.map((item,index) => proposalView(state,item,index)).join('');
}
const confidence = {high:'Alta',medium:'Média',low:'Baixa'};
const decisions = {pending:'Para revisar',failed:'Revisão necessária',rejected:'Rejeitada',done:'Gravada',informational:'Informativa'};
function proposalView(state, item, i) {
  const action = 'data-index="' + i + '"' + (state.update.saving ? ' disabled' : '');
  const clickable = ['pending','failed'].includes(item.decision);
  const id = item.taskId || item.base?.id;
  const label = item.reviewLabel || operationLabels[item.operation];
  const related = [...new Set([...(item.candidateIds || []), ...(!item.values && id ? [id] : [])])];
  const title = item.values ? label + ' · ' + (id || 'Nova pendência')
    : id ? 'Acompanhar ' + id : related.length ? 'Pendências relacionadas ao relato' : 'Esclarecer o relato';
  return '<section id="proposal-' + i + '" class="panel stack proposal" tabindex="-1" data-decision="' + h(item.decision) + '"><div class="row spread"><h2>'
    + h(title) + '</h2><span class="chip">' + h(decisions[item.decision]) + '</span></div>'
    + (item.values ? '<p class="wrap"><strong>' + h(item.values.title) + '</strong></p>' : '')
    + '<p class="wrap">' + h(item.reason) + '</p>'
    + (item.values && item.confidence ? '<p class="small muted">Confiança da interpretação: ' + h(confidence[item.confidence]) + '.</p>' : '')
    + (related.length ? '<div class="row">' + related.map((id) => {
      const task = state.tasks?.find((task) => task.id === id);
      const name = h(task ? id + ' · ' + task.title : 'Abrir ' + id);
      return item.choices?.some((choice) => choice.taskId === id)
        ? btn(name,'choose-proposal','',action + ' data-task-id="' + h(id) + '"')
        : go(name,route('pendencia/' + id));
    }).join('') + '</div>' : '')
    + banner(item.clarificationQuestion) + banner(item.error,'error')
    + (item.values ? diffHtml(item.base,item.values,state.names) : '')
    + (item.operation === 'split' ? '<h3>Nova pendência do desdobramento</h3>' + diffHtml(null,item.newTask,state.names) : '')
    + (item.duplicateIds?.length ? banner('Compare com as pendências já existentes: ' + item.duplicateIds.join(', ') + '.') : '')
    + (clickable ? '<div class="row">' + (item.conflict ? btn('Comparar com versão atual','rebase-proposal','',action)
      : btn('Aprovar e gravar', 'accept-proposal', 'primary', action)
        + btn('Editar','edit-proposal','',action)) + btn('Rejeitar','reject-proposal','ghost',action) + '</div>' : '') + '</section>';
}

export function more(state) {
  return header('Preferências e ajuda', 'Mais', 'Conta, administração e cópias do controle.')
    + '<section class="panel stack"><div class="row spread"><div><h2>' + h(state.member.displayName)
    + '</h2><p class="muted wrap">' + h(ROLES[state.member.role]) + ' · ' + h(state.user.email) + '</p></div>'
    + btn(icon('exit') + ' Sair','logout') + '</div></section><section class="panel row">'
    + (state.member.role === 'admin' ? go(icon('people') + ' Gestão de acessos',route('acessos')) : '')
    + go(icon('down') + ' Relatórios e exportação',route('exportar')) + go('Ajuda e instalação',route('ajuda')) + '</section>';
}

export function adminView(state) {
  if (state.member.role !== 'admin') return empty('Área administrativa','Seu perfil atual não gerencia acessos.');
  return header('Administração', 'Gestão de acessos', 'Aprovações são feitas por conta Google verificada.')
    + banner(state.adminError,'error') + '<div class="cols"><section class="panel stack"><h2>Solicitações</h2>'
    + (state.requests?.length ? state.requests.map((r) => '<article class="audit stack"><div><strong class="wrap">'
      + h(r.googleDisplayName || 'Conta Google') + '</strong><p class="muted small wrap">' + h(r.googleEmail) + ' · ' + h(dateTime(r.requestedAt))
      + ' · ' + h(({pending:'Pendente',approved:'Aprovada',rejected:'Rejeitada'})[r.status]) + '</p></div>'
      + (r.requestText ? '<p class="wrap">' + h(r.requestText) + '</p>' : '')
      + (r.status === 'pending' ? '<div class="row">' + btn('Aprovar editor','approve-editor','primary','data-uid="' + h(r.uid) + '"')
        + btn('Aprovar leitor','approve-viewer','','data-uid="' + h(r.uid) + '"')
        + btn('Rejeitar','reject-request','danger','data-uid="' + h(r.uid) + '"') + '</div>' : '') + '</article>').join('')
      : '<p class="muted">' + (state.requests ? 'Nenhum pedido registrado.' : 'Carregando solicitações…') + '</p>')
    + '</section><section class="panel stack"><h2>Membros</h2>'
    + (state.members || []).map((m) => '<article class="audit"><h3 class="wrap">' + h(m.displayName) + '</h3>'
      + '<p class="small muted wrap">' + h(m.email) + ' · ' + h(ROLES[m.role]) + ' · ' + h(ACCESS[m.accessStatus])
      + '<br>Decisão: ' + h(state.names[m.approvedByUid] || 'Administrador') + ' · ' + h(dateTime(m.approvedAt)) + '</p>'
      + (m.role !== 'admin' ? btn('Alterar acesso','manage-member','','data-uid="' + h(m.uid) + '"') : '') + '</article>').join('')
    + '</section></div><section class="panel stack"><h2>Configuração</h2>'
    + '<form id="config-form" class="stack">' + check('Permitir edição manual e confirmação de propostas','manual',state.config?.allowManualEdits)
    + check('Oferecer ditado em navegadores compatíveis','speech',state.config?.speechEnabled)
    + check('Habilitar interpretação por IA (depende também da configuração Spark e App Check)','ai',state.config?.aiEnabled)
    + '<div><button type="submit">Salvar configuração</button></div></form>'
    + '<h3>Assuntos do controle</h3><p class="small muted">' + h(Object.values(TOPICS).join(' · ')) + '</p></section>';
}

export function exportView(state, text) {
  return header('Cópias do controle', 'Relatórios e exportação')
    + '<section class="panel stack"><h2>Baixar snapshot</h2><p class="muted">Inclui IDs, situação, prazos e próximos passos. Contatos, protocolos e nomes de responsáveis são omitidos.</p><div class="row">'
    + btn(icon('down') + ' JSON','export-json','',state.tasks?'':'disabled') + btn(icon('down') + ' CSV','export-csv','',state.tasks?'':'disabled')
    + '</div></section><section class="panel stack"><h2>Resumo semanal para WhatsApp</h2><p class="muted">Resumo por assunto com situações e IDs. Copie e compartilhe com quem tem acesso.</p>'
    + textarea('Texto do resumo','whatsapp',text,'readonly rows="12" id="whatsapp"') + '<div>' + btn('Copiar resumo','copy-summary') + '</div></section>';
}

export function helpView(installable) {
  return header('Primeiros passos', 'Ajuda e instalação') + '<div class="cols"><section class="panel stack"><h2>Instalar no Android</h2>'
    + '<p>No Chrome, abra o menu e escolha <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>. Abra o ícone e entre com a conta Google aprovada.</p>'
    + (installable ? btn('Instalar aplicativo','install','primary') : '') + '</section><section class="panel stack"><h2>Rede e privacidade</h2>'
    + '<p>O painel verifica o acesso e confirma gravações pelo Firestore. Com a conexão interrompida, a interface pode exibir dados já carregados e a edição volta quando a rede retornar.</p>'
    + '<p>Use contatos institucionais e referências estritamente necessárias. Evite CPF, endereços residenciais, dados bancários e arquivos.</p></section>'
    + '<section class="panel stack"><h2>Como acompanhar</h2><p>Abra uma pendência para ver a próxima ação, vínculos e histórico. Use a aba Atividade para comparar o antes e depois. Arquivar preserva a trilha.</p></section></div>';
}
