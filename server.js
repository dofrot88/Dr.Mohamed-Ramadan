
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
app.use(express.static(__dirname, { index: false }));

let sessions = new Map();

function readDB() {
  try {
    if (!fs.existsSync(DB)) {
      const initialData = {
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
      fs.writeFileSync(DB, JSON.stringify(initialData, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB, 'utf8'));
  } catch (error) {
    console.error('Database error:', error);
    return { users: [], courses: [], enrollments: [] };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2));
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
  const db = readDB();
  res.json(db.courses);
});

app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'يرجى إدخال جميع البيانات' });
  }

  const db = readDB();

  if (db.users.some(user => user.email === email)) {
    return res.status(409).json({ error: 'البريد الإلكتروني مسجل بالفعل' });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    password
  };

  db.users.push(user);
  saveDB(db);

  res.json({ message: 'تم إنشاء الحساب بنجاح' });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const db = readDB();

  const user = db.users.find(
    item => item.email === email && item.password === password
  );

  if (!user) {
    return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
  }

  const token = crypto.randomUUID();
  sessions.set(token, { id: user.id, name: user.name, email: user.email });

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email }
  });
});

app.post('/api/enroll', (req, res) => {
  const user = getUser(req);

  if (!user) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول أولًا' });
  }

  const { courseId } = req.body;
  const db = readDB();

  const course = db.courses.find(item => item.id === courseId);

  if (!course) {
    return res.status(404).json({ error: 'الكورس غير موجود' });
  }

  const exists = db.enrollments.some(
    item => item.userId === user.id && item.courseId === courseId
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

app.get('/api/my-courses', (req, res) => {
  const user = getUser(req);

  if (!user) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول أولًا' });
  }

  const db = readDB();

  const ids = db.enrollments
    .filter(item => item.userId === user.id)
    .map(item => item.courseId);

  res.json(db.courses.filter(course => ids.includes(course.id)));
});

app.post('/api/admin/courses', (req, res) => {
  const { password, title, description, price, image } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'كلمة مرور الإدارة غير صحيحة' });
  }

  if (!title) {
    return res.status(400).json({ error: 'اكتب اسم الكورس' });
  }

  const db = readDB();

  const course = {
    id: crypto.randomUUID(),
    title,
    description: description || '',
    price: Number(price) || 0,
    image: image === 'dr1.jpg' ? '/dr1.jpg' : '/dr2.jpg'
  };

  db.courses.push(course);
  saveDB(db);

  res.json({ message: 'تمت إضافة الكورس بنجاح', course });
});

module.exports = app;

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

app.post('/api/register', (req, res) => {
  const { name, email, phone, password } = req.body;

  if (!name || !password || (!email && !phone)) {
    return res.status(400).json({
      error: 'أدخل الاسم وكلمة المرور ورقم الهاتف أو البريد الإلكتروني'
    });
  }

  const db = readDB();

  const exists = db.users.some(user =>
    (email && user.email === email) ||
    (phone && user.phone === phone)
  );

  if (exists) {
    return res.status(409).json({
      error: 'رقم الهاتف أو البريد الإلكتروني مسجل بالفعل'
    });
  }

  db.users.push({
    id: crypto.randomUUID(),
    name,
    email: email || '',
    phone: phone || '',
    password
  });

  saveDB(db);
  res.json({ message: 'تم إنشاء الحساب بنجاح' });
});

app.post('/api/login', (req, res) => {
  const { identity, email, phone, password } = req.body;
  const loginValue = identity || email || phone;
  const db = readDB();

  const user = db.users.find(item =>
    (item.email === loginValue || item.phone === loginValue) &&
    item.password === password
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

