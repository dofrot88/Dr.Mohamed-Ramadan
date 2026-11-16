
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error('API Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'حدث خطأ في السيرفر أو قاعدة البيانات' });
    }
  });
};

['get', 'post', 'delete'].forEach((method) => {
  const original = app[method].bind(app);
  app[method] = (route, ...handlers) =>
    original(
      route,
      ...handlers.map((handler) =>
        handler.constructor.name === 'AsyncFunction'
          ? asyncHandler(handler)
          : handler
      )
    );
});

app.use(express.json({ limit: '2mb' }));

const DB = path.join(__dirname, 'db.json');

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SECRET =
  process.env.SECRET ||
  crypto.createHash('sha256').update('s:' + ADMIN_PASSWORD).digest('hex');

const KV_URL = (
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  ''
).trim();

const KV_TOKEN = (
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  ''
).trim();

const KEY = 'drmohamed_db';

const img = '/dr2.jpg';

const seed = {
  courses: [
    {
      id: 1,
      title: 'كورس الشهر - اساسيات البرمجة',
      plan: 'month',
      price: 150,
      image: img,
      desc: 'اشتراك شهري شامل شرح اساسيات البرمجة والتفكير المنطقي خطوة بخطوة.',
      videos: []
    },
    {
      id: 2,
      title: 'كورس الشهر - تطوير الويب',
      plan: 'month',
      price: 150,
      image: img,
      desc: 'اشتراك شهري لتعلم تصميم وبناء صفحات الويب التفاعلية من الصفر.',
      videos: []
    },
    {
      id: 3,
      title: 'كورس الترم - المنهج المتكامل',
      plan: 'term',
      price: 450,
      image: img,
      desc: 'اشتراك الترم الكامل يشمل جميع المحاضرات والتطبيقات العملية والامتحانات.',
      videos: []
    },
    {
      id: 4,
      title: 'كورس الترم - برمجة وتطبيقات',
      plan: 'term',
      price: 450,
      image: img,
      desc: 'تغطية شاملة لمحتوى الترم بالكامل مع متابعة مستمرة ومراجعات نهائية.',
      videos: []
    },
    {
      id: 5,
      title: 'كورس السنة - الباقة الذهبية الشاملة',
      plan: 'year',
      price: 950,
      image: img,
      desc: 'اشتراك العام الدراسي بالكامل + المراجعات النهائية + مشاريع التخرج ومتابعة خاصة.',
      videos: []
    }
  ],
  students: [],
  enrollments: [],
  watch: [],
  grades: []
};

// =====================================
// Redis Storage
// =====================================

const hasRedis = Boolean(KV_URL && KV_TOKEN);

async function kv(command) {
  if (!hasRedis) {
    throw new Error('Upstash Redis غير متصل. راجع Environment Variables.');
  }

  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + KV_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data || data.error) {
    console.error('Redis Error:', data);
    throw new Error('فشل الاتصال بقاعدة البيانات');
  }

  return data;
}

async function save(db) {
  if (process.env.VERCEL) {
    if (!hasRedis) {
      throw new Error('Upstash غير مضبوط على Vercel. راجع Environment Variables.');
    }

    const result = await kv([
      'SET',
      KEY,
      JSON.stringify(db)
    ]);

    if (result.result !== 'OK') {
      throw new Error('قاعدة البيانات لم تؤكد حفظ البيانات');
    }

    return true;
  }

  fs.writeFileSync(DB, JSON.stringify(db, null, 2), 'utf8');
  return true;
}

async function load() {
  let db = null;

  if (process.env.VERCEL || hasRedis) {
    if (!hasRedis) {
      throw new Error('Upstash غير متصل على Vercel');
    }

    const result = await kv(['GET', KEY]);

    if (result.result) {
      try {
        db = JSON.parse(result.result);
      } catch (e) {
        console.error('Database JSON Error:', e);
        throw new Error('بيانات قاعدة البيانات غير سليمة');
      }
    }
  } else {
    if (fs.existsSync(DB)) {
      db = JSON.parse(fs.readFileSync(DB, 'utf8'));
    }
  }

  // إنشاء قاعدة أولية فقط إذا كان المفتاح غير موجود
  if (!db) {
    db = JSON.parse(JSON.stringify(seed));
    await save(db);
  }

  db.courses = Array.isArray(db.courses) ? db.courses : [];
  db.students = Array.isArray(db.students) ? db.students : [];
  db.enrollments = Array.isArray(db.enrollments) ? db.enrollments : [];
  db.watch = Array.isArray(db.watch) ? db.watch : [];
  db.grades = Array.isArray(db.grades) ? db.grades : [];

  db.courses.forEach((course) => {
    if (!Array.isArray(course.videos)) course.videos = [];
  });

  return db;
}

