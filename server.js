// server.js
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const db = require('./db');

// --- CRITICAL FIX: Define SQLiteStore correctly ---
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// CORRECTED: Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// CORRECTED: Explicit Route for Root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Session Security with SQLite Persistence
app.use(session({
    store: new SQLiteStore({ db: 'sessions.db', dir: '.' }), // Creates sessions.db in root
    secret: 'old_money_secret_key_v2_production_ready', 
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Set to true only if using HTTPS
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Socket.io Connection
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// --- DATABASE INITIALIZATION ---
const initDB = async () => {
    try {
        await db.run(`
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                email TEXT UNIQUE,
                password TEXT,
                role TEXT CHECK(role IN ('user', 'admin')) DEFAULT 'user'
            )
        `);
        await db.run(`
            CREATE TABLE IF NOT EXISTS form_templates (
                template_id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                schema TEXT NOT NULL,
                created_at DATETIME DEFAULT (datetime('now', 'localtime'))
            )
        `);
        await db.run(`
            CREATE TABLE IF NOT EXISTS submissions (
                submission_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                template_id INTEGER,
                form_data TEXT,
                status TEXT DEFAULT 'Pending',
                submitted_at DATETIME DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (user_id) REFERENCES users(user_id),
                FOREIGN KEY (template_id) REFERENCES form_templates(template_id)
            )
        `);
        await db.run(`
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                submission_id INTEGER,
                author_name TEXT,
                comment_text TEXT,
                created_at DATETIME DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (submission_id) REFERENCES submissions(submission_id)
            )
        `);

        const adminExists = await db.get("SELECT * FROM users WHERE email = ?", ["@heritage.comadmin"]);
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await db.run("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)", 
                ["Administrator", "admin@heritage.com", hashedPassword, "admin"]);
            console.log("Default Admin account created.");
        }
    } catch (err) {
        console.error("Database initialization error:", err);
    }
};

initDB();

// --- ROUTES ---

// Auth: Register
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.run(
            'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
            [name, email, hashedPassword, 'user']
        );
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Auth: Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
        
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            req.session.user = { id: user.user_id, name: user.name, role: user.role };
            res.json({ message: 'Login successful', user: { id: user.user_id, name: user.name, role: user.role } });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/session', (req, res) => {
    if (req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: 'Not logged in' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: 'Could not log out' });
        res.json({ message: 'Logged out' });
    });
});

// --- TEMPLATE ROUTES ---

// Admin: Create Template
app.post('/api/admin/templates', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const { title, schema } = req.body; 
        if (!title || !schema) return res.status(400).json({ error: 'Missing data' });

        await db.run(
            'INSERT INTO form_templates (title, schema) VALUES (?, ?)',
            [title, JSON.stringify(schema)]
        );
        
        io.emit('template-created');
        
        res.status(201).json({ message: 'Template created' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create template' });
    }
});

