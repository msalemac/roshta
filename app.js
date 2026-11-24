// منطق التطبيق: الأدوار، المرضى، الروشتات. البيانات كلها على OneDrive.
const $ = s => document.querySelector(s), V = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROLES = { doctor: 'دكتور', reception: 'استقبال', admin: 'مدير' };
const st = { user: null, db: null, index: null, patient: null };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
const msg = (t, bad) => { const m = $('#msg'); m.textContent = t || ''; m.className = bad ? 'bad' : ''; };
const run = async f => { try { msg(''); await f(); } catch (e) { msg(e.message, 1); console.error(e); } };
const val = id => ($('#' + id)?.value || '').trim();

/* تشفير: PBKDF2 للأرقام السرية، HMAC لبصمة الرقم القومي */
const enc = new TextEncoder(), b64 = b => btoa(String.fromCharCode(...new Uint8Array(b))), ub64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));
async function pinHash(pin, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: ub64(salt), iterations: 150000 }, k, 256));
}
async function idHash(nid) {
  const k = await crypto.subtle.importKey('raw', ub64(st.db.idSalt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(nid)));
}

/* التشغيل والدخول */
const acts = {};
document.addEventListener('click', e => { const a = e.target.closest('[data-act]'); if (a) run(() => acts[a.dataset.act](a.dataset)); });
async function boot() {
  $('#ver').textContent = 'الإصدار ' + CFG.VERSION;
  if (CFG.CLIENT_ID.startsWith('ضع')) return (V.innerHTML = '<p class="bad">ضع الـClient ID في ملف js/config.js</p>');
  (await Graph.init()) ? afterMs() : (V.innerHTML = `<div class="card"><h2>الخطوة 1: حساب OneDrive</h2><p>سجّل الدخول بحساب OneDrive الخاص بالمركز.</p><button data-act="ms">تسجيل الدخول بحساب OneDrive</button></div>`);
}
acts.ms = async () => { await Graph.login(); await afterMs(); };
async function afterMs() {
  await run(async () => {
    msg('جاري التحضير…'); await Graph.ensure(['Users', 'Master', 'Patients', 'Index', 'Index/ids']);
    const r = await Graph.getJson('Users/users.json'); st.db = r ? r.data : null; msg('');
    r ? roleView() : setupView();
  });
}
function setupView() {
  V.innerHTML = `<div class="card"><h2>إعداد أول مرة: حساب المدير</h2>
   <label for="n">الاسم</label><input id="n"><label for="u">اسم الدخول</label><input id="u" dir="ltr"><label for="p">الرقم السري (6 أرقام أو أكثر)</label><input id="p" type="password" inputmode="numeric">
   <button data-act="setup">إنشاء</button></div>`;
}
acts.setup = async () => {
  const [name, u, pin] = [val('n'), val('u'), val('p')];
  if (!name || !u || pin.length < 6) throw new Error('أكمل الاسم واسم الدخول ورقم سري 6 أرقام على الأقل');
  const salt = newSalt(); st.db = { idSalt: newSalt(), users: [{ u, name, role: 'admin', salt, hash: await pinHash(pin, salt) }] };
  if (!(await Graph.putJson('Users/users.json', st.db, { createOnly: true }))) throw new Error('الإعداد تم بالفعل. أعد تحميل الصفحة.');
  roleView();
};
function roleView() {
  st.user = null; $('#who').replaceChildren();
  V.innerHTML = `<div class="card"><h2>الخطوة 2: اختر الدخول</h2>${Object.entries(ROLES).map(([k, v]) => `<button data-act="role" data-r="${k}">${v}</button>`).join('')}</div>`;
}
acts.role = ({ r }) => {
  const us = st.db.users.filter(x => x.role === r);
  V.innerHTML = `<div class="card"><h2>دخول: ${ROLES[r]}</h2>${us.length ? `<label for="who2">الاسم</label><select id="who2">${us.map(x => `<option value="${esc(x.u)}">${esc(x.name)}</option>`).join('')}</select>
   <label for="pin">الرقم السري</label><input id="pin" type="password" inputmode="numeric"><button data-act="login">دخول</button>` : '<p>لا يوجد مستخدمون بهذا الدور. اطلب من المدير إضافتك.</p>'}
   <button class="alt" data-act="back">رجوع</button></div>`;
};
acts.back = roleView;
acts.login = async () => {
  const u = st.db.users.find(x => x.u === val('who2'));
  if (!u || (await pinHash(val('pin'), u.salt)) !== u.hash) { await new Promise(r => setTimeout(r, 1200)); throw new Error('الرقم السري غير صحيح'); }
  st.user = u; $('#who').innerHTML = `${esc(u.name)} (${ROLES[u.role]}) <button data-act="out">خروج</button>`;
  u.role === 'admin' ? adminView() : searchView();
};
acts.out = roleView;