// =====================================
// Authentication
// =====================================

const hmac = (value) =>
  crypto.createHmac('sha256', SECRET).update(value).digest('base64url');

const sign = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + hmac(body);
};

const verify = (token) => {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;

    const [body, signature] = parts;
    const expected = hmac(body);

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString()
    );

    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
};

const bearer = (req) =>
  (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

const hash = (value) =>
  crypto.createHash('sha256').update(String(value || '')).digest('hex');

const DAY = 864e5;

const auth = (req, res, next) => {
  const payload = verify(bearer(req));

  if (!payload || !payload.sid) {
    return res.status(401).json({ error: 'سجّل دخولك الأول' });
  }

  req.studentId = payload.sid;
  next();
};

const adminAuth = (req, res, next) => {
  const payload = verify(bearer(req));

  if (payload && payload.role === 'admin') {
    return next();
  }

  return res.status(403).json({ error: 'غير مسموح - سجّل دخول المدير' });
};

// =====================================
// Static Files
// =====================================

app.use((req, res, next) => {
  if (/\.(json|js|md)$/i.test(req.path)) {
    return res.status(404).end();
  }
  next();
});

const imageNotFound = (res) => (err) => {
  if (err && !res.headersSent) res.status(404).end();
};

app.get('/dr1.jpg', (req, res) =>
  res.sendFile(path.join(__dirname, 'dr1.jpg'), imageNotFound(res))
);

app.get('/dr2.jpg', (req, res) =>
  res.sendFile(path.join(__dirname, 'dr2.jpg'), imageNotFound(res))
);

app.use(express.static(__dirname, { index: false }));

app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'index.html'))
);

app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, 'admin.html'))
);

// =====================================
// Storage Health Check
// =====================================

app.get('/api/health/storage', async (req, res) => {
  if (!hasRedis) {
    return res.status(503).json({
      connected: false,
      databaseExists: false,
      storage: 'Upstash Redis',
      error: 'Environment Variables غير مضبوطة'
    });
  }

  await kv(['PING']);

  const result = await kv(['EXISTS', KEY]);

  res.json({
    connected: true,
    databaseExists: Number(result.result) === 1,
    storage: 'Upstash Redis'
  });
});

// =====================================
// Public Courses
// =====================================

const pub = (course) => {
  const { videos = [], ...rest } = course;
  return { ...rest, videosCount: videos.length };
};

app.get('/api/courses', async (req, res) => {
  const db = await load();
  const plan = req.query.plan;

  res.json(
    db.courses
      .filter((course) => !plan || course.plan === plan)
      .map(pub)
  );
});

// =====================================
// Student Register
// =====================================

app.post('/api/register', async (req, res) => {
  const { name, email, password, phone, parentPhone } = req.body;

  if (
    !name ||
    !email ||
    !password ||
    password.length < 6 ||
    !String(parentPhone || '').trim()
  ) {
    return res.status(400).json({
      error: 'البيانات ناقصة (الباسورد 6 حروف على الأقل، ورقم ولي الأمر مطلوب)'
    });
  }

  const db = await load();
  const normalizedEmail = String(email).trim().toLowerCase();

  if (db.students.some((student) => student.email === normalizedEmail)) {
    return res.status(400).json({ error: 'الإيميل مستخدم' });
  }

  const student = {
    id: Date.now(),
    name: String(name).trim(),
    email: normalizedEmail,
    phone: phone || '',
    parentPhone: String(parentPhone).trim(),
    password: hash(password)
  };

  db.students.push(student);
  await save(db);

  res.json({
    token: sign({ sid: student.id, exp: Date.now() + 30 * DAY }),
    name: student.name
  });
});

// =====================================
// Student Login
// =====================================

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();

  const db = await load();

  const student = db.students.find(
    (item) =>
      item.email === normalizedEmail &&
      item.password === hash(password || '')
  );

  if (!student) {
    return res.status(401).json({ error: 'بيانات غلط' });
  }

  res.json({
    token: sign({ sid: student.id, exp: Date.now() + 30 * DAY }),
    name: student.name
  });
});

// =====================================
// Enroll Student
// =====================================

app.post('/api/enroll', auth, async (req, res) => {
  const db = await load();
  const courseId = Number(req.body.courseId);

  if (!db.courses.some((course) => course.id === courseId)) {
    return res.status(404).json({ error: 'الكورس مش موجود' });
  }

  if (
    db.enrollments.some(
      (item) =>
        item.studentId === req.studentId &&
        item.courseId === courseId
    )
  ) {
    return res.status(400).json({ error: 'أنت مشترك بالفعل' });
  }

  db.enrollments.push({
    studentId: req.studentId,
    courseId,
    date: new Date().toISOString()
  });

  await save(db);

  res.json({ ok: true });
});

