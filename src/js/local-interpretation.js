
import { EMPTY, TASK_ID, diff, normalize, validateTask } from './model.js';
import { candidates, duplicates } from './ai.js';
import { conditionalNotifications, generalTaskStatus, incorporatedIn, matchLocalTasks, relatedTaskMatches } from './local-task-intent.js';

const services = [
  {name:'Claro/NET', match:/\b(?:claro|net|tv a cabo)\b/, cancellation:'P01'},
  {name:'Light', match:/\b(?:light|conta de luz)\b/, ownership:'P02', november:'P12'},
  {name:'Naturgy', match:/\b(?:naturgy|gas)\b/, ownership:'P03', debit:'P11'}
];
const months = 'janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro'.split(' ');
const scopes = [
  ['ownership', /\b(?:titularidade|titular|(?:pro meu|pro|para (?:o|meu)|no meu|no|em meu) nome|nome (?:do|da|de))\b/],
  ['debit', /\b(?:debito automatico|forma de pagamento)\b/],
  ['payment', /\b(?:pag(?:ar|uei|ou|a|o|amento|ando)|quit(?:ar|ei|ou|ada|ado|acao)|fatura|boleto|conta (?:do mes|de \w+))\b/],
  ['cancellation', /\bcancel\w*\b/]
];
const done = /\b(?:resolvi|resolvid[oa]s?|conclui|concluid[oa]s?|finalizei|finalizad[oa]s?|ja (?:foi feito|esta feit[oa])|foi (?:feit[oa]|efetuad[oa])|paguei|pagou|pag[oa]s?|quitei|quitou|quitad[oa]s?|transferi|transferiu|transferid[oa]s?|troquei|mudei|cancelei|cancelou|cancelad[oa]s?|cadastrei|cadast[r]?ad[oa]s?)\b/;
const pending = /\b(?:falta|faltou|precis[oa]|tenho que|tem que|temos que|ainda tenho|pendente|vou|vamos|quero|devo|devemos|pra|para)\s+(?:de |que )?(?:pag|quit|transfer|troc|mud|cancel|confer|verific|cadastr|resolv|finaliz|conclu)/;
const unsure = /\b(?:nao|nem|talvez|acho que|parece que|sera que|se foi|se esta)\b/;
const checking = /\b(?:conferir|confirmar|verificar|checar|descobrir|saber)\b/;
const create = /^(?:(?:preciso|quero|vamos|tem que) )?(?:criar|crie|cria|abrir|abra|adicionar|adicione|adiciona|anotar|anote|anota|incluir|inclua)(?: (?:uma|nova|outra|pendencia|tarefa|de|para|pra|sobre))*\s*[:,-]?\s*/i;
const split = /[.!?;\n]+(?=\s|$)|[, ]+(?:e\s+depois|mas|depois|alem disso|tambem)\s+|\s+e\s+(?=(?:(?:ja|ainda|agora|tambem|eu|ele|ela|a gente|nao|pode)\s+)*(?:(?:pag|quit|falt|precis|transfer|troc|mud|cancel|confer|verific|cadast|cri|abr|resolv|conclu)\w*|tenho|temos|vou|vamos|o pagamento|a fatura|a conta|a titularidade|o debito|(?:a|da) (?:light|claro|naturgy))\b)/g;

function intent(clause) {
  if (unsure.test(clause) || pending.test(clause) || checking.test(clause)) return 'pending';
  if (done.test(clause)) return 'done';
  if (/\b(?:iniciei|comecei|em andamento|dei entrada)\b/.test(clause)) return 'started';
  if (/\b(?:pagar|quitar|transferir|trocar|mudar|cancelar|cadastrar)\b/.test(clause)) return 'pending';
  return null;
}

function scopeFor(clause) {
  const kinds = scopes.filter(([, regex]) => regex.test(clause)).map(([kind]) => kind);
  if (kinds.includes('debit') && kinds.includes('payment')) return 'debit';
  return kinds.length === 1 ? kinds[0] : null;
}

