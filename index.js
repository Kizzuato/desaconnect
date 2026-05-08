require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const app = express();
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 5432,
});

// Session middleware
app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'desaconnect-super-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 days
}));

// S3 Client
const s3Client = new S3Client({ region: process.env.AWS_REGION });

// Multer memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Global template helpers
const formatDate = (date) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
app.locals.formatDate = formatDate;

// Make user available to all templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Auth middleware
const requireLogin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  if (req.session.user.role !== 'admin') return res.status(403).send('Akses Ditolak: Anda tidak memiliki izin sebagai Administrator.');
  next();
};

// ───────────────────────────────────────────
// DATABASE INIT
// ───────────────────────────────────────────
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        nama VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Migration: Add role column
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='users' AND column_name='role'
        ) THEN
          ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'warga';
        END IF;
      END $$;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        nama_pelapor VARCHAR(255) NOT NULL,
        judul VARCHAR(255) NOT NULL,
        deskripsi TEXT NOT NULL,
        foto_url VARCHAR(512),
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Add user_id column if it doesn't exist (migration for existing installs)
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='reports' AND column_name='user_id'
        ) THEN
          ALTER TABLE reports ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    console.log('Database initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize database:', error.message);
  }
};
initDB();

// ───────────────────────────────────────────
// HOME
// ───────────────────────────────────────────
app.get('/', requireLogin, async (req, res) => {
  try {
    const userRole = req.session.user.role;
    const userId = req.session.user.id;
    let statusQuery, recentReports;
    
    if (userRole === 'admin') {
      statusQuery = await pool.query('SELECT status, COUNT(*) as count FROM reports GROUP BY status');
      recentReports = await pool.query('SELECT * FROM reports ORDER BY created_at DESC LIMIT 5');
    } else {
      statusQuery = await pool.query('SELECT status, COUNT(*) as count FROM reports WHERE user_id = $1 GROUP BY status', [userId]);
      recentReports = await pool.query('SELECT * FROM reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5', [userId]);
    }

    let stats = { Pending: 0, Proses: 0, Selesai: 0 };
    statusQuery.rows.forEach(row => { stats[row.status] = parseInt(row.count); });

    res.render('home', { page: 'home', stats, reports: recentReports.rows });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error: ' + error.message);
  }
});

// ───────────────────────────────────────────
// REGISTER
// ───────────────────────────────────────────
app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { page: 'register', error: null });
});

app.post('/register', async (req, res) => {
  const { nama, email, password, confirm_password } = req.body;
  if (password !== confirm_password) {
    return res.render('register', { page: 'register', error: 'Password tidak cocok.' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.render('register', { page: 'register', error: 'Email sudah terdaftar.' });
    }
    const hashed = await bcrypt.hash(password, 12);
    // Auto-assign admin if email starts with admin
    const role = email.toLowerCase().startsWith('admin') ? 'admin' : 'warga';
    
    const result = await pool.query(
      'INSERT INTO users (nama, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, nama, email, role',
      [nama, email, hashed, role]
    );
    req.session.user = result.rows[0];
    res.redirect('/?registered=true');
  } catch (error) {
    console.error(error);
    res.render('register', { page: 'register', error: 'Terjadi kesalahan. Silakan coba lagi.' });
  }
});

// ───────────────────────────────────────────
// LOGIN
// ───────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { page: 'login', error: null, redirect: req.query.redirect || '/' });
});

app.post('/login', async (req, res) => {
  const { email, password, redirect } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.render('login', { page: 'login', error: 'Email atau password salah.', redirect: redirect || '/' });
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.render('login', { page: 'login', error: 'Email atau password salah.', redirect: redirect || '/' });
    }
    // Check missing role in old accounts
    const userRole = user.role || 'warga';
    req.session.user = { id: user.id, nama: user.nama, email: user.email, role: userRole };
    res.redirect(redirect || '/');
  } catch (error) {
    console.error(error);
    res.render('login', { page: 'login', error: 'Terjadi kesalahan.', redirect: redirect || '/' });
  }
});

// ───────────────────────────────────────────
// LOGOUT
// ───────────────────────────────────────────
app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ───────────────────────────────────────────
// LAPOR
// ───────────────────────────────────────────
const requireWarga = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  if (req.session.user.role === 'admin') return res.status(403).send('Akses Ditolak: Administrator tidak dapat membuat pengaduan.');
  next();
};

app.get('/lapor', requireWarga, (req, res) => {
  res.render('lapor', { page: 'lapor' });
});

app.post('/lapor', requireWarga, upload.single('foto'), async (req, res) => {
  const { judul, deskripsi } = req.body;
  const nama_pelapor = req.session.user.nama;
  const user_id = req.session.user.id;
  let foto_url = null;

  try {
    if (req.file) {
      const fileExtension = path.extname(req.file.originalname);
      const fileName = `${uuidv4()}${fileExtension}`;
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: `reports/${fileName}`,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }));
      const cloudfrontUrl = (process.env.CLOUDFRONT_URL || '').replace(/\/$/, '');
      foto_url = cloudfrontUrl
        ? `${cloudfrontUrl}/reports/${fileName}`
        : `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/reports/${fileName}`;
    }

    await pool.query(
      'INSERT INTO reports (user_id, nama_pelapor, judul, deskripsi, foto_url) VALUES ($1, $2, $3, $4, $5)',
      [user_id, nama_pelapor, judul, deskripsi, foto_url]
    );
    res.redirect('/pengaduan-saya?success=true');
  } catch (error) {
    console.error('Error creating report:', error);
    res.status(500).send('Gagal mengirim laporan: ' + error.message);
  }
});

// ───────────────────────────────────────────
// PENGADUAN SAYA (tracking)
// ───────────────────────────────────────────
app.get('/pengaduan-saya', requireWarga, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM reports WHERE user_id = $1 ORDER BY created_at DESC',
      [req.session.user.id]
    );
    res.render('pengaduan_saya', {
      page: 'pengaduan-saya',
      reports: result.rows,
      success: req.query.success === 'true',
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error: ' + error.message);
  }
});

// Detail laporan
app.get('/pengaduan-saya/:id', requireWarga, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM reports WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.user.id]
    );
    if (result.rows.length === 0) return res.redirect('/pengaduan-saya');
    res.render('detail_laporan', { page: 'pengaduan-saya', report: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error: ' + error.message);
  }
});

// ───────────────────────────────────────────
// ADMIN
// ───────────────────────────────────────────
app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const allReports = await pool.query('SELECT r.*, u.email as user_email FROM reports r LEFT JOIN users u ON r.user_id = u.id ORDER BY r.created_at DESC');
    res.render('admin', { page: 'admin', reports: allReports.rows });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error: ' + error.message);
  }
});

app.post('/admin/update-status/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await pool.query('UPDATE reports SET status = $1 WHERE id = $2', [status, id]);
    res.redirect('/admin');
  } catch (error) {
    console.error(error);
    res.status(500).send('Failed to update status.');
  }
});

app.listen(port, () => console.log(`Server running on port ${port}`));