// =====================================
// Student Courses
// =====================================

app.get('/api/my-courses', auth, async (req, res) => {
  const db = await load();

  const ids = db.enrollments
    .filter((item) => item.studentId === req.studentId)
    .map((item) => item.courseId);

  res.json(
    db.courses.filter((course) => ids.includes(course.id)).map(pub)
  );
});

// =====================================
// Course Videos
// =====================================

app.get('/api/courses/:id/videos', auth, async (req, res) => {
  const db = await load();
  const id = Number(req.params.id);

  const enrolled = db.enrollments.some(
    (item) =>
      item.studentId === req.studentId &&
      item.courseId === id
  );

  if (!enrolled) {
    return res.status(403).json({
      error: 'لازم تشترك في الكورس الأول'
    });
  }

  const course = db.courses.find((item) => item.id === id);

  res.json(course ? course.videos : []);
});

// =====================================
// Watch Video
// =====================================

app.post('/api/watch', auth, async (req, res) => {
  const db = await load();

  const courseId = Number(req.body.courseId);
  const videoId = Number(req.body.videoId);

  const course = db.courses.find((item) => item.id === courseId);

  const enrolled = db.enrollments.some(
    (item) =>
      item.studentId === req.studentId &&
      item.courseId === courseId
  );

  if (
    !course ||
    !course.videos.some((video) => video.id === videoId) ||
    !enrolled
  ) {
    return res.status(400).json({ error: 'غير مسموح' });
  }

  const alreadyWatched = db.watch.some(
    (item) =>
      item.studentId === req.studentId &&
      item.videoId === videoId
  );

  if (!alreadyWatched) {
    db.watch.push({
      studentId: req.studentId,
      courseId,
      videoId,
      date: new Date().toISOString()
    });

    await save(db);
  }

  res.json({ ok: true });
});

// =====================================
// Student Account
// =====================================

app.get('/api/me', auth, async (req, res) => {
  const db = await load();

  const student = db.students.find(
    (item) => item.id === req.studentId
  );

  if (!student) {
    return res.status(404).json({ error: 'الحساب مش موجود' });
  }

  const ids = db.enrollments
    .filter((item) => item.studentId === student.id)
    .map((item) => item.courseId);

  const seen = new Set(
    db.watch
      .filter((item) => item.studentId === student.id)
      .map((item) => item.videoId)
  );

  res.json({
    name: student.name,
    email: student.email,
    phone: student.phone,
    parentPhone: student.parentPhone || '',
    courses: db.courses
      .filter((course) => ids.includes(course.id))
      .map((course) => ({
        id: course.id,
        title: course.title,
        videos: course.videos.map((video) => ({
          id: video.id,
          title: video.title,
          watched: seen.has(video.id)
        }))
      })),
    grades: db.grades
      .filter((grade) => grade.studentId === student.id)
      .map((grade) => ({
        ...grade,
        course:
          (db.courses.find((course) => course.id === grade.courseId) || {})
            .title || ''
      }))
  });
});

// =====================================
// Admin Login
// =====================================

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;

  if (
    hash(username || '') !== hash(ADMIN_USER) ||
    hash(password || '') !== hash(ADMIN_PASSWORD)
  ) {
    return res.status(401).json({
      error: 'اسم المستخدم أو الباسورد غلط'
    });
  }

  res.json({
    token: sign({
      role: 'admin',
      exp: Date.now() + DAY
    })
  });
});

// =====================================
// Admin Courses
// =====================================

app.get('/api/admin/courses', adminAuth, async (req, res) => {
  const db = await load();
  res.json(db.courses);
});

app.post('/api/admin/courses', adminAuth, async (req, res) => {
  const { title, plan, price, desc, image } = req.body;

  if (!title || !['month', 'term', 'year'].includes(plan)) {
    return res.status(400).json({ error: 'بيانات الكورس غير صحيحة' });
  }

  const db = await load();

  const course = {
    id: Date.now(),
    title: String(title).trim(),
    plan,
    price: Number(price) || 0,
    desc: desc || '',
    image: image || img,
    videos: []
  };

  db.courses.push(course);

  // لا نرسل نجاح إلا بعد تأكيد الحفظ
  await save(db);

  res.status(201).json(course);
});

