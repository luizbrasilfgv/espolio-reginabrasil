import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const site = 'http://127.0.0.1:5000';
const project = 'demo-espolio-regina';
const run = promisify(execFile);
const localChrome = process.env.BROWSER_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome','/usr/bin/chromium'
].find(existsSync);
const out = 'test-results';
async function fakeGoogle(name, email) {
  const postBody = new URLSearchParams({providerId:'google.com',id_token:JSON.stringify({
    sub:'google-' + email, email, name, email_verified:true
  })});
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-api-key',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({postBody:postBody.toString(),requestUri:site,returnSecureToken:true})
  });
  assert.ok(response.ok,await response.clone().text());
  return response.json();
}
async function login(page,email) {
  const waiting = page.waitForEvent('popup');
  await page.getByRole('button',{name:'Continuar com Google'}).click();
  const popup = await waiting;
  await popup.getByText(email,{exact:true}).click({timeout:15000});
}
const heading = (page,name) => page.getByRole('heading',{name,exact:true,level:1}).waitFor();
async function nav(page,name) {
  await page.getByRole('navigation',{name:'Navegação principal'}).getByRole('link',{name,exact:true}).click();
}
async function seed(adminEmail,apply) {
  const args = ['scripts/seed-tasks.mjs','--project',project,'--admin-email',adminEmail];
  if (apply) args.push('--apply');
  return (await run(process.execPath,args,{env:process.env,timeout:15000})).stdout;
}
test('PWA com Google simulado, aprovação, atualização, exportação e revogação',{timeout:115000},async () => {
  assert.ok(localChrome,'Defina BROWSER_PATH para Chrome ou Edge.');
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const admin = 'admin@example.test', guest = 'editor@example.test';
  await fakeGoogle('Administrador de teste',admin);
  await fakeGoogle('Editor de teste',guest);
  assert.match(await seed(admin,false),/"existing": 0/);
  assert.match(await seed(admin,true),/Importação confirmada/);
  assert.match(await seed(admin,true),/"missing": \[\]/);
  const adminApp = initializeApp({projectId:project});
  const db = getFirestore(adminApp);
  assert.equal((await db.collection('estates/regina/tasks').count().get()).data().count,34);
  const browser = await chromium.launch({executablePath:localChrome,headless:true,args:['--no-sandbox','--disable-gpu']});
  try {
    await mkdir(out,{recursive:true});
    const mobile = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
    await mobile.addInitScript(() => {
      window.SpeechRecognition = class {
        start() {
          queueMicrotask(() => {
            const result = [{transcript:'A internet e a TV a cabo da Claro Net já está resolvido. Vincule P01 a P11.'}];
            result.isFinal = true;
            this.onresult({results:[result]});
            this.onend();
          });
        }
      };
    });
    const desktop = await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
    // Avoid the optional stylesheets loaded by the emulator login widget.
    for (const context of [mobile,desktop]) await context.route(/^https:\/\/(fonts\.googleapis\.com|unpkg\.com)\//,(r) => r.abort());
    const view = await mobile.newPage(), manager = await desktop.newPage();
    const errors = [];
    const messages = [];
    for (const page of [view,manager]) {
      page.on('pageerror',(error) => errors.push(error.message));
      page.on('console',(event) => { if (event.type() === 'error' || event.type() === 'debug') messages.push(event.text()); });
    }
    await view.goto(site);
    await heading(view,'Bem-vindo ao painel');
    await view.evaluate(async () => navigator.serviceWorker.ready.then(() => true));
    const manifest = await (await view.request.get(site + '/manifest.webmanifest')).json();
    assert.equal(manifest.display,'standalone');
    for (const icon of manifest.icons) assert.ok((await view.request.get(site + icon.src)).ok());
    await login(view,guest);
    await heading(view,'Solicite seu acesso');
    assert.equal(await view.getByText('Painel do espólio').count(),0);
    await view.getByRole('button',{name:'Solicitar acesso'}).click();
    await heading(view,'Acesso pendente');
    await manager.goto(site);
    await login(manager,admin);
    await heading(manager,'Painel do espólio');
    await manager.locator('.kpi').first().getByText('34',{exact:true}).waitFor();
    assert.deepEqual(await manager.locator('.kpi strong').allTextContents(),['34','3','1','30']);
    await manager.screenshot({path:out + '/desktop-1440.png'});
    await nav(manager,'Mais');
    await manager.getByRole('link',{name:'Gestão de acessos'}).click();
    await manager.getByRole('button',{name:'Aprovar editor'}).click();
    await manager.getByRole('button',{name:'Confirmar decisão'}).click();
    await heading(view,'Painel do espólio');
    await view.locator('.kpi').first().getByText('34',{exact:true}).waitFor();
    await view.screenshot({path:out + '/mobile-390.png'});
    for (const width of [360,390,768,1440]) {
      await view.setViewportSize({width,height:900});
      assert.ok(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth),String(width));
    }
    await view.setViewportSize({width:390,height:844});
    await nav(view,'Pendências');
    await view.getByRole('searchbox',{name:'Buscar pendências'}).fill('P11');
    await view.locator('.task-row[href="#/pendencia/P11"]').click();
    await heading(view,'Naturgy — forma de pagamento e débito automático');
    await view.getByRole('button',{name:'Editar',exact:true}).click();
    await view.getByRole('textbox',{name:'Próxima ação',exact:true}).fill('Conferir com o atendimento de teste.');
    await view.getByRole('button',{name:'Revisar alteração'}).click();
    assert.match(await view.locator('dialog').innerText(),/Antes \/ Depois/);
    const before = await db.doc('estates/regina/tasks/P11').get();
    assert.equal(before.get('version'),1);
    await view.getByRole('button',{name:'Confirmar gravação'}).click();
    try {
      await view.getByText('P11 gravada com histórico.').first().waitFor({timeout:8000});
    } catch (error) {
      console.error('Gravação', (await db.doc('estates/regina/tasks/P11').get()).get('version'),
        'alerta', await view.locator('dialog [role=alert]').allTextContents(), 'dialog', await view.locator('dialog').innerText(), 'notice', await view.locator('.banner').allTextContents(), errors, messages.slice(-10));
      throw error;
    }
    assert.equal((await db.doc('estates/regina/tasks/P11').get()).get('version'),2);
    await view.getByText('Atualização · versão 2').waitFor();
    await mobile.setOffline(true);
    await view.getByText('Sem conexão. Os dados carregados',{exact:false}).waitFor();
    await heading(view,'Naturgy — forma de pagamento e débito automático');
    await mobile.setOffline(false);
    await nav(view,'Atualizar');
    await view.getByRole('button',{name:'Iniciar ditado'}).click();
    const suggestion = view.locator('.proposal').filter({hasText:'Concluir · P01'});
    await suggestion.getByRole('heading',{name:'Concluir · P01'}).waitFor();
    assert.equal((await db.doc('estates/regina/tasks/P01').get()).get('statusCode'),'em_andamento');
    await suggestion.getByRole('button',{name:'Aprovar e gravar',exact:true}).click();
    await view.getByLabel('Conferi os fatos e o escopo desta alteração.').check();
    await view.getByRole('button',{name:'Confirmar e gravar esta alteração'}).click();
    await suggestion.getByText('Gravada',{exact:true}).waitFor();
    const concluded = await db.doc('estates/regina/tasks/P01').get();
    assert.equal(concluded.get('statusCode'),'resolvido');
    assert.ok(!concluded.get('relatedTaskIds').includes('P11'));
    const claroLink = view.locator('.proposal').filter({hasText:'Registrar vínculo gerencial com P11 · P01'});
    await claroLink.getByRole('button',{name:'Rejeitar',exact:true}).click();
    await claroLink.getByText('Rejeitada',{exact:true}).waitFor();
    assert.equal((await db.doc('estates/regina/tasks/P11').get()).get('statusCode'),'a_conferir');
    await view.getByRole('button',{name:'Nova fala',exact:true}).click();
    const editor = view.getByRole('textbox',{name:'Texto da atualização'});
    await editor.fill('O escritório Meirelles, Quintela. A gente vai mandar a documentação. Eles já mandam o que a gente precisa enviar pra eles. A gente precisa mandar CPF, identidade, comprovante de residência. Um familiar já me mandou, eu estou juntando meu, vou mandar a certidão de óbito, e ela vai mandar pro escritório de volta.');
    await view.getByRole('button',{name:'Analisar e mostrar alterações'}).click();
    await view.getByRole('heading',{name:'Revisar alterações uma por uma'}).waitFor();
    const office = view.locator('.proposal').filter({has:view.getByRole('heading',{name:'Atualizar · U02',exact:true})});
    const documents = view.locator('.proposal').filter({has:view.getByRole('heading',{name:'Atualizar · U01',exact:true})});
    const officeLink = view.locator('.proposal').filter({hasText:'Registrar vínculo gerencial com U01 · U02'});
    await office.getByRole('button',{name:'Aprovar e gravar',exact:true}).click();
    await office.getByText('Gravada',{exact:true}).waitFor();
    let storedOffice = await db.doc('estates/regina/tasks/U02').get();
    assert.equal(storedOffice.get('statusCode'),'em_andamento');
    assert.ok(!storedOffice.get('relatedTaskIds').includes('U01'));
    assert.equal((await db.doc('estates/regina/tasks/U01').get()).get('version'),1);
    await documents.getByRole('button',{name:'Editar',exact:true}).click();
    await view.getByRole('textbox',{name:'Próxima ação',exact:true}).fill('Conferir a certidão de óbito antes do envio.');
    await view.getByRole('button',{name:'Aplicar à proposta'}).click();
    assert.equal((await db.doc('estates/regina/tasks/U01').get()).get('version'),1);
    await documents.getByRole('button',{name:'Aprovar e gravar',exact:true}).click();
    await documents.getByText('Gravada',{exact:true}).waitFor();
    assert.equal((await db.doc('estates/regina/tasks/U01').get()).get('nextAction'),'Conferir a certidão de óbito antes do envio.');
    await officeLink.getByRole('button',{name:'Aprovar e gravar',exact:true}).click();
    await officeLink.getByText('Gravada',{exact:true}).waitFor();
    storedOffice = await db.doc('estates/regina/tasks/U02').get();
    assert.ok(storedOffice.get('relatedTaskIds').includes('U01'));
    assert.equal(storedOffice.get('statusCode'),'em_andamento');
    await view.getByRole('button',{name:'Nova fala',exact:true}).click();
    await editor.fill('A conta de água e esgoto vem no mesmo boleto do condomínio, então não precisamos manter uma cobrança separada.');
    await view.getByRole('button',{name:'Analisar e mostrar alterações'}).click();
    const water = view.locator('.proposal').filter({has:view.getByRole('heading',{name:'Cancelar · P13',exact:true})});
    await water.getByRole('button',{name:'Aprovar e gravar',exact:true}).click();
    assert.equal((await db.doc('estates/regina/tasks/P13').get()).get('statusCode'),'nao_iniciado');
    await view.getByLabel('Conferi os fatos e o escopo desta alteração.').check();
    await view.getByRole('button',{name:'Confirmar e gravar esta alteração'}).click();
    await water.getByText('Gravada',{exact:true}).waitFor();
    assert.equal((await db.doc('estates/regina/tasks/P13').get()).get('statusCode'),'cancelado');
    assert.equal((await db.doc('estates/regina/tasks/P04').get()).get('version'),1);
    await view.getByRole('textbox',{name:'Texto da atualização'}).fill('Texto de exemplo sem envio.');
    await nav(manager,'Painel');
    await manager.getByRole('link',{name:'33 Total sem canceladas'}).waitFor();
    await manager.getByText('12,1% concluído',{exact:true}).waitFor();
    await manager.getByRole('link',{name:'33 Total sem canceladas'}).click();
    await manager.getByText('33 pendência(s)',{exact:true}).waitFor();
    await nav(manager,'Painel');
    await manager.getByRole('link',{name:'1 Canceladas'}).click();
    await manager.getByText('P13',{exact:true}).waitFor();
    await nav(manager,'Mais');
    await manager.getByRole('link',{name:'Relatórios e exportação'}).click();
    const report = await manager.locator('#whatsapp').inputValue();
    assert.match(report,/Resolvidas no controle: P01, P02, P03, P12/);
    assert.match(report,/Agendadas: U10/);
    assert.doesNotMatch(report,/1234567891|escritorio@example.test/);
    const download = manager.waitForEvent('download');
    await manager.getByRole('button',{name:'JSON',exact:true}).click();
    const file = await (await download).path();
    const snapshot = JSON.parse(await readFile(file,'utf8'));
    assert.equal(snapshot.tasks.length,34);
    assert.ok(snapshot.tasks.every((t) => !('protocolText' in t) && !('contactText' in t)));
    await nav(manager,'Mais');
    await manager.getByRole('link',{name:'Gestão de acessos'}).click();
    await manager.getByRole('button',{name:'Alterar acesso'}).click();
    await manager.locator('dialog select[name=status]').selectOption('revoked');
    await manager.getByRole('button',{name:'Confirmar decisão'}).click();
    await view.getByRole('heading',{name:/Acesso revogado|Acesso indisponível/}).waitFor();
    assert.equal(await view.getByText('Texto de exemplo sem envio.').count(),0);
    assert.deepEqual(errors,[]);
    const cache = await view.evaluate(async () => (await Promise.all((await caches.keys()).map(async (key) =>
      (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname)))).flat());
    assert.ok(cache.length > 5);
    assert.ok(cache.every((path) => /^\/(?:assets\/|icon-|offline\.html|mark\.svg|manifest\.webmanifest|$)/.test(path)));
  } finally {
    await browser.close();
    await deleteApp(adminApp);
  }
});
