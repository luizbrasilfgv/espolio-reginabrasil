import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { api, credential } from './credentials.mjs';

const {values:args,positionals:[action]} = parseArgs({allowPositionals:true,options:{
  project:{type:'string'}, site:{type:'string'}, 'firebase-cli':{type:'boolean'}, apply:{type:'boolean'}
}});
if (!args.project || !args.site || args.project === args.site) throw Error('Informe --project e --site exclusivo.');
const project = encodeURIComponent(args.project);
const domain = args.site + '.web.app';
const auth = credential(args['firebase-cli']);
const rulesBase = 'https://firebaserules.googleapis.com/v1/';
const authBase = 'https://identitytoolkit.googleapis.com/admin/v2/projects/' + project;
const configUrl = authBase + '/config';
const providerUrl = authBase + '/defaultSupportedIdpConfigs/google.com';
if (action === 'auth-domain') {
  const [config,provider] = await Promise.all([api(auth,configUrl),api(auth,providerUrl)]);
  if (!provider.enabled) throw Error('Habilite o provedor Google no Firebase Auth.');
  const domains = config.authorizedDomains || [];
  if (!domains.includes(domain) && args.apply) {
    const result = await api(auth,configUrl + '?updateMask=authorizedDomains',{
      method:'PATCH',body:JSON.stringify({authorizedDomains:[...domains,domain]})
    });
    if (!result.authorizedDomains?.includes(domain)) throw Error('Domínio não confirmado.');
  }
  console.log(JSON.stringify({googleEnabled:true,domain,authorized:domains.includes(domain) || !!args.apply,existingDomainCount:domains.length}));
} else if (action === 'prepare' || action === 'verify-rules') {
  const release = await api(auth,rulesBase + 'projects/' + project + '/releases/cloud.firestore');
  if (action === 'verify-rules') {
    if (release.rulesetName !== (await readFile('.firebase/atlas-ruleset.txt','utf8')).trim()) throw Error('O ruleset mudou. Refaça a revisão.');
    console.log('Rules originais ainda são as mesmas.');
  } else {
    const old = await api(auth,rulesBase + release.rulesetName);
    const files = old.source.files;
    if (files.length !== 1) throw Error('Rules multifile exigem revisão manual.');
    const legacy = files[0].content;
    const scoped = await readFile('firestore.rules','utf8');
    const fence = '    match /estates/regina {';
    const end = '    match /{document=**} { allow read, write: if false; }';
    if (!legacy.includes(end) || legacy.includes(fence)) throw Error('Rules atuais exigem revisão manual.');
    const section = scoped.slice(scoped.indexOf(fence),scoped.lastIndexOf('\n  }\n}'));
    if (!section.startsWith(fence)) throw Error('Bloco do espólio ausente.');
    const settings = JSON.parse(await readFile('firebase.json','utf8'));
    settings.firestore.rules = '.firebase/atlas-merged.rules';
    settings.hosting.target = 'espolio';
    await mkdir('.firebase',{recursive:true});
    await writeFile('.firebase/atlas-original.rules',legacy);
    await writeFile('.firebase/atlas-merged.rules',legacy.replace(end,section + '\n\n' + end));
    await writeFile('.firebase/atlas-ruleset.txt',release.rulesetName + '\n');
    await writeFile('firebase.production.local.json',JSON.stringify(settings,null,2));
    console.log('Rules originais copiadas. A configuração de deploy aponta somente para o segundo site.');
  }
} else throw Error('Ações válidas: prepare, verify-rules, auth-domain.');