/* المرضى */
async function loadIndex(force) { if (!st.index || force) st.index = (await Graph.getJson('Index/patients.json'))?.data || { items: [] }; return st.index.items; }
async function searchView() {
  const rec = st.user.role === 'reception';
  V.innerHTML = `<div class="card"><h2>بحث عن مريض</h2><input id="q" placeholder="الاسم أو الكود أو التليفون"><button data-act="search">بحث</button></div><div id="res"></div>
   ${rec ? `<div class="card"><h2>تسجيل مريض جديد</h2><div class="row"><div><label for="pn">الاسم</label><input id="pn"></div><div><label for="pp">التليفون</label><input id="pp" inputmode="tel"></div><div><label for="pi">الرقم القومي للمستفيد</label><input id="pi" inputmode="numeric" maxlength="14"></div></div><button data-act="reg">تسجيل</button></div>` : ''}`;
  acts.search();
}
acts.search = async () => {
  const q = val('q').toLowerCase(), items = (await loadIndex(true)).filter(p => !q || [p.name, p.code, p.phone].some(x => String(x || '').toLowerCase().includes(q))).slice(0, 50);
  $('#res').innerHTML = `<div class="card">${items.length ? `<table>${items.map(p => `<tr><td>${esc(p.name)}</td><td dir="ltr">${esc(p.code)}</td><td><button data-act="open" data-c="${esc(p.code)}">فتح</button></td></tr>`).join('')}</table>` : '<p class="mut">لا توجد نتائج.</p>'}</div>`;
};
acts.reg = async () => {
  const [name, phone, nid] = [val('pn'), val('pp'), val('pi')];
  if (!name) throw new Error('اكتب اسم المريض');
  if (nid && !/^\d{14}$/.test(nid)) throw new Error('الرقم القومي لازم 14 رقم');
  let code, tries = 0;
  do { code = rnd(); if (++tries > 8) throw new Error('تعذر توليد كود. حاول مرة أخرى.'); } while (!(await Graph.mkdir('Patients', code)).created);
  if (nid) {                                       // منع تسجيل نفس المستفيد مرتين
    const h = await idHash(nid);
    if (!(await Graph.putJson(`Index/ids/${h}.json`, { code }, { createOnly: true }))) {
      const old = (await Graph.getJson(`Index/ids/${h}.json`)).data.code; await Graph.del((await Graph.meta(`Patients/${code}`)).id);
      msg('المريض مسجل بالفعل. تم فتح ملفه.'); return openPatient(old);
    }
  }
  await Graph.putJson(`Patients/${code}/patient.json`, { code, name, phone, nid, created: new Date().toISOString(), by: st.user.u });
  for (let i = 0; i < 6; i++) {                    // فهرس البحث مع قفل ETag
    const r = (await Graph.getJson('Index/patients.json')) || { data: { items: [] } };
    r.data.items.push({ code, name, phone });
    if (await Graph.putJson('Index/patients.json', r.data, r.etag ? { etag: r.etag } : { createOnly: true })) break;
  }
  msg('تم التسجيل. الكود: ' + code); await openPatient(code);
};
acts.open = ({ c }) => openPatient(c);

