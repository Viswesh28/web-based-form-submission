document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null;
    let isRegisterMode = false;
    const socket = io(); // Socket.IO Connection

    const authSection = document.getElementById('auth-section');
    const userDashboard = document.getElementById('user-dashboard');
    const adminDashboard = document.getElementById('admin-dashboard');
    const navLinks = document.getElementById('nav-links');
    const toast = document.getElementById('toast');

    const authForm = document.getElementById('auth-form');
    const authBtn = document.getElementById('auth-btn');
    const toggleAuth = document.getElementById('toggle-auth');
    
    // Removed Role Element Ref as it's no longer in HTML
    const nameField = document.getElementById('name-field');

    const submissionForm = document.getElementById('submission-form');
    const userTableBody = document.querySelector('#user-table tbody');
    const adminTableBody = document.querySelector('#admin-table tbody');
    const adminSearch = document.getElementById('admin-search');
    
    // Modal Elements
    const commentModal = document.getElementById('comment-modal');
    const adminCommentText = document.getElementById('admin-comment-text');
    const confirmStatusBtn = document.getElementById('confirm-status-btn');
    let currentAction = null; // Store { id, status }

    checkSession();

    // Theme Toggle
    const themeBtn = document.createElement('button');
    themeBtn.textContent = '🌙 Theme';
    themeBtn.onclick = toggleTheme;
    
    toggleAuth.addEventListener('click', () => {
        isRegisterMode = !isRegisterMode;
        if (isRegisterMode) {
            nameField.style.display = 'block';
            authBtn.textContent = 'Register';
            toggleAuth.textContent = 'Already a member? Sign In';
        } else {
            nameField.style.display = 'none';
            authBtn.textContent = 'Sign In';
            toggleAuth.textContent = 'New to Heritage? Register';
        }
    });

    authForm.addEventListener('submit', handleAuth);
    submissionForm.addEventListener('submit', handleSubmitForm);
    adminSearch.addEventListener('input', (e) => filterAdminTable(e.target.value));

    function toggleTheme() {
        const html = document.documentElement;
        const current = html.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        themeBtn.textContent = next === 'dark' ? '🌙 Theme' : '☀️ Theme';
    }

    async function checkSession() {
        try {
            const res = await fetch('/api/session');
            if (res.ok) {
                const data = await res.json();
                currentUser = data.user;
                updateUIForUser();
            }
        } catch (err) {
            console.log('No session');
        }
    }

    async function handleAuth(e) {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const name = document.getElementById('name').value;
        
        // Role no longer sent from client
        const endpoint = isRegisterMode ? '/api/register' : '/api/login';
        const body = isRegisterMode ? { name, email, password } : { email, password };

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await res.json();
            
            if (res.ok) {
                showToast(data.message);
                if (!isRegisterMode) {
                    currentUser = data.user;
                    updateUIForUser();
                } else {
                    toggleAuth.click();
                }
            } else {
                showToast(data.error, true);
            }
        } catch (err) {
            showToast('Server error', true);
        }
    }

    function updateUIForUser() {
        if (!currentUser) return;
        authSection.classList.add('hidden');
        
        navLinks.innerHTML = '';
        
        // Add Theme Toggle
        navLinks.appendChild(themeBtn);
        
        const logoutBtn = document.createElement('button');
        logoutBtn.textContent = 'Logout';
        logoutBtn.onclick = handleLogout;
        navLinks.appendChild(logoutBtn);

        if (currentUser.role === 'admin') {
            adminDashboard.classList.remove('hidden');
            fetchAdminData();
        } else {
            userDashboard.classList.remove('hidden');
            fetchUserData();
        }
    }

    async function handleLogout() {
        await fetch('/api/logout', { method: 'POST' });
        location.reload();
    }

    async function handleSubmitForm(e) {
        e.preventDefault();
        const title = document.getElementById('form-title').value;
        const data = document.getElementById('form-data').value;

        try {
            const res = await fetch('/api/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, data })
            });

            if (res.ok) {
                showToast('Submission received for review');
                submissionForm.reset();
                // Socket updates admin automatically, but we update local UI too
                fetchUserData();
            }
        } catch (err) {
            showToast('Submission failed', true);
        }
    }

    async function fetchUserData() {
        try {
            const res = await fetch('/api/submissions');
            const data = await res.json();
            renderUserTable(data);
        } catch (err) {
            console.error(err);
        }
    }

    function renderUserTable(submissions) {
        userTableBody.innerHTML = '';
        submissions.forEach(sub => {
            const dateTime = new Date(sub.submitted_at).toLocaleString();
            
            // Render Comments (Audit Log)
            let commentsHtml = '';
            if (sub.comments && sub.comments.length > 0) {
                commentsHtml = sub.comments.map(c => 
                    `<div class="audit-log"><strong>${c.author_name}:</strong> ${c.comment_text}</div>`
                ).join('');
            } else {
                commentsHtml = '<span style="opacity:0.5">No notes</span>';
            }
            
            const row = `
                <tr>
                    <td>#${sub.submission_id}</td>
                    <td>${sub.form_title}</td>
                    <td>${dateTime}</td>
                    <td><span class="status ${sub.status}">${sub.status}</span></td>
                    <td>${commentsHtml}</td>
                </tr>
            `;
            userTableBody.innerHTML += row;
        });
    }

    async function fetchAdminData() {
        try {
            const res = await fetch('/api/admin/all');
            const data = await res.json();
            renderAdminTable(data);
        } catch (err) {
            console.error(err);
        }
    }

    function renderAdminTable(submissions) {
        adminTableBody.innerHTML = '';
        submissions.forEach(sub => {
            const dateTime = new Date(sub.submitted_at).toLocaleString(); 

            const row = `
                <tr>
                    <td>#${sub.submission_id}</td>
                    <td>
                        <div>${sub.user_name}</div>
                        <small style="color:var(--antique-gold)">${sub.email}</small>
                    </td>
                    <td>${sub.form_title}</td>
                    <td>${dateTime}</td>
                    <td><span class="status ${sub.status}">${sub.status}</span></td>
                    <td>
                        <button class="action-btn btn-approve" onclick="promptUpdate(${sub.submission_id}, 'Approved')">✓</button>
                        <button class="action-btn btn-reject" onclick="promptUpdate(${sub.submission_id}, 'Rejected')">✕</button>
                        <button class="action-btn btn-delete" onclick="deleteSubmission(${sub.submission_id})">🗑</button>
                    </td>
                </tr>
            `;
            adminTableBody.innerHTML += row;
        });
    }

    // Open Modal for Status Update
    window.promptUpdate = (id, status) => {
        currentAction = { id, status };
        adminCommentText.value = ''; // Clear previous
        commentModal.classList.remove('hidden');
    };

    window.closeModal = () => {
        commentModal.classList.add('hidden');
        currentAction = null;
    };

    confirmStatusBtn.addEventListener('click', async () => {
        if (!currentAction) return;
        const comment = adminCommentText.value.trim();
        
        try {
            const res = await fetch('/api/admin/update-status', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    submissionId: currentAction.id, 
                    status: currentAction.status,
                    comment: comment 
                })
            });
            if (res.ok) {
                showToast(`Marked as ${currentAction.status}`);
                closeModal();
                fetchAdminData(); // Refresh Table
            }
        } catch (err) {
            showToast('Action failed', true);
        }
    });

    window.deleteSubmission = async (id) => {
        if(!confirm("Are you sure you want to delete this submission?")) return;

        try {
            const res = await fetch(`/api/admin/delete/${id}`, { method: 'DELETE' });
            if (res.ok) {
                showToast('Submission deleted successfully');
                fetchAdminData();
            } else {
                showToast('Failed to delete', true);
            }
        } catch (err) {
            console.error(err);
            showToast('Server error', true);
        }
    };

    function filterAdminTable(query) {
        const rows = document.querySelectorAll('#admin-table tbody tr');
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(query.toLowerCase()) ? '' : 'none';
        });
    }

    // Export Data
    window.exportData = async (type) => {
        try {
            const res = await fetch(`/api/export/${type}`);
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${type}_export.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            } else {
                showToast('Export failed', true);
            }
        } catch (err) {
            showToast('Export error', true);
        }
    };

    function showToast(msg, isError = false) {
        toast.textContent = msg;
        toast.style.background = isError ? '#e57373' : 'var(--antique-gold)';
        toast.style.color = isError ? '#fff' : 'var(--deep-green)';
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // --- REAL-TIME SOCKET LISTENERS ---
    
    // Listen for new submissions (Admin Only needs this really, but good for all)
    socket.on('new-submission', () => {
        if (currentUser && currentUser.role === 'admin') {
            fetchAdminData();
            showToast('New submission received!');
        }
    });

    // Listen for status updates (User needs this)
    socket.on('status-updated', (data) => {
        if (currentUser) {
            if (currentUser.role === 'user') {
                fetchUserData(); // Refresh user table to see new status/comments
                showToast(`Status updated to ${data.status}`);
            } else if (currentUser.role === 'admin') {
                fetchAdminData(); // Refresh admin table if multiple admins exist
            }
        }
    });

    // Listen for deletions
    socket.on('submission-deleted', () => {
        if (currentUser && currentUser.role === 'admin') {
            fetchAdminData();
        }
    });
});