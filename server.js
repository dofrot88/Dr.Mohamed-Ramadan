const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
// أي خطأ في route بيرجع 500 بدل ما السيرفر يقع
['get', 'post', 'delete'].forEach(m => {
  const o = app[m].bind(app);
  app[m] = (p, ...h) => o(p, ...h.map(f => typeof f === 'function' && f.constructor.name === 'AsyncFunction'
    ? (q, r, n) => f(q, r, n).catch(e => { console.error(e); if (!r.headersSent) r.status(500).json({ error: 'خطأ في السيرفر' }); })
    : f));
});
const DB = process.env.VERCEL ? path.join('/tmp', 'db.json') : path.join(__dirname, 'db.json');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // غيّرهم من Environment Variables
const SECRET = process.env.SECRET || crypto.createHash('sha256').update('s:' + ADMIN_PASSWORD).digest('hex');

app.use(express.json());
// حماية: ممنوع تحميل db.json أو أي ملف كود من الرابط
app.use((req, res, next) => /\.(json|js|md)$/i.test(req.path) ? res.status(404).end() : next());
// الصور: مسارات صريحة عشان Vercel يضمّها مع المشروع
const nf = res => e => { if (e && !res.headersSent) res.status(404).end(); };
app.get('/dr1.jpg', (req, res) => res.sendFile(path.join(__dirname, 'dr1.jpg'), nf(res)));
app.get('/dr2.jpg', (req, res) => res.sendFile(path.join(__dirname, 'dr2.jpg'), nf(res)));
app.use(express.static(__dirname, { index: false }));

const img = '/dr2.jpg';
const seed = {
  courses: [
    { id: 1, title: 'كورس الشهر - اساسيات البرمجة', plan: 'month', price: 150, image: img, desc: 'اشتراك شهري شامل شرح اساسيات البرمجة والتفكير المنطقي خطوة بخطوة.', videos: [] },
    { id: 2, title: 'كورس الشهر - تطوير الويب', plan: 'month', price: 150, image: img, desc: 'اشتراك شهري لتعلم تصميم وبناء صفحات الويب التفاعلية من الصفر.', videos: [] },
    { id: 3, title: 'كورس الترم - المنهج المتكامل', plan: 'term', price: 450, image: img, desc: 'اشتراك الترم الكامل يشمل جميع المحاضرات والتطبيقات العملية والامتحانات.', videos: [] },
    { id: 4, title: 'كورس الترم - برمجة وتطبيقات', plan: 'term', price: 450, image: img, desc: 'تغطية شاملة لمحتوى الترم بالكامل مع متابعة مستمرة ومراجعات نهائية.', videos: [] },
    { id: 5, title: 'كورس السنة - الباقة الذهبية الشاملة', plan: 'year', price: 950, image: img, desc: 'اشتراك العام الدراسي بالكامل + المراجعات النهائية + مشاريع التخرج ومتابعة خاصة.', videos: [] }
  ],
  students: [], enrollments: []
};

// التخزين: Redis (Upstash) لو متوصّل، وإلا ملف db.json (للتجربة المحلية بس)
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'drmohamed_db';
const kv = cmd => fetch(KV_URL, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify(cmd)
}).then(r => r.json());

const save = async d => {
  if (KV_URL && KV_TOKEN) await kv(['SET', KEY, JSON.stringify(d)]);
  else fs.writeFileSync(DB, JSON.stringify(d, null, 2));
};
const load = async () => {
  let d = null;
  if (KV_URL && KV_TOKEN) { const r = await kv(['GET', KEY]); if (r.result) d = JSON.parse(r.result); }
  else if (fs.existsSync(DB)) d = JSON.parse(fs.readFileSync(DB, 'utf8'));
  if (!d) { d = JSON.parse(JSON.stringify(seed)); await save(d); }
  if (!d.courses || !d.courses.length) { d.courses = seed.courses; await save(d); }
  d.courses.forEach(c => { if (!c.videos) c.videos = []; });
  return d;
};

// توكنات موقّعة (بتشتغل حتى على Vercel لأنها مش محفوظة في الذاكرة)
const hmac = b => crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
const sign = p => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + hmac(b); };
const verify = t => {
  try {
    const [b, s] = String(t).split('.');
    if (!b || s !== hmac(b)) return null;
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
};
const bearer = req => (req.headers.authorization || '').replace('Bearer ', '');
const hash = p => crypto.createHash('sha256').update(p).digest('hex');
const DAY = 864e5;

const auth = (req, res, next) => {
  const p = verify(bearer(req));
  if (!p || !p.sid) return res.status(401).json({ error: 'سجّل دخولك الأول' });
  req.studentId = p.sid; next();
};
const adminAuth = (req, res, next) => {
  const p = verify(bearer(req));
  if ((p && p.role === 'admin') || req.headers['x-admin-password'] === ADMIN_PASSWORD) return next();
  res.status(403).json({ error: 'غير مسموح - سجّل دخول المدير' });
};

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ---------- عام ----------
const pub = c => { const { videos = [], ...r } = c; return { ...r, videosCount: videos.length }; };
app.get('/api/courses', async (req, res) => {
  const { plan } = req.query;
  res.json((await load()).courses.filter(c => !plan || c.plan === plan).map(pub));
});

// ---------- الطلاب ----------
app.post('/api/register', async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ error: 'البيانات ناقصة (الباسورد 6 حروف على الأقل)' });
  const db = (await load());
  if (db.students.find(s => s.email === email)) return res.status(400).json({ error: 'الإيميل مستخدم' });
  const s = { id: Date.now(), name, email, phone: phone || '', password: hash(password) };
  db.students.push(s); await save(db);
  res.json({ token: sign({ sid: s.id, exp: Date.now() + 30 * DAY }), name });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const s = (await load()).students.find(x => x.email === email && x.password === hash(password || ''));
  if (!s) return res.status(401).json({ error: 'بيانات غلط' });
  res.json({ token: sign({ sid: s.id, exp: Date.now() + 30 * DAY }), name: s.name });
});