/* ملف المريض والروشتات */
async function openPatient(code) {
  const info = (await Graph.getJson(`Patients/${code}/patient.json`)).data, doc = st.user.role === 'doctor';
  let rows = '';
  if (doc) {
    const files = await Graph.list(`Patients/${code}`), by = {};
    files.forEach(f => { const m = f.name.match(/^(RX-\d{8}-\w+)\.(pdf|xlsx|json)$/); if (m) (by[m[1]] ||= {})[m[2]] = f; });
    for (const [base, f] of Object.entries(by).sort().reverse()) {
      const j = f.json ? (await Graph.getJson(`Patients/${code}/${base}.json`)).data : {};
      if (j.status === 'final' && j.date !== today() && f.xlsx) { await Graph.del(f.xlsx.id); delete f.xlsx; }   // تنظيف الإكسل بعد يوم الروشتة
      const can = f.xlsx && j.date === today() && j.doctor === st.user.u;
      rows += `<tr><td dir="ltr">${esc(j.date || base)}</td><td>${esc(j.doctorName || '')}</td><td>${j.status === 'final' ? 'نهائية' : 'مسودة'}</td><td>
        ${f.pdf ? `<button data-act="print" data-id="${f.pdf.id}">طباعة</button>` : ''}
        ${can ? `<a href="${esc(f.xlsx.webUrl)}" target="_blank" rel="noopener"><button class="alt">تعديل</button></a><button data-act="final" data-b="${base}" data-c="${code}" data-id="${f.xlsx.id}">حفظ نهائي</button>` : ''}</td></tr>`;
    }
  }
  V.innerHTML = `<div class="card"><h2>${esc(info.name)}</h2><p class="mut">الكود: <span dir="ltr">${esc(code)}</span> | التليفون: ${esc(info.phone || '—')}</p>
   ${doc ? `<button data-act="newrx" data-c="${code}">روشتة جديدة</button>` : ''}<button class="alt" data-act="home">رجوع للبحث</button></div>
   ${doc ? `<div class="card"><h2>الروشتات</h2>${rows ? `<table>${rows}</table>` : '<p class="mut">لا توجد روشتات.</p>'}</div>` : ''}`;
}
acts.home = searchView;
acts.newrx = async ({ c }) => {
  const d = today(), base = `RX-${d.replaceAll('-', '')}-${rnd().slice(0, 4)}`;
  msg('جاري نسخ القالب…');
  const m = await Graph.copyTo('Master/prescription-master.xlsx', `Patients/${c}`, base + '.xlsx');
  await Graph.putJson(`Patients/${c}/${base}.json`, { id: base, date: d, doctor: st.user.u, doctorName: st.user.name, status: 'draft' });
  window.open(m.webUrl, '_blank', 'noopener'); msg('اتفتحت الروشتة في Excel. بعد الكتابة وظهور «Saved» ارجع واضغط «حفظ نهائي».'); await openPatient(c);
};
acts.final = async ({ b, c, id }) => {
  msg('جاري تحويل الروشتة إلى PDF…');
  const pdf = await Graph.blob(id, true); if (pdf.size < 5000) throw new Error('الـPDF الناتج غير سليم. لم يتم الحفظ.');
  await Graph.upload(`Patients/${c}/${b}.pdf`, pdf);
  const j = (await Graph.getJson(`Patients/${c}/${b}.json`)).data; Object.assign(j, { status: 'final', savedAt: new Date().toISOString() });
  await Graph.putJson(`Patients/${c}/${b}.json`, j); msg('تم الحفظ النهائي.'); await openPatient(c);
};
acts.print = async ({ id }) => { const u = URL.createObjectURL(await Graph.blob(id)); window.open(u, '_blank'); };

/* لوحة المدير */
function adminView() {
  V.innerHTML = `<div class="card"><h2>قالب الروشتة (Master)</h2><input id="mf" type="file" accept=".xlsx"><button data-act="master">رفع كنسخة معتمدة</button></div>
   <div class="card"><h2>إضافة مستخدم</h2><div class="row"><div><label for="nn">الاسم</label><input id="nn"></div><div><label for="nu">اسم الدخول</label><input id="nu" dir="ltr"></div>
   <div><label for="nr">الدور</label><select id="nr"><option value="doctor">دكتور</option><option value="reception">استقبال</option><option value="admin">مدير</option></select></div>
   <div><label for="np">الرقم السري</label><input id="np" type="password" inputmode="numeric"></div></div><button data-act="adduser">إضافة</button></div>
   <div class="card"><h2>المستخدمون</h2><table>${st.db.users.map(x => `<tr><td>${esc(x.name)}</td><td dir="ltr">${esc(x.u)}</td><td>${ROLES[x.role]}</td></tr>`).join('')}</table></div>`;
}
acts.master = async () => {
  const f = $('#mf').files[0]; if (!f) throw new Error('اختار ملف القالب');
  msg('جاري الرفع…'); await Graph.upload('Master/prescription-master.xlsx', f);
  await Graph.putJson('Master/active.json', { file: f.name, at: new Date().toISOString(), by: st.user.u }); msg('تم رفع القالب.');
};
acts.adduser = async () => {
  const [name, u, role, pin] = [val('nn'), val('nu'), val('nr'), val('np')];
  if (!name || !u || pin.length < 6) throw new Error('أكمل البيانات (الرقم السري 6 أرقام على الأقل)');
  if (st.db.users.some(x => x.u === u)) throw new Error('اسم الدخول موجود');
  const r = await Graph.getJson('Users/users.json'), salt = newSalt();
  r.data.users.push({ u, name, role, salt, hash: await pinHash(pin, salt) });
  if (!(await Graph.putJson('Users/users.json', r.data, { etag: r.etag }))) throw new Error('تغيّر الملف أثناء الحفظ. حاول مرة أخرى.');
  st.db = r.data; msg('تمت الإضافة.'); adminView();
};
boot();