// Get All Templates
app.get('/api/templates', async (req, res) => {
    if (!req.session.user) return res.status(403).json({ error: 'Unauthorized' });
    try {
        const rows = await db.all('SELECT template_id, title, schema FROM form_templates ORDER BY created_at DESC');
        const templates = rows.map(t => ({ ...t, schema: JSON.parse(t.schema) }));
        res.json(templates);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

// --- SUBMISSION ROUTES ---

// User: Submit Form
app.post('/api/submit', async (req, res) => {
    if (!req.session.user) return res.status(403).json({ error: 'Unauthorized' });
    try {
        const { templateId, formData } = req.body;
        const userId = req.session.user.id;
        
        if (!templateId || !formData) {
            return res.status(400).json({ error: 'Missing template or form data' });
        }

        await db.run(
            'INSERT INTO submissions (user_id, template_id, form_data, status, submitted_at) VALUES (?, ?, ?, ?, datetime("now", "localtime"))',
            [userId, templateId, JSON.stringify(formData), 'Pending']
        );
        
        io.emit('new-submission');
        res.status(201).json({ message: 'Form submitted successfully' });
    } catch (error) {
        console.error("Submit Error:", error);
        res.status(500).json({ error: 'Submission failed' });
    }
});

// User: Get Own Submissions
app.get('/api/submissions', async (req, res) => {
    if (!req.session.user) return res.status(403).json({ error: 'Unauthorized' });
    try {
        const userId = req.session.user.id;
        const rows = await db.all(`
            SELECT s.*, t.title as form_title, t.template_id, t.schema as form_schema
            FROM submissions s 
            JOIN form_templates t ON s.template_id = t.template_id
            WHERE s.user_id = ? 
            ORDER BY s.submitted_at DESC`,
            [userId]
        );
        
        const submissions = rows.map(sub => {
            return { 
                ...sub, 
                form_data: JSON.parse(sub.form_data),
                form_schema: JSON.parse(sub.form_schema)
            };
        });

        for(let sub of submissions) {
            const comments = await db.all('SELECT * FROM comments WHERE submission_id = ?', [sub.submission_id]);
            sub.comments = comments;
        }

        res.json(submissions);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch submissions' });
    }
});

// Admin: Get All Submissions
app.get('/api/admin/all', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const rows = await db.all(`
            SELECT s.*, u.name as user_name, u.email, t.title as form_title, t.schema as form_schema
            FROM submissions s 
            JOIN users u ON s.user_id = u.user_id 
            JOIN form_templates t ON s.template_id = t.template_id
            ORDER BY s.submitted_at DESC
        `);
        
        rows.forEach(row => {
            try {
                row.form_data = JSON.parse(row.form_data);
                row.form_schema = JSON.parse(row.form_schema);
            } catch (e) { console.log("Parse error", e); }
        });

        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// Admin: Update Status
app.put('/api/admin/update-status', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const { submissionId, status, comment } = req.body;
        
        await db.run(
            'UPDATE submissions SET status = ? WHERE submission_id = ?',
            [status, submissionId]
        );

        if (comment) {
            await db.run(
                'INSERT INTO comments (submission_id, author_name, comment_text) VALUES (?, ?, ?)',
                [submissionId, req.session.user.name, comment]
            );
        }

        io.emit('status-updated', { submissionId, status });
        res.json({ message: 'Status updated' });
    } catch (error) {
        res.status(500).json({ error: 'Update failed' });
    }
});

// Admin: Delete Submission
app.delete('/api/admin/delete/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const { id } = req.params;
        await db.run('DELETE FROM comments WHERE submission_id = ?', [id]);
        await db.run('DELETE FROM submissions WHERE submission_id = ?', [id]);
        
        io.emit('submission-deleted', { id });
        res.json({ message: 'Submission deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete submission' });
    }
});

// Export Data
app.get('/api/export/:type', async (req, res) => {
    if (!req.session.user) return res.status(403).send('Unauthorized');
    
    try {
        let rows;
        const type = req.params.type;
        
        if (type === 'user') {
            rows = await db.all(`
                SELECT s.submission_id, t.title, s.form_data, s.status, s.submitted_at 
                FROM submissions s
                JOIN form_templates t ON s.template_id = t.template_id
                WHERE s.user_id = ?`, [req.session.user.id]);
        } else if (type === 'admin' && req.session.user.role === 'admin') {
            rows = await db.all(`
                SELECT s.submission_id, u.name as user_name, t.title, s.form_data, s.status, s.submitted_at 
                FROM submissions s 
                JOIN users u ON s.user_id = u.user_id
                JOIN form_templates t ON s.template_id = t.template_id
            `);
        } else {
            return res.status(403).send('Forbidden');
        }

        if (rows.length === 0) return res.send('No data to export');
        
        const flattenedRows = rows.map(row => {
            let data = {};
            try { data = JSON.parse(row.form_data); } catch(e) {}
            
            const flatRow = {
                id: row.submission_id,
                title: row.title,
                status: row.status,
                date: row.submitted_at
            };
            
            for(let key in data) { flatRow[key] = data[key]; }
            if(row.user_name) flatRow.user = row.user_name;
            return flatRow;
        });

        const headers = Object.keys(flattenedRows[0]);
        const csvRows = [];
        csvRows.push(headers.map(h => `"${h}"`).join(','));
        for (const row of flattenedRows) {
            const values = headers.map(header => {
                const val = row[header] || '';
                return `"${String(val).replace(/"/g, '""')}"`;
            });
            csvRows.push(values.join(','));
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${type}_report.csv`);
        res.send(csvRows.join('\n'));
    } catch (error) {
        console.error(error);
        res.status(500).send('Export failed');
    }
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});