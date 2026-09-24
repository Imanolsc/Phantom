/* Adaptador de la API para GitHub Pages + Supabase. Los datos del entrenamiento
   viven en Postgres; localStorage solo contiene la sesión de autenticación. */
(() => {
  const cfg = window.FUERZA_SUPABASE || {};
  const sessionKey = 'fuerza.supabase.session.v1';
  const validConfig = () => cfg.url && cfg.publicKey && !cfg.url.includes('YOUR_PROJECT_REF') && !cfg.publicKey.startsWith('YOUR_');
  const getSession = () => { try { return JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch { return null; } };
  const putSession = s => s ? localStorage.setItem(sessionKey, JSON.stringify(s)) : localStorage.removeItem(sessionKey);
  const normalizedUser = p => ({ id: p.id, username: p.username, role: p.role });
  const usernameEmail = username => `u-${btoa(username.toLowerCase()).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}@accounts.fuerza.app`;
  async function request(path, { method='GET', body, token, keepalive=false, headers={} } = {}) {
    if (!validConfig()) throw new Error('Falta configurar wwwroot/supabase-config.js con la URL y la clave pública de Supabase.');
    const session = getSession();
    const base = path.startsWith('/functions/v1/') ? (cfg.functionsUrl || `${cfg.url.replace(/\/$/,'')}/functions/v1`) : cfg.url.replace(/\/$/,'');
    const requestPath = path.startsWith('/functions/v1/') ? path.slice('/functions/v1'.length) : path;
    const response = await fetch(`${base}${requestPath}`, {
      method, keepalive, headers: { apikey: cfg.publicKey, ...(token === null ? {} : token || session?.access_token ? { Authorization: `Bearer ${token || session.access_token}` } : {}), ...(body === undefined ? {} : { 'Content-Type':'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const result = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) { const message = result?.msg || result?.message || result?.error_description || result?.error || `Error ${response.status}`; const error = new Error(message); error.status=response.status; throw error; }
    return result;
  }
  async function refreshSession() {
    const s=getSession(); if (!s?.refresh_token) return false;
    try { putSession(await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:s.refresh_token},token:null})); return true; } catch { putSession(null); return false; }
  }
  async function api(url, options={}, didRefresh=false) {
    const method=(options.method||'GET').toUpperCase(), body=options.body ? JSON.parse(options.body) : undefined;
    try {
      if (url==='/api/auth/login' && method==='POST') {
        const s=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:usernameEmail(body.username),password:body.password},token:null}); putSession(s);
        const rows=await request('/rest/v1/profiles?select=id,username,role&limit=1'); return normalizedUser(rows[0]);
      }
      if (url==='/api/auth/logout' && method==='POST') { try { await request('/auth/v1/logout',{method:'POST'}); } finally { putSession(null); } return null; }
      if (url==='/api/me' && method==='GET') { const rows=await request('/rest/v1/profiles?select=id,username,role&limit=1'); return normalizedUser(rows[0]); }
      if (url==='/api/me/data' && method==='GET') { const rows=await request('/rest/v1/user_workspaces?select=document&limit=1'); return rows[0]?.document || {categories:[],exercises:[],routines:[],workouts:[],activeWorkout:null}; }
      if (url==='/api/me/data' && method==='PUT') { await request('/rest/v1/rpc/save_workspace',{method:'POST',body:{p_document:body},keepalive:options.keepalive}); return null; }
      if (url==='/api/me/profile' && method==='PUT') return callFunction('manage-users',{action:'update-self',username:body.username});
      if (url==='/api/me/password' && method==='PUT') return callFunction('manage-users',{action:'change-own-password',currentPassword:body.currentPassword,newPassword:body.newPassword});
      if (url==='/api/admin/users/' && method==='GET') return callFunction('manage-users',null,'GET');
      if (url==='/api/admin/users' && method==='POST') return callFunction('manage-users',{action:'create-user',...body});
      const match=url.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (match && method==='PUT') return callFunction('manage-users',{action:'update-user',id:match[1],...body});
      if (match && method==='DELETE') return callFunction('manage-users',{action:'delete-user',id:match[1]},'DELETE');
      throw new Error(`Ruta no reconocida: ${url}`);
    } catch (err) {
      if (err.status===401 && !didRefresh && url!=='/api/auth/login' && await refreshSession()) return api(url,options,true);
      if (err.status===401 && url!=='/api/auth/login') { putSession(null); if (typeof window.render==='function') window.render(); }
      throw err;
    }
  }
  async function callFunction(name, body, method='POST') {
    const session=getSession(); const headers={};
    if (method==='GET') return request(`/functions/v1/${name}`,{method,headers});
    if (method==='DELETE') return request(`/functions/v1/${name}?id=${encodeURIComponent(body.id)}`,{method,headers});
    return request(`/functions/v1/${name}`,{method,body,headers});
  }
  window.api=api;
})();
