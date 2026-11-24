// طبقة OneDrive (Microsoft Graph). كل البيانات داخل مجلد التطبيق فقط (approot).
const Graph = (() => {
  const G = 'https://graph.microsoft.com/v1.0', R = '/me/drive/special/approot', S = ['Files.ReadWrite.AppFolder'];
  let app;
  const P = p => `${R}:/${p}:`;
  const tok = async () => {
    try { return (await app.acquireTokenSilent({ scopes: S, account: app.getAllAccounts()[0] })).accessToken; }
    catch { return (await app.acquireTokenPopup({ scopes: S })).accessToken; }
  };
  const call = async (p, o = {}) => fetch(p.startsWith('http') ? p : G + p, { ...o, headers: { Authorization: 'Bearer ' + await tok(), ...(o.headers || {}) } });
  const need = r => { if (!r.ok) throw Object.assign(new Error('خطأ OneDrive ' + r.status), { status: r.status }); return r; };
  const jbody = (m, b) => ({ method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  return {
    async init() {
      app = new msal.PublicClientApplication({ auth: { clientId: CFG.CLIENT_ID, authority: 'https://login.microsoftonline.com/consumers', redirectUri: location.origin + location.pathname }, cache: { cacheLocation: 'sessionStorage' } });
      if (app.initialize) await app.initialize();
      return app.getAllAccounts().length > 0;
    },
    login: () => app.loginPopup({ scopes: S }),
    async mkdir(parent, name) {                       // created=true جديد، false موجود (409)
      const r = await call(parent ? `${P(parent)}/children` : `${R}/children`, jbody('POST', { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }));
      if (!r.ok && r.status !== 409) need(r);
      return { created: r.status === 201, id: r.ok ? (await r.json()).id : null };
    },
    async ensure(paths) { for (const p of paths) { const i = p.lastIndexOf('/'); await this.mkdir(i < 0 ? '' : p.slice(0, i), p.slice(i + 1)); } },
    async meta(path) { const r = await call(P(path)); if (r.status === 404) return null; return (await need(r)).json(); },
    async list(path) { const r = await need(await call(`${P(path)}/children?$select=id,name,size,webUrl&$top=999`)); return (await r.json()).value; },
    async getJson(path) {                              // {data, etag} أو null
      const m = await this.meta(path); if (!m) return null;
      const c = await need(await fetch(m['@microsoft.graph.downloadUrl']));
      return { data: await c.json(), etag: m.eTag };
    },
    async putJson(path, obj, { etag, createOnly } = {}) {   // true نجح، false تعارض (409/412)
      const q = createOnly ? '?@microsoft.graph.conflictBehavior=fail' : '';
      const r = await call(`${P(path)}/content${q}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) }, body: JSON.stringify(obj) });
      if (r.status === 409 || r.status === 412) return false;
      need(r); return true;
    },
    async upload(path, blob) {                         // جلسة رفع: تصلح للملفات الكبيرة (Master)
      const s = await need(await call(`${P(path)}/createUploadSession`, jbody('POST', { item: { '@microsoft.graph.conflictBehavior': 'replace' } })));
      const url = (await s.json()).uploadUrl, CH = 327680 * 10; let res;
      for (let o = 0; o < blob.size; o += CH) {
        const part = blob.slice(o, Math.min(o + CH, blob.size));
        res = await fetch(url, { method: 'PUT', headers: { 'Content-Range': `bytes ${o}-${o + part.size - 1}/${blob.size}` }, body: part });
        if (!res.ok && res.status !== 202) throw new Error('فشل الرفع ' + res.status);
      }
      return res.json();
    },
    async copyTo(srcPath, destFolderPath, name) {      // نسخ غير متزامن: نستنى ظهور الملف
      const src = await this.meta(srcPath), dest = await this.meta(destFolderPath);
      if (!src) throw new Error('ملف الـMaster غير موجود. ارفعه من لوحة المدير.');
      await need(await call(`/me/drive/items/${src.id}/copy`, jbody('POST', { parentReference: { id: dest.id }, name })));
      for (let i = 0; i < 40; i++) { await sleep(1500); const m = await this.meta(`${destFolderPath}/${name}`); if (m && m.size === src.size) return m; }
      throw new Error('النسخ لم يكتمل. حاول مرة أخرى.');
    },
    async blob(itemId, pdf) { const r = await need(await call(`/me/drive/items/${itemId}/content${pdf ? '?format=pdf' : ''}`)); return r.blob(); },
    async del(itemId) { await need(await call(`/me/drive/items/${itemId}`, { method: 'DELETE' })); }
  };
})();