function subject(kind, period) {
  return {
    ownership:['transferência de titularidade','Conferir e efetivar a transferência de titularidade.'],
    cancellation:['cancelamento','Confirmar e concluir o cancelamento do serviço.'],
    debit:['forma de pagamento e débito automático','Conferir a forma de pagamento e o cadastro de débito automático.'],
    payment:['pagamento da fatura' + (period ? ' de ' + (period === 'marco' ? 'março' : period) : ''),
      'Conferir e registrar o pagamento da fatura.']
  }[kind];
}
const isClosed = (task) => ['resolvido','cancelado'].includes(task.statusCode) || task.archived;
const information = (reason, taskId = null) => ({operation:'no_change',taskId,reason,decision:'informational',confidence:'low'});

function matchingTasks(tasks, service, kind, period, year) {
  const standard = kind === 'payment' ? service.november : service[kind];
  return tasks.filter((task) => {
    const title = normalize(task.title);
    if (task.id !== standard && (!service.match.test(title) || scopeFor(title) !== kind)) return false;
    if (kind !== 'payment') return true;
    const taskPeriod = months.find((month) => new RegExp('\\b' + month + '\\b').test(title));
    const taskYear = title.match(/\b20\d{2}\b/)?.[0] || (task.id === 'P12' ? '2026' : null);
    return (period ? taskPeriod === period : !taskPeriod) && (!year || taskYear === year);
  });
}

