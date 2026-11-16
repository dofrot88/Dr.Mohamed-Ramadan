const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const DB = process.env.VERCEL 
  ? path.join('/tmp', 'db.json') 
  : path.join(__dirname, 'db.json');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json());
// قراءة الملفات الثابتة والصور من مجلد public مباشرة
app.use(express.static(path.join(__dirname, 'public')));

const seed = {
  courses: [
    { id: 1, title: 'كورس الشهر - اساسيات البرمجة', plan: 'month', price: 150, image: 'dr2.jpg', desc: 'اشتراك شهري شامل شرح اساسيات البرمجة والتفكير المنطقي خطوة بخطوة.' },
    { id: 2, title: 'كورس الشهر - تطوير الويب', plan: 'month', price: 150, image: 'dr2.jpg', desc: 'اشتراك شهري لتعلم تصميم وبناء صفحات الويب التفاعلية من الصفر.' },
    { id: 3, title: 'كورس الترم - المنهج المتكامل', plan: 'term', price: 450, image: 'dr2.jpg', desc: 'اشتراك الترم الكامل يشمل جميع المحاضرات والتطبيقات العملية والامتحانات.' },
    { id: 4, title: 'كورس الترم - برمجة وتطبيقات', plan: 'term', price: 450, image: 'dr2.jpg', desc: 'تغطية شاملة لمحتوى الترم بالكامل مع متابعة مستمرة ومراجعات نهائية.' },
    { id: 5, title: 'كورس السنة - الباقة الذهبية الشاملة', plan: 'year', price: 950, image: 'dr2.jpg', desc: 'اشتراك العام الدراسي بالكامل + المراجعات النهائية + مشاريع التخرج ومتابعة خاصة.' }
  ],
  students: [], enrollments: []
};

const load = () => { if (!fs.existsSync(DB)) save(seed); return JSON.parse(fs.readFileSync(DB, 'utf8')); };
const save = d => fs.writeFileSync(DB, JSON.stringify(d, null, 2));
const tokens = new Map();

const auth = (req, res, next) => {
  const id = tokens.get((req.headers.authorization || '').replace('Bearer ', ''));
  if (!id) return res.status(401).json({ error: 'سجّل دخولك الأول' });
  req.studentId = id; next();
};
const hash = p => crypto.createHash('sha256').update(p).digest('hex');

app.get('/api/courses', (req, res) => {
  const { plan } = req.query;
  res.json(load().courses.filter(c => !plan || c.plan === plan));
});

app.post('/api/register', (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ error: 'البيانات ناقصة (الباسورد 6 حروف على الأقل)' });
  const db = load();
  if (db.students.find(s => s.email === email)) return res.status(400).json({ error: 'الإيميل مستخدم' });
  const s = { id: Date.now(), name, email, phone: phone || '', password: hash(password) };
  db.students.push(s); save(db);
  const t = crypto.randomUUID(); tokens.set(t, s.id);
  res.json({ token: t, name });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const s = load().students.find(x => x.email === email && x.password === hash(password || ''));
  if (!s) return res.status(401).json({ error: 'بيانات غلط' });
  const t = crypto.randomUUID(); tokens.set(t, s.id);
  res.json({ token: t, name: s.name });
});

app.post('/api/enroll', auth, (req, res) => {
  const db = load(); const courseId = +req.body.courseId;
  if (!db.courses.find(c => c.id === courseId)) return res.status(404).json({ error: 'الكورس مش موجود' });
  if (db.enrollments.find(e => e.studentId === req.studentId && e.courseId === courseId))
    return res.status(400).json({ error: 'أنت مشترك بالفعل' });
  db.enrollments.push({ studentId: req.studentId, courseId, date: new Date().toISOString() });
  save(db); res.json({ ok: true });
});

app.get('/api/my-courses', auth, (res, req) => {
  const db = load();
  const ids = db.enrollments.filter(e => e.studentId === req.studentId).map(e => e.courseId);
  res.json(db.courses.filter(c => ids.includes(c.id)));
});

app.post('/api/admin/courses', (req, res) => {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) return res.status(403).json({ error: 'باسورد الأدمن غلط' });
  const { title, plan, price, desc, image } = req.body;
  if (!title || !['month', 'term', 'year'].includes(plan)) return res.status(400).json({ error: 'بيانات غلط' });
  const db = load();
  const c = { id: Date.now(), title, plan, price: +price || 0, desc: desc || '', image: image || 'dr2.jpg' };
  db.courses.push(c); save(db); res.json(c);
});

if (!process.env.VERCEL) {
  app.listen(process.env.PORT || 3000, () => console.log('http://localhost:3000'));
}

module.exports = app;
