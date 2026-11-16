
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