function officeUpdates(text, tasks, add) {
  const office = tasks.find((task) => task.id === 'U02' && !isClosed(task));
  const documents = tasks.find((task) => task.id === 'U01' && !isClosed(task));
  if (!office || !/\b(?:meirell?es|quintell?a|u02)\b/.test(text)
    || !/\b(?:documentos?|documentacao|certidao|comprovantes?|identidade|cpf)\b/.test(text)) return null;
  const sisterDelivers = /\b(?:minha|nossa) irma\b[^.!?;]{0,100}\b(?:ela (?:que )?)?vai (?:fazer a entrega|entregar|enviar|mandar)\b/.test(text);
  const planned = (sisterDelivers
    || /\b(?:a gente vai|vamos|vou|iremos|precisamos|a gente precisa)\s+(?:mandar|enviar|encaminhar)\b|\b(?:mandar|enviar|encaminhar)\b[^.!?;]{0,80}\b(?:pro|ao|para o) escritorio\b/.test(text))
    && !/\b(?:nao|nem)\s+(?:vai|vao|vamos|vou|iremos|precisa|precisamos)\s+(?:mandar|enviar|encaminhar)\b/.test(text);
  const checklist = /\b(?:recebi|recebemos|recebeu|ja mandaram|ja enviaram)\b[^.!?;]{0,80}\b(?:lista|relacao|orientacoes)\b|\b(?:mandaram|enviaram|recebi|recebemos|recebeu)\s+(?:ja\s+)?(?:um\s+|o\s+)?e[ -]?mail\b[^.!?;]{0,80}\b(?:indicando|listando|com a lista|com a relacao|com as orientacoes)\b/.test(text)
    && !/\bnao\s+(?:ja\s+)?(?:recebi|recebemos|recebeu|mandaram|enviaram)\b/.test(text);
  const preparing = /\b(?:estou|estamos|to|tamos)\s+(?:juntando|separando|reunindo|organizando|preparando)\b/.test(text)
    && !/\bnao\s+(?:estou|estamos|to|tamos)\b/.test(text);
  if (!planned && !checklist && !preparing) return null;
  const categories = [
    [/\bcpf\b/,'CPF'], [/\bidentidade\b/,'identidade'], [/\bcomprovantes? de residencia\b/,'comprovante de residência'],
    [/\bestado civil\b/,'informação sobre estado civil'],
    [/\bcertidao de obito\b/,/\bcertidao de obito digitalizada\b/.test(text) ? 'certidão de óbito digitalizada' : 'certidão de óbito']
  ].filter(([pattern]) => pattern.test(text)).map(([,label]) => label);
  const append = (prior, message, limit) => !message || prior.includes(message) || prior.length + message.length + 1 > limit
    ? prior : [prior,message].filter(Boolean).join('\n');
  const preparingStatus = (task) => ['nao_iniciado','nao_confirmado','a_conferir','a_investigar','aguardando_escritorio'].includes(task.statusCode)
    ? 'em_andamento' : task.statusCode;
  let officeAction = office.nextAction;
  if (planned && sisterDelivers) {
    officeAction = 'Conferir a relação solicitada e encaminhar a documentação por e-mail à irmã, que fará a entrega ao escritório. Depois, confirmar o recebimento e a formalização do óbito no processo.';
  } else if (planned || checklist) {
    officeAction = 'Conferir a relação solicitada, reunir e encaminhar os documentos ao escritório. Depois, confirmar o recebimento e a formalização do óbito no processo.';
  }
  const officeNote = [
    checklist ? 'Recebimento das orientações do escritório informado no relato.' : '',
    /\bprecatorio\b/.test(text) ? 'O contato sobre a documentação está ligado ao precatório.' : '',
    /\b(?:comunicou|comunicamos|informou|informamos)\s+(?:ao|o) escritorio\b[^.!?;]{0,140}\bfalecimento\b/.test(text)
      ? 'O relato informa que o escritório foi avisado do falecimento. A formalização no processo segue a confirmar.' : '',
    planned ? 'Envio ao escritório previsto, ainda sem confirmação de entrega.' : '',
    preparing ? 'Documentação em preparação.' : ''
  ].filter(Boolean).join(' ');
  add(office,preparingStatus(office),office.title,officeAction,
    'Preparar o envio e acompanhar o contato com o escritório.',office.id,{sourceNote:append(office.sourceNote || '',officeNote,2000)});
  if (documents && (preparing || planned && categories.length)) {
    const partial = preparing && /\b(?:ja (?:me )?(?:mandou|enviou)|ja recebi)\b/.test(text);
    const docsNote = [
      partial ? 'Parte da documentação foi recebida e o restante está em preparação.' : 'Documentação em preparação para conferência.',
      /\bcnpj\b/.test(text) ? 'O ditado menciona CNPJ. Conferir no e-mail do escritório se foi solicitado.' : ''
    ].filter(Boolean).join(' ');
    const checklistAction = categories.length ? 'Para o escritório, conferir ' + categories.join(', ') + '.'
      : 'Reunir e conferir a documentação solicitada pelo escritório.';
    const docsAction = append(documents.nextAction,checklistAction,1000);
    add(documents,preparingStatus(documents),documents.title,docsAction,'Reunir e conferir os documentos mencionados.',
      documents.id,{sourceNote:append(documents.sourceNote || '',docsNote,2000)});
    if (!office.relatedTaskIds.includes(documents.id) && office.relatedTaskIds.length < 10) {
      add(office,null,office.title,officeAction,'A preparação dos documentos está relacionada ao envio.',office.id,
        {relatedTaskIds:[...office.relatedTaskIds,documents.id]});
    }
  }
  return office;
}

