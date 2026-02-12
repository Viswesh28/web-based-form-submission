const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const http = require('http');
const { Server } = require('socket.io');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // Ensure files are in 'public' folder
app.use(session({
    secret: 'old_money_secret_key_v2',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Socket.io Connection
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
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
            CREATE TABLE IF NOT EXISTS submissions (
                submission_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                form_title TEXT,
                form_data TEXT,
                status TEXT DEFAULT 'Pending',
                submitted_at DATETIME DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )
        `);

        // NEW: Comments Table for Audit Logs
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

        const adminExists = await db.get("SELECT * FROM users WHERE email = ?", ["admin@heritage.com"]);
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

// 1. User Registration (SECURITY FIX: Role forced to 'user')
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body; // Role no longer accepted from body
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await db.run(
            'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
            [name, email, hashedPassword, 'user'] // Hardcoded to 'user'
        );
        res.status(201).json({ message: 'User registered successfully', userId: result.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Email already exists or server error' });
    }
});

// 2. User Login
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
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 3. Check Session
app.get('/api/session', (req, res) => {
    if (req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: 'Not logged in' });
    }
});

// 4. Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out' });
});

// 5. Submit Form
app.post('/api/submit', async (req, res) => {
    if (!req.session.user) return res.status(403).json({ error: 'Unauthorized' });
    try {
        const { title, data } = req.body;
        const userId = req.session.user.id;
        
        await db.run(
            'INSERT INTO submissions (user_id, form_title, form_data, submitted_at) VALUES (?, ?, ?, datetime("now", "localtime"))',
            [userId, title, JSON.stringify(data)]
        );
        
        // Notify Admins of new submission
        io.emit('new-submission');
        res.status(201).json({ message: 'Form submitted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Submission failed' });
    }
});

// 6. Get User Submissions (Includes comments now)
app.get('/api/submissions', async (req, res) => {
    if (!req.session.user) return res.status(403).json({ error: 'Unauthorized' });
    try {
        const userId = req.session.user.id;
        const rows = await db.all(
            'SELECT * FROM submissions WHERE user_id = ? ORDER BY submitted_at DESC',
            [userId]
        );
        
        // Fetch comments for each submission
        for (let sub of rows) {
            const comments = await db.all('SELECT * FROM comments WHERE submission_id = ?', [sub.submission_id]);
            sub.comments = comments;
        }
        
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch submissions' });
    }
});

// 7. Admin: Get All Submissions
app.get('/api/admin/all', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        const rows = await db.all(`
            SELECT s.*, u.name as user_name, u.email 
            FROM submissions s 
            JOIN users u ON s.user_id = u.user_id 
            ORDER BY s.submitted_at DESC
        `);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});

// 8. Admin: Update Status (With optional Comment)
app.put('/api/admin/update-status', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        const { submissionId, status, comment } = req.body;
        
        await db.run(
            'UPDATE submissions SET status = ? WHERE submission_id = ?',
            [status, submissionId]
        );

        // Add comment if provided
        if (comment) {
            await db.run(
                'INSERT INTO comments (submission_id, author_name, comment_text) VALUES (?, ?, ?)',
                [submissionId, req.session.user.name, comment]
            );
        }

        // Notify User via Socket (User would listen based on their ID, but we broadcast generally for simplicity here)
        io.emit('status-updated', { submissionId, status });
        res.json({ message: 'Status updated' });
    } catch (error) {
        res.status(500).json({ error: 'Update failed' });
    }
});

// 9. Admin: Delete Submission
app.delete('/api/admin/delete/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        const { id } = req.params;
        // Delete comments associated with submission first
        await db.run('DELETE FROM comments WHERE submission_id = ?', [id]);
        await db.run('DELETE FROM submissions WHERE submission_id = ?', [id]);
        
        io.emit('submission-deleted', { id });
        res.json({ message: 'Submission deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to delete submission' });
    }
});

// 10. Export Data (Simple CSV)
app.get('/api/export/:type', async (req, res) => {
    if (!req.session.user) return res.status(403).send('Unauthorized');
    
    try {
        let rows;
        const type = req.params.type;
        
        if (type === 'user') {
            rows = await db.all('SELECT submission_id, form_title, status, submitted_at FROM submissions WHERE user_id = ?', [req.session.user.id]);
        } else if (type === 'admin' && req.session.user.role === 'admin') {
            rows = await db.all(`
                SELECT s.submission_id, u.name as user_name, s.form_title, s.status, s.submitted_at 
                FROM submissions s 
                JOIN users u ON s.user_id = u.user_id
            `);
        } else {
            return res.status(403).send('Forbidden');
        }

        // Convert to CSV
        if (rows.length === 0) return res.send('No data to export');
        
        const headers = Object.keys(rows[0]).join(',');
        const data = rows.map(row => Object.values(row).join(',')).join('\n');
        const csv = `${headers}\n${data}`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${type}_report.csv`);
        res.send(csv);
    } catch (error) {
        res.status(500).send('Export failed');
    }
});

// Change server.listen to server.listen (using http server)
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});