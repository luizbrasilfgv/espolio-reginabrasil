import { createRequire } from 'node:module';
export function useCliFirestoreCredential(db) {
  const require = createRequire(import.meta.url);
  const cli = require('firebase-tools/lib/auth.js');
  const oauth = require('firebase-tools/lib/api.js');
  const token = cli.getProjectDefaultAccount(process.cwd())?.tokens?.refresh_token;
  if (!token) throw Error('Autentique a CLI com firebase login.');
  db.settings({credentials:{type:'authorized_user',client_id:oauth.clientId(),client_secret:oauth.clientSecret(),refresh_token:token}});
}