app.post('/api/enroll', auth, async (req, res) => {
  const db = (await load()); const courseId = +req.body.courseId;
  if (!db.courses.find(c => c.id === courseId)) return res.status(404).json({ error: 'الكورس مش موجود' });
  if (db.enrollments.find(e => e.studentId === req.studentId && e.courseId === courseId))
    return res.status(400).json({ error: 'أنت مشترك بالفعل' });
  db.enrollments.push({ studentId: req.studentId, courseId, date: new Date().toISOString() });
  await save(db); res.json({ ok: true });
});

app.get('/api/my-courses', auth, async (req, res) => {
  const db = (await load());
  const ids = db.enrollments.filter(e => e.studentId === req.studentId).map(e => e.courseId);
  res.json(db.courses.filter(c => ids.includes(c.id)).map(pub));
});

// فيديوهات الكورس: للمشتركين فقط
app.get('/api/courses/:id/videos', auth, async (req, res) => {
  const db = (await load()); const id = +req.params.id;
  if (!db.enrollments.find(e => e.studentId === req.studentId && e.courseId === id))
    return res.status(403).json({ error: 'لازم تشترك في الكورس الأول' });
  const c = db.courses.find(x => x.id === id);
  res.json(c ? c.videos : []);
});

// ---------- المدير ----------
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (hash(username || '') !== hash(ADMIN_USER) || hash(password || '') !== hash(ADMIN_PASSWORD))
    return res.status(401).json({ error: 'اسم المستخدم أو الباسورد غلط' });
  res.json({ token: sign({ role: 'admin', exp: Date.now() + DAY }) });
});

app.get('/api/admin/courses', adminAuth, async (req, res) => res.json((await load()).courses));

app.post('/api/admin/courses', adminAuth, async (req, res) => {
  const { title, plan, price, desc, image } = req.body;
  if (!title || !['month', 'term', 'year'].includes(plan)) return res.status(400).json({ error: 'بيانات غلط' });
  const db = (await load());
  const c = { id: Date.now(), title, plan, price: +price || 0, desc: desc || '', image: image || img, videos: [] };
  db.courses.push(c); await save(db); res.json(c);
});

app.delete('/api/admin/courses/:id', adminAuth, async (req, res) => {
  const db = (await load()); const id = +req.params.id;
  db.courses = db.courses.filter(c => c.id !== id);
  db.enrollments = db.enrollments.filter(e => e.courseId !== id);
  await save(db); res.json({ ok: true });
});

app.post('/api/admin/courses/:id/videos', adminAuth, async (req, res) => {
  const db = (await load()); const c = db.courses.find(x => x.id === +req.params.id);
  if (!c) return res.status(404).json({ error: 'الكورس مش موجود' });
  const { title, url } = req.body;
  if (!title || !/^https?:\/\//i.test(url || '')) return res.status(400).json({ error: 'اكتب اسم الفيديو ورابط صحيح يبدأ بـ https://' });
  c.videos.push({ id: Date.now(), title, url }); await save(db); res.json(c);
});

app.delete('/api/admin/courses/:id/videos/:vid', adminAuth, async (req, res) => {
  const db = (await load()); const c = db.courses.find(x => x.id === +req.params.id);
  if (!c) return res.status(404).json({ error: 'الكورس مش موجود' });
  c.videos = c.videos.filter(v => v.id !== +req.params.vid);
  await save(db); res.json(c);
});

app.get('/api/admin/students', adminAuth, async (req, res) => {
  const db = (await load());
  res.json(db.students.map(s => ({
    id: s.id, name: s.name, email: s.email, phone: s.phone,
    joined: new Date(s.id).toISOString(),
    courses: db.enrollments.filter(e => e.studentId === s.id)
      .map(e => (db.courses.find(c => c.id === e.courseId) || {}).title).filter(Boolean)
  })));
});

if (!process.env.VERCEL) app.listen(process.env.PORT || 3000, () => console.log('http://localhost:3000  |  admin: /admin'));
module.exports = app;