app.delete('/api/admin/courses/:id', adminAuth, async (req, res) => {
  const db = await load();
  const id = Number(req.params.id);

  db.courses = db.courses.filter((course) => course.id !== id);
  db.enrollments = db.enrollments.filter((item) => item.courseId !== id);
  db.watch = db.watch.filter((item) => item.courseId !== id);
  db.grades = db.grades.filter((item) => item.courseId !== id);

  await save(db);

  res.json({ ok: true });
});

// =====================================
// Admin Videos
// =====================================

app.post('/api/admin/courses/:id/videos', adminAuth, async (req, res) => {
  const db = await load();

  const course = db.courses.find(
    (item) => item.id === Number(req.params.id)
  );

  if (!course) {
    return res.status(404).json({ error: 'الكورس مش موجود' });
  }

  const { title, url } = req.body;

  if (!title || !/^https?:\/\//i.test(url || '')) {
    return res.status(400).json({
      error: 'اكتب اسم الفيديو ورابط صحيح يبدأ بـ https://'
    });
  }

  const video = {
    id: Date.now(),
    title: String(title).trim(),
    url: String(url).trim()
  };

  course.videos.push(video);

  await save(db);

  res.status(201).json(course);
});

app.delete(
  '/api/admin/courses/:id/videos/:vid',
  adminAuth,
  async (req, res) => {
    const db = await load();

    const course = db.courses.find(
      (item) => item.id === Number(req.params.id)
    );

    if (!course) {
      return res.status(404).json({ error: 'الكورس مش موجود' });
    }

    course.videos = course.videos.filter(
      (video) => video.id !== Number(req.params.vid)
    );

    await save(db);

    res.json(course);
  }
);

// =====================================
// Admin Grades
// =====================================

app.post('/api/admin/grades', adminAuth, async (req, res) => {
  const { studentId, courseId, type, title, score, max } = req.body;

  if (
    !['exam', 'homework'].includes(type) ||
    !title ||
    score === '' ||
    !Number.isFinite(Number(score)) ||
    !(Number(max) > 0)
  ) {
    return res.status(400).json({
      error: 'اكتب الاسم والدرجة والدرجة الكبرى صح'
    });
  }

  const db = await load();

  if (!db.students.some((student) => student.id === Number(studentId))) {
    return res.status(404).json({ error: 'الطالب مش موجود' });
  }

  const grade = {
    id: Date.now(),
    studentId: Number(studentId),
    courseId: Number(courseId) || 0,
    type,
    title,
    score: Number(score),
    max: Number(max),
    date: new Date().toISOString()
  };

  db.grades.push(grade);

  await save(db);

  res.status(201).json(grade);
});

app.delete('/api/admin/grades/:id', adminAuth, async (req, res) => {
  const db = await load();

  db.grades = db.grades.filter(
    (grade) => grade.id !== Number(req.params.id)
  );

  await save(db);

  res.json({ ok: true });
});

// =====================================
// Admin Parent Phone
// =====================================

app.post('/api/admin/students/:id/parent', adminAuth, async (req, res) => {
  const db = await load();

  const student = db.students.find(
    (item) => item.id === Number(req.params.id)
  );

  if (!student || !String(req.body.parentPhone || '').trim()) {
    return res.status(400).json({ error: 'بيانات غلط' });
  }

  student.parentPhone = String(req.body.parentPhone).trim();

  await save(db);

  res.json({ ok: true });
});

// =====================================
// Admin Students
// =====================================

app.get('/api/admin/students', adminAuth, async (req, res) => {
  const db = await load();

  res.json(
    db.students.map((student) => ({
      id: student.id,
      name: student.name,
      email: student.email,
      phone: student.phone,
      joined: new Date(student.id).toISOString(),
      parentPhone: student.parentPhone || '',
      watched: db.watch.filter(
        (item) => item.studentId === student.id
      ).length,
      grades: db.grades.filter(
        (grade) => grade.studentId === student.id
      ),
      courseList: db.enrollments
        .filter((item) => item.studentId === student.id)
        .map((item) =>
          db.courses.find((course) => course.id === item.courseId)
        )
        .filter(Boolean)
        .map((course) => ({
          id: course.id,
          title: course.title
        })),
      courses: db.enrollments
        .filter((item) => item.studentId === student.id)
        .map((item) =>
          (db.courses.find((course) => course.id === item.courseId) || {})
            .title
        )
        .filter(Boolean)
    }))
  );
});

// =====================================
// Server
// =====================================

if (!process.env.VERCEL) {
  app.listen(process.env.PORT || 3000, () => {
    console.log('Server running on port ' + (process.env.PORT || 3000));
  });
}

module.exports = app;
