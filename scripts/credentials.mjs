import { createRequire } from 'node:module';
import { applicationDefault } from 'firebase-admin/app';
export function credential(useCli) {
  if (!useCli) return applicationDefault();
  const cli = createRequire(import.meta.url)('firebase-tools/lib/auth.js');
  const account = cli.getProjectDefaultAccount(process.cwd());
  if (!account?.tokens?.refresh_token) throw Error('Autentique a CLI com firebase login.');
  return {
    async getAccessToken() {
      const token = await cli.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
      return {access_token:token.access_token,expires_in:Math.max(1,Math.floor((token.expires_at - Date.now()) / 1000))};
    }
  };
}
export async function api(auth, url, options = {}) {
  const {access_token} = await auth.getAccessToken();
  const response = await fetch(url,{...options,headers:{Authorization:'Bearer ' + access_token,
    ...(options.body ? {'Content-Type':'application/json'} : {})}});
  const body = await response.json();
  if (!response.ok) throw Error((options.method || 'GET') + ' ' + new URL(url).pathname + ' → ' + response.status + ' ' + (body.error?.message || ''));
  return body;
}
