
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(__dirname, { index: false }));

const DB = process.env.VERCEL
  ? '/tmp/db.json'
  : path.join(__dirname, 'db.json');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const sessions = new Map();

function readDB() {
  try {
    if (!fs.existsSync(DB)) {
      const initial = {
        users: [],
        courses: [
          {
            id: 'course1',
            title: 'الكورس الأول',
            description: 'كورس تعليمي شامل',
            price: 500,
            image: '/dr2.jpg'
          },
          {
            id: 'course2',
            title: 'الكورس الثاني',
            description: 'شرح وتدريبات ومراجعة',
            price: 400,
            image: '/dr1.jpg'
          }
        ],
        enrollments: []
      };
      fs.writeFileSync(DB, JSON.stringify(initial, null, 2));
    }

    const data = JSON.parse(fs.readFileSync(DB, 'utf8'));
    data.users ||= [];
    data.courses ||= [];
    data.enrollments ||= [];
    return data;
  } catch (error) {
    console.error(error);
    return { users: [], courses: [], enrollments: [] };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2));
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

function userIdentifier(user) {
  return normalizeIdentifier(user.identifier || user.email || user.phone);
}

function getUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return sessions.get(token);
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/courses', (req, res) => {
  res.json(readDB().courses);
});

app.post('/api/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const identifier = normalizeIdentifier(req.body.identifier || req.body.email || req.body.phone);
  const password = String(req.body.password || '');

  if (!name || !identifier || !password) {
    return res.status(400).json({ error: 'أدخل الاسم ورقم الهاتف أو البريد وكلمة المرور.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.' });
  }

  const db = readDB();

  if (db.users.some(user => userIdentifier(user) === identifier)) {
    return res.status(409).json({ error: 'هذا الرقم أو البريد مسجل بالفعل.' });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    identifier,
    password
  };

  db.users.push(user);
  saveDB(db);

  res.json({ message: 'تم إنشاء الحساب بنجاح.' });
});

app.post('/api/login', (req, res) => {
  const identifier = normalizeIdentifier(req.body.identifier || req.body.email || req.body.phone);
  const password = String(req.body.password || '');

  const db = readDB();
  const user = db.users.find(item =>
    userIdentifier(item) === identifier && item.password === password
  );

  if (!user) {
    return res.status(401).json({ error: 'رقم الهاتف أو البريد أو كلمة المرور غير صحيحة.' });
  }

  const token = crypto.randomUUID();
  sessions.set(token, {
    id: user.id,
    name: user.name,
    identifier: userIdentifier(user)
  });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      identifier: userIdentifier(user)
    }
  });
});

app.post('/api/enroll', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'سجل الدخول أولًا.' });

  const courseId = String(req.body.courseId || '');
  const db = readDB();

  const course = db.courses.find(item => item.id === courseId);
  if (!course) return res.status(404).json({ error: 'الكورس غير موجود.' });

  const already = db.enrollments.some(item =>
    item.userId === user.id && item.courseId === courseId
  );

  if (already) {
    return res.json({ message: 'أنت مسجل بالفعل في هذا الكورس.' });
  }

  db.enrollments.push({
    id: crypto.randomUUID(),
    userId: user.id,
    courseId
  });

  saveDB(db);
  res.json({ message: 'تم تسجيل طلب الاشتراك بنجاح.' });
});

app.get('/api/my-courses', (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'سجل الدخول أولًا.' });

  const db = readDB();
  const ids = db.enrollments
    .filter(item => item.userId === user.id)
    .map(item => item.courseId);

  res.json(db.courses.filter(course => ids.includes(course.id)));
});

app.post('/api/admin/courses', (req, res) => {
  const password = String(req.body.password || '');

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'كلمة مرور الإدارة غير صحيحة.' });
  }

  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const price = Number(req.body.price || 0);
  const requestedImage = String(req.body.image || 'dr2.jpg').trim();

  if (!title) {
    return res.status(400).json({ error: 'اكتب اسم الكورس.' });
  }

  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'اكتب سعرًا صحيحًا.' });
  }

  const image = ['dr1.jpg', 'dr2.jpg'].includes(requestedImage)
    ? '/' + requestedImage
    : '/dr2.jpg';

  const db = readDB();

  const course = {
    id: crypto.randomUUID(),
    title,
    description,
    price,
    image
  };

  db.courses.push(course);
  saveDB(db);

  res.json({ message: 'تمت إضافة الكورس بنجاح.', course });
});

module.exports = app;

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
  });
}

