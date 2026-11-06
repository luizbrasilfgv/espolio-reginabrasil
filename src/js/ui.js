export function h(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[ch]);
}
const paths = {
  home:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8m-8 5h8"/>',
  mic:'<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1m-6 7v3m-3 0h6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  calendar:'<rect x="4" y="6" width="16" height="15" rx="2"/><path d="M8 3v6m8-6v6M4 11h16"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
  back:'<path d="M20 12H5m6 6-6-6 6-6"/>', lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  exit:'<path d="M10 17v3H4V4h6v3m-2 5h13m-4-4 4 4-4 4"/>',
  down:'<path d="M12 3v12m-5-5 5 5 5-5m-13 7v4h16v-4"/>',
  people:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1"/>',
  link:'<path d="m9 15 6-6m-6 9-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m0 6a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1"/>'
};
export const icon = (name) => '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.list) + '</svg>';
export const brand = () => '<a class="brand" href="#/painel"><img src="/mark.svg" alt="" width="42" height="42"><span><strong>Espólio Regina Brasil</strong><small>Painel familiar privado</small></span></a>';
export const route = (page, params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, value]) => value));
  return '#/' + page + (q.size ? '?' + q.toString() : '');
};
export const taskRoute = (id) => route('pendencia/' + encodeURIComponent(id));
export const btn = (label, action, style = '', extra = '') =>
  '<button type="button" class="' + h(style) + '" data-action="' + h(action) + '" ' + extra + '>' + label + '</button>';
export const go = (label, href, style = '') => '<a class="btn ' + h(style) + '" href="' + h(href) + '">' + label + '</a>';
export const empty = (title, note = '', symbol = 'list') => '<div class="empty panel">' + icon(symbol)
  + '<h2>' + h(title) + '</h2><p class="muted">' + h(note) + '</p></div>';
export const banner = (text, type = '') => text ? '<p class="banner ' + h(type) + '" role="' + (type === 'error' ? 'alert' : 'status') + '">' + h(text) + '</p>' : '';
export const header = (kicker, title, note = '', actions = '') => '<header class="page-head"><div><p class="kicker">' + h(kicker)
  + '</p><h1 tabindex="-1">' + h(title) + '</h1>' + (note ? '<p>' + h(note) + '</p>' : '') + '</div>' + (actions ? '<div class="row">' + actions + '</div>' : '') + '</header>';
export const option = (value, label, selected) => '<option value="' + h(value) + '"' + (value === selected ? ' selected' : '') + '>' + h(label) + '</option>';
export const select = (label, name, options, value, blank = null) => '<label>' + h(label) + '<select name="' + h(name) + '">'
  + (blank == null ? '' : option('', blank, value)) + Object.entries(options).map(([v,l]) => option(v,l,value)).join('') + '</select></label>';
export const input = (label, name, value = '', attrs = '', type = 'text') => '<label>' + h(label) + '<input type="' + h(type)
  + '" name="' + h(name) + '" value="' + h(value) + '" ' + attrs + '></label>';
export const textarea = (label, name, value = '', attrs = '') => '<label>' + h(label) + '<textarea name="' + h(name)
  + '" ' + attrs + '>' + h(value) + '</textarea></label>';
export const check = (label, name, value = false, attrs = '') => '<label class="check"><input type="checkbox" name="' + h(name)
  + '"' + (value ? ' checked' : '') + ' ' + attrs + '><span>' + h(label) + '</span></label>';

const nav = [
  ['painel','Painel','home'], ['pendencias','Pendências','list'], ['atualizar','Atualizar','mic'],
  ['atividade','Atividade','clock'], ['mais','Mais','more']
];
export function shell(page, user, role, html, notice) {
  const tab = ({pendencia:'pendencias',acessos:'mais',exportar:'mais',ajuda:'mais'})[page] || page;
  return '<aside class="sidebar">' + brand() + '<nav class="nav" aria-label="Navegação principal">'
    + nav.map(([id,label,key]) => '<a href="' + route(id) + '"' + (id === tab ? ' aria-current="page"' : '')
      + (id === 'atualizar' ? ' class="nav-update"' : '') + '>' + icon(key) + '<span>' + label + '</span></a>').join('')
    + '</nav><div class="nav-foot"><p><strong class="wrap">' + h(user) + '</strong><br><small class="muted">' + h(role) + '</small></p>'
    + btn(icon('exit') + ' Sair', 'logout', 'ghost') + '</div></aside><div class="shell"><div class="mobile-header">'
    + brand() + '</div><main id="conteudo" class="workspace stack" tabindex="-1">' + notice + html + '</main></div>';
}
export const gate = (title, note, body = '') => '<main id="conteudo" class="gate" tabindex="-1"><section class="panel stack">'
  + brand() + '<div><p class="kicker">Acesso privado</p><h1 tabindex="-1">' + h(title) + '</h1><p class="muted">' + h(note) + '</p></div>'
  + body + '</section></main>';