export function interpretLocally(input, tasks, previousService, previousTaskId) {
  const text = normalize(input);
  const known = new Set(tasks.map((task) => task.id));
  const named = services.filter((service) => service.match.test(text));
  let context = named.length === 1 ? named[0] : named.length ? null : services.find((s) => s.name === previousService);
  const proposals = [];
  const seen = new Map();
  const recentBills = new Map();
  let unmatched = false;
  let lastTask = !named.length || named.length === 1 && named[0].name === previousService
    ? tasks.find((task) => task.id === previousTaskId) : null;
  let offset = 0;
  let previousClause = '';
  let conditionalNotice = false;
  const original = input.normalize('NFC');

  function add(base, status, title, nextAction, reason, key, fields = {}) {
    const previous = seen.get(key);
    if (previous != null) {
      const previousStatus = proposals[previous].values?.statusCode;
      if (!previousStatus || (previousStatus === status && !Object.keys(fields).length)) return;
      if (status && previousStatus !== status && previousStatus !== base?.statusCode
        && (previousStatus === 'resolvido' || status !== 'resolvido')) {
        proposals[previous] = information('A mesma ação apareceu com situações diferentes. Diga qual é a situação atual.',base?.id);
        return;
      }
    }
    if (base && isClosed(base) && status) {
      proposals.push(information(base.id + ' já consta como ' + (base.archived ? 'arquivada' : base.statusCode === 'resolvido' ? 'resolvida' : 'cancelada')
        + '. Se a situação mudou, você pode reabrir pelo detalhe.',base.id));
      return;
    }
    const prior = previous == null ? null : proposals[previous].values;
    const draft = prior || base || {...EMPTY,title,topic:'imovel_contas',sourceType:'relato_familiar'};
    const values = validateTask({...draft,...(status ? {statusCode:status,nextAction} : {}),...fields},base?.id,known);
    if (base && !diff(base,values).length) return;
    const item = {operation:base ? values.statusCode === 'resolvido' && base.statusCode !== 'resolvido' ? 'complete'
      : values.statusCode === 'cancelado' && base.statusCode !== 'cancelado' ? 'cancel' : 'update' : 'create',
      taskId:base?.id ?? null,base:base ?? null,values,newTask:base ? null : values,
      reason:!status && prior ? proposals[previous].reason : reason,confidence:'high',
      decision:'pending',userReason:['resolvido','cancelado'].includes(status) ? reason : proposals[previous]?.userReason || ''};
    item.duplicateIds = item.newTask ? duplicates({...item,newTask:{...item.newTask,relatedTaskIds:[]}},tasks).map((task) => task.id) : [];
    if (previous != null) proposals[previous] = item;
    else { seen.set(key,proposals.length); proposals.push(item); }
  }

  const office = officeUpdates(text,tasks,add);
  if (office) lastTask = office;
  for (const fragment of text.split(split)) {
    const start = text.indexOf(fragment,offset);
    offset = start + fragment.length;
    const clause = fragment.trim();
    const originalClause = original.length === text.length ? original.slice(start,offset).trim() : clause;
    const displayTitle = (title) => {
      const from = clause.indexOf(title);
      const originalTitle = originalClause.slice(from,from + title.length);
      return originalTitle.charAt(0).toUpperCase() + originalTitle.slice(1,140);
    };
    if (!clause) continue;
    if (/\b(?:estou|estamos|fiquei|est[aá]) com (?:o |a )?(?:documento|comprovante)\b/.test(clause)
      && proposals.filter((p) => p.values).length === 1) {
      const item = proposals.find((p) => p.values);
      const note = [item.values.sourceNote,'Foi informado que o documento está em mãos.'].filter(Boolean).join(' ');
      if (note.length <= 2000 && !item.values.sourceNote.includes('o documento está em mãos')) {
        item.values = {...item.values,sourceNote:note};
      }
      continue;
    }
    const taskIds = [...new Set((clause.match(/\b[ups]\s*\d{2,6}\b/g) || []).map((id) => id.replace(/\s+/g,'').toUpperCase()))]
      .filter((id) => TASK_ID.test(id));
    const mentioned = services.filter((s) => s.match.test(clause));
    if (mentioned.length === 1) context = mentioned[0];
    const action = intent(clause);
    let kind = scopeFor(clause);
    const continued = /^(?:ela|ele|isso|essa|esse|ja vem|vem|esta|ta)\b/.test(clause);
    const question = text[offset] === '?';
    const incorporated = !question && incorporatedIn(continued ? previousClause + ' ' + clause : clause);
    const notices = !question && conditionalNotifications(clause,originalClause,tasks.filter((task) => !isClosed(task)),previousClause);
    previousClause = question ? '' : clause;
    if (question) {
      const options = matchLocalTasks(clause,tasks).map((task) => task.id);
      proposals.push({...information('A fala está em forma de pergunta. Confirme o que aconteceu para propor uma alteração.'),candidateIds:options});
      continue;
    }
    if (notices) {
      conditionalNotice = true;
      if (!notices.length) {
        proposals.push(information('Entendi que o aviso depende de uma conferência. Diga para quem seria o aviso ou indique a pendência que contém essa ação.'));
      } else if (notices.every(({task,nextAction}) => task.nextAction === nextAction)) {
        proposals.push({...information('A conferência antes do aviso já consta nas pendências indicadas.'),candidateIds:notices.map(({task}) => task.id)});
      } else {
        for (const {task,nextAction} of notices) {
          add(task,null,task.title,nextAction,'Conferir se já houve aviso antes de entrar em contato.',task.id,{nextAction});
        }
      }
      continue;
    }
    if (/^(?:(?:a gente|eu|nos)\s+)?nao\s+(?:vou|vai|vamos)\s+(?:mexer|mudar|alterar|meter a mao)\b/.test(clause)) continue;
    if (/^se\b/.test(clause) || /\b(?:se|caso)\s+(?:a|o|p[0-9])/.test(clause) && taskIds.length > 1) {
      proposals.push(information('A mudança foi descrita como condicional. Confirme o que já aconteceu e indique a ação que deve ser aplicada.'));
      continue;
    }
    if (incorporated) {
      const {subject,reference,unnecessary} = incorporated;
      const targets = matchLocalTasks(subject,tasks);
      const references = matchLocalTasks(reference,tasks);
      const [target] = targets;
      const [related] = references;
      if (targets.length === 1 && references.length === 1 && target.id !== related.id) {
        const reason = 'O relato indica que esta pendência já está coberta por ' + related.id + ' — ' + related.title + '.';
        if (unnecessary) {
          add(target,'cancelado',target.title,'Acompanhar este assunto em ' + related.id + ' — ' + related.title + '.',reason,target.id);
        } else if (!isClosed(target) && !target.relatedTaskIds.includes(related.id) && target.relatedTaskIds.length < 10) {
          add(target,null,target.title,target.nextAction,reason,target.id,{relatedTaskIds:[...target.relatedTaskIds,related.id]});
        } else {
          proposals.push(information(reason + ' Diga se a pendência separada pode ser cancelada.',target.id));
        }
        lastTask = target;
        continue;
      }
      if (targets.length && references.length && (targets.length > 1 || references.length > 1)) {
        proposals.push({...information('O relato indica que dois assuntos estão juntos. Confirme qual pendência está coberta pela outra.'),
          candidateIds:[...new Set([...targets,...references].map((task) => task.id))]});
        continue;
      }
    }
    if (create.test(clause) && (taskIds.length || /\b(?:vinculad[oa]|relacionad[oa]|dependente)\b/.test(clause))) {
      const ids = taskIds.length ? [...new Set(taskIds)] : lastTask ? [lastTask.id] : [];
      const title = clause.replace(create,'').replace(/\s+(?:vinculad[oa]|relacionad[oa]|dependente)\b.*$/, '').trim();
      if (!ids.length || ids.some((id) => !known.has(id)) || title.length < 5) {
        proposals.push(information('Para criar uma pendência vinculada, diga a nova ação e o ID da pendência relacionada.'));
        continue;
      }
      const linked = tasks.find((task) => task.id === ids[0]);
      const dependency = /\b(?:dependente|depende de|bloquead[oa] por)\b/.test(clause);
      add(null,'nao_iniciado',displayTitle(title),'Revisar e definir a próxima ação.',
        'Nova pendência com ' + (dependency ? 'dependência operacional de ' : 'vínculo gerencial com ') + ids.join(', ') + '.',
        title,{topic:linked.topic,[dependency ? 'blockedByIds' : 'relatedTaskIds']:ids});
      continue;
    }
    const relationship = /\b(?:vincul\w*|ligue|ligar|relacion\w*|depend\w*|bloque\w*)\b/.test(clause);
    if (relationship && taskIds.length === 2 && taskIds.every((id) => known.has(id)) && taskIds[0] !== taskIds[1]) {
      const blocker = /\b(?:depende|dependente|bloquead[oa]|bloqueia|desbloqueia)\b/.test(clause);
      const reverse = /\b(?:bloqueia|desbloqueia)\b/.test(clause);
      const [from,to] = reverse ? [...taskIds].reverse() : taskIds;
      const base = tasks.find((task) => task.id === from);
      const field = blocker ? 'blockedByIds' : 'relatedTaskIds';
      const current = proposals[seen.get(from)]?.values?.[field] || base[field];
      const remove = /\b(?:remov\w*|tir\w*|desvincul\w*|nao depende)\b/.test(clause);
      const ids = remove ? current.filter((id) => id !== to) : [...new Set([...current,to])];
      if (ids.length > 10 || ids.length === current.length) {
        proposals.push(information('Confira os vínculos de ' + from + '. A relação pedida já está nessa situação ou atingiu o limite.',from));
      } else {
        add(base,null,base.title,base.nextAction,(remove ? 'Remover ' : 'Registrar ') + (blocker ? 'dependência operacional de ' : 'vínculo gerencial com ') + to + '.',from,{[field]:ids});
      }
      lastTask = base;
      continue;
    }
    if (mentioned.length > 1 || taskIds.length > 1) {
      proposals.push(information('Separe a fala em uma ação por empresa ou por pendência para que eu encontre o registro certo.'));
      continue;
    }
    if (taskIds.length === 1) {
      const base = tasks.find((task) => task.id === taskIds[0]);
      if (base) lastTask = base;
      const cancelRecord = (/\b(?:pode cancelar|cancele|cancela|cancelar|pode descartar|nao precisa mais)\b/.test(clause)
        || /\bnao faz sentido (?:ter|manter|deixar) (?:uma |a |essa |esta )?pendencia\b/.test(clause))
        && !/\b(?:nao cancele|nao cancelar|nao pode cancelar|talvez)\b/.test(clause);
      if (base && cancelRecord) {
        add(base,'cancelado',base.title,'Nenhuma ação pendente após o cancelamento da pendência.',
          'Cancelamento da pendência solicitado no relato. Confirme que ela deixou de ser necessária.',base.id);
      } else if (base && action && action !== 'pending') {
        add(base,action === 'done' ? 'resolvido' : 'em_andamento',base.title,
          action === 'done' ? 'Nenhuma ação pendente conforme o relato.' : base.nextAction,
          action === 'done' ? 'Conclusão informada no ditado.' : 'Início informado no ditado.',base.id);
      } else if (!base || base.id !== office?.id) {
        proposals.push(information(base ? 'Diga se a pendência foi concluída ou iniciada, ou abra o detalhe para registrar outro tipo de mudança.'
          : 'Não encontrei a pendência mencionada.',base?.id));
      }
      continue;
    }
    if (!kind && mentioned[0]?.cancellation && action === 'done' && /\b(?:internet|tv a cabo|net claro)\b/.test(clause)
      && !/\b(?:reparo|conserto|sinal|voltou|instalacao)\b/.test(clause)) {
      kind = 'cancellation';
    }
    if (context && kind && action) {
      if (/\b(?:talvez|acho que|parece que|sera que|nao precis[ao]|se foi|se esta)\b/.test(clause)) {
        proposals.push(information('A situação foi descrita como incerta ou dispensada. Confirme o que ocorreu antes de alterar a pendência.'));
        continue;
      }
      const spokenPeriod = kind === 'payment' && months.find((month) => new RegExp('\\b' + month + '\\b').test(clause));
      const lastBill = kind === 'payment' ? recentBills.get(context.name) : null;
      const period = spokenPeriod || lastBill?.period;
      const year = kind === 'payment' && (clause.match(/\b20\d{2}\b/)?.[0] || (!spokenPeriod && lastBill?.year));
      if (period) recentBills.set(context.name,{period,year});
      const matches = matchingTasks(tasks,context,kind,period,year);
      if (matches.length > 1) {
        proposals.push(information('Encontrei mais de um registro para essa ação. Diga o ID da pendência ou indique o mês e o ano.'));
        continue;
      }
      if (kind === 'payment' && !period && !matches.length) {
        proposals.push(information('Qual é o mês da fatura de ' + context.name + '? Assim o pagamento fica separado dos outros meses.'));
        continue;
      }
      const [label,next] = subject(kind,period);
      const title = context.name + ' — ' + label + (year ? ' de ' + year : '');
      const status = action === 'done' ? 'resolvido' : action === 'started' ? 'em_andamento'
        : kind === 'payment' ? 'pagamento_pendente' : 'a_conferir';
      const base = matches[0];
      if (base) lastTask = base;
      if (base?.statusCode === status && action !== 'done' && !seen.has(base.id)) {
        proposals.push(information(base.id + ' já está registrada nessa situação.',base.id));
        continue;
      }
      add(base,status,title,action === 'done' ? 'Nenhuma ação pendente conforme o relato.' : base?.nextAction || next,
        action === 'done' ? 'Conclusão informada no ditado. Confira se o escopo está correto.'
          : 'Providência identificada no relato. Confira a próxima ação.',base?.id || title,
        !base && kind === 'payment' && known.has(context.ownership) ? {relatedTaskIds:[context.ownership]} : {});
      continue;
    }
    if (create.test(clause)) {
      const title = clause.replace(create,'').trim();
      if (title.length >= 5) {
        add(null,'nao_iniciado',displayTitle(title),'Revisar e definir a próxima ação.',
          'Nova pendência solicitada no relato. Revise o título e o assunto antes de gravar.',title);
        continue;
      }
    }
    const matches = matchLocalTasks(clause,tasks);
    if (matches.length === 1) {
      const [task] = matches;
      const status = generalTaskStatus(clause,task);
      if (status) {
        const reason = {cancelado:'A pendência deixou de ser necessária, conforme o relato.',
          resolvido:'O relato informa a conclusão desta pendência.',em_andamento:'O relato informa que a pendência foi iniciada.'}[status];
        const nextAction = status === 'em_andamento' ? task.nextAction : 'Nenhuma ação pendente neste item conforme o relato.';
        add(task,status,task.title,nextAction,reason,task.id);
        lastTask = task;
        continue;
      }
    }
    const unresolvedAction = office ? action && ((kind && kind !== 'ownership') || done.test(clause)) : action || kind;
    if (mentioned.length || unresolvedAction) unmatched = true;
  }

  const completed = new Set(proposals.filter((p) => p.base && p.operation === 'complete').map((p) => p.base.id));
  if (completed.size) {
    for (const task of tasks.filter((t) => !isClosed(t) && !completed.has(t.id) && t.blockedByIds.some((id) => completed.has(id)))) {
      if (task.blockedByIds.every((id) => completed.has(id) || tasks.some((t) => t.id === id && t.statusCode === 'resolvido'))) {
        proposals.push(information('Se as conclusões propostas forem confirmadas, esta pendência poderá avançar. Seu status ainda precisa de revisão.',task.id));
      }
    }
  }
  if (unmatched || !proposals.length) {
    const matches = relatedTaskMatches(input,tasks);
    const related = (matches.length ? matches : candidates(input,tasks))
      .filter((task) => !seen.has(task.id)).slice(0,3).map((task) => task.id);
    proposals.push({...information(proposals.length ? 'Alguns trechos ainda precisam de esclarecimento. Diga qual pendência e o que deve mudar.'
      : related.length ? 'Encontrei possíveis pendências relacionadas. Abra uma delas para conferir os detalhes.'
        : 'Não encontrei uma alteração nem uma pendência relacionada.'),candidateIds:related});
  }
  return {summary:conditionalNotice ? 'A proposta é conferir se já houve aviso e só entrar em contato se for necessário.'
    : proposals.some((item) => item.values) ? 'Confira as sugestões abaixo e decida o que fazer em cada uma.'
      : 'Veja abaixo o que a análise encontrou. Nenhuma alteração foi gravada.',
    proposals,localService:context?.name ?? null,localTaskId:lastTask?.id ?? null};
}
