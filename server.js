// باك اند بسيط: Express + ملف JSON كقاعدة بيانات
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
// استخدام مجلد /tmp على Vercel لأن المجلد الرئيسي للقراءة فقط
const DB = process.env.VERCEL 
  ? path.join('/tmp', 'db.json') 
  : path.join(__dirname, 'db.json');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // غيّرها!

app.use(express.json());
app.use(express.static(__dirname));

const seed = {
  courses: [
    // ===== كورسات شهرية =====
    { id: 1, title: 'أساسيات البرمجة - شهري', plan: 'month', price: 150, desc: 'مقدمة في التفكير البرمجي والخوارزميات ولغة Python.' },
    { id: 2, title: 'HTML و CSS من الصفر - شهري', plan: 'month', price: 150, desc: 'ابني أول صفحات ويب متجاوبة.' },
    { id: 3, title: 'JavaScript للمبتدئين - شهري', plan: 'month', price: 180, desc: 'اتعلم الجافاسكريبت وتفاعل الصفحات.' },
    // ===== كورسات الترم =====
    { id: 4, title: 'فرونت إند: HTML / CSS / JS - ترم', plan: 'term', price: 600, desc: 'ابني مواقعك من الصفر لحد مشروع كامل.' },
    { id: 5, title: 'باك إند: Node.js وقواعد البيانات - ترم', plan: 'term', price: 650, desc: 'السيرفر وال API وقواعد البيانات.' },
    { id: 6, title: 'برمجة Python وحل المشكلات - ترم', plan: 'term', price: 550, desc: 'من الأساسيات لحد الدوال والكائنات ومشاريع صغيرة.' },
    // ===== كورسات السنة =====
    { id: 7, title: 'منهج البرمجة الكامل - سنة', plan: 'year', price: 1500, desc: 'فرونت إند + باك إند + مشروع تخرج.' },
    { id: 8, title: 'مطوّر ويب شامل (Full Stack) - سنة', plan: 'year', price: 1800, desc: 'من HTML لحد موقع كامل بقاعدة بيانات ومتابعة مستمرة.' }
  ],
  students: [], enrollments: []
};

const load = () => { if (!fs.existsSync(DB)) save(seed); return JSON.parse(fs.readFileSync(DB, 'utf8')); };
const save = d => fs.writeFileSync(DB, JSON.stringify(d, null, 2));
const tokens = new Map(); // token -> studentId

const auth = (req, res, next) => {
  const id = tokens.get((req.headers.authorization || '').replace('Bearer ', ''));
  if (!id) return res.status(401).json({ error: 'سجّل دخولك الأول' });
  req.studentId = id; next();
};
const hash = p => crypto.createHash('sha256').update(p).digest('hex');

// عرض الصفحة الرئيسية من المسار الرئيسي
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// الكورسات (ممكن فل
