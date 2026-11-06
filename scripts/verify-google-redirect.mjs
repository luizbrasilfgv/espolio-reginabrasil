import { api, credential } from './credentials.mjs';
const [project,site] = process.argv.slice(2);
if (!project || !site) throw Error('Informe o projeto e o site.');
const {clientId,enabled} = await api(credential(true),'https://identitytoolkit.googleapis.com/admin/v2/projects/' +
  encodeURIComponent(project) + '/defaultSupportedIdpConfigs/google.com');
if (!enabled || !clientId) throw Error('Provedor Google indisponível.');
const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
url.search = new URLSearchParams({client_id:clientId,redirect_uri:'https://' + site + '.web.app/__/auth/handler',
  response_type:'code',scope:'openid email profile',prompt:'select_account',state:'firebase-redirect-check'});
const response = await fetch(url,{redirect:'manual'});
const target = new URL(response.headers.get('location') || url, url);
if (/\/oauth\/error/i.test(target.pathname) || response.status >= 400) {
  throw Error('O Google não aceitou o redirecionamento OAuth do site. Cadastre /__/auth/handler no cliente Web.');
}
console.log('Início do OAuth verificado sem acessar conta pessoal. HTTP ' + response.status + ' · ' + target.hostname + target.pathname);
