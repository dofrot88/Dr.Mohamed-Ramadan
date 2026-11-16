
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
  let db;
  try {
    if (fs.existsSync(DB)) {
      db = JSON.parse(fs.readFileSync(DB, 'utf8'));
    }
  } catch (error) {
    console.error('Database read error:', error);
  }

  if (!db) {
    db = {
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
    saveDB(db);
  }

  db.users ||= [];
  db.courses ||= [];
  db.enrollments ||= [];
  return db;
}

function saveDB(db) {
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

function getUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return sessions.get(token);
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/image-check', (req, res) => {
  res.json({
    dr1: fs.existsSync(path.join(__dirname, 'dr1.jpg')),
    dr2: fs.existsSync(path.join(__dirname, 'dr2.jpg'))
  });
});

app.get('/api/courses', (req, res) => {
  res.json(readDB().courses);
});

// التسجيل: رقم هاتف أو بريد إلكتروني، يكفي واحد منهما
app.post('/api/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const identifier = normalizeIdentifier(req.body.identifier);
  const password = String(req.body.password || '');

  if (!name || !identifier || !password) {
    return res.status(400).json({
      error: 'أدخل الاسم ورقم الهاتف أو البريد الإلكتروني وكلمة المرور'
    });
  }

  const isEmail = identifier.includes('@');
  const db = readDB();

  const exists = db.users.some(user =>
    normalizeIdentifier(user.email) === identifier ||
    normalizeIdentifier(user.phone) === identifier
  );

  if (exists) {
    return res.status(409).json({
      error: 'هذا الرقم أو البريد الإلكتروني مسجل بالفعل'
    });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email: isEmail ? identifier : '',
    phone: isEmail ? '' : identifier,
    password
  };

  db.users.push(user);
  saveDB(db);

  res.json({ message: 'تم إنشاء الحساب بنجاح' });
});

// تسجيل الدخول بالرقم أو البريد الإلكتروني
app.post('/api/login', (req, res) => {
  const identifier = normalizeIdentifier(req.body.identifier);
  const password = String(req.body.password || '');
  const db = readDB();

  const user = db.users.find(item =>
    (
      normalizeIdentifier(item.email) === identifier ||
      normalizeIdentifier(item.phone) === identifier
    ) && item.password === password
  );

  if (!user) {
    return res.status(401).json({
      error: 'رقم الهاتف أو البريد الإلكتروني أو كلمة المرور غير صحيحة'
    });
  }

  const token = crypto.randomUUID();
  sessions.set(token, {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone
  });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone
    }
  });
});

// الاشتراك في كورس
app.post('/api/enroll', (req, res) => {
  const user = getUser(req);

  if (!user) {
    return res.status(401).json({ error: 'سجل الدخول أولًا' });
  }

  const courseId = String(req.body.courseId || '');
  const db = readDB();
  const course = db.courses.find(item => item.id === courseId);

  if (!course) {
    return res.status(404).json({ error: 'الكورس غير موجود' });
  }

  const exists = db.enrollments.some(item =>
    item.userId === user.id && item.courseId === courseId
  );

  if (exists) {
    return res.json({ message: 'أنت مشترك بالفعل في هذا الكورس' });
  }

  db.enrollments.push({
    id: crypto.randomUUID(),
    userId: user.id,
    courseId
  });

  saveDB(db);
  res.json({ message: 'تم تسجيل طلب الاشتراك بنجاح' });
});

// كورسات الطالب
app.get('/api/my-courses', (req, res) => {
  const user = getUser(req);

  if (!user) {
    return res.status(401).json({ error: 'سجل الدخول أولًا' });
  }

  const db = readDB();
  const ids = db.enrollments
    .filter(item => item.userId === user.id)
    .map(item => item.courseId);

  res.json(db.courses.filter(course => ids.includes(course.id)));
});

// إضافة كورس من لوحة الإدارة
app.post('/api/admin/courses', (req, res) => {
  const password = String(req.body.password || '');

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      error: 'كلمة مرور الإدارة غير صحيحة'
    });
  }

  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const price = Number(req.body.price) || 0;
  const requestedImage = String(req.body.image || '');

  if (!title) {
    return res.status(400).json({ error: 'اكتب اسم الكورس' });
  }

  // نسمح باستخدام الصورتين الموجودتين في المشروع
  const image = requestedImage === 'dr1.jpg'
    ? '/dr1.jpg'
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

  res.json({
    message: 'تمت إضافة الكورس بنجاح',
    course
  });
});

module.exports = app;

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
