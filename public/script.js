document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null;
    let isRegisterMode = false;
    const socket = io();

    // DOM Elements
    const authSection = document.getElementById('auth-section');
    const userDashboard = document.getElementById('user-dashboard');
    const adminDashboard = document.getElementById('admin-dashboard');
    const navLinks = document.getElementById('nav-links');
    const toast = document.getElementById('toast');

    const authForm = document.getElementById('auth-form');
    const authBtn = document.getElementById('auth-btn');
    const toggleAuth = document.getElementById('toggle-auth');
    const nameField = document.getElementById('name-field');

    const submissionForm = document.getElementById('submission-form');
    const templateSelector = document.getElementById('template-selector');
    const dynamicFieldsContainer = document.getElementById('dynamic-fields');
    const dynamicFormTitle = document.getElementById('dynamic-form-title');

    const userTableBody = document.querySelector('#user-table tbody');
    const adminTableBody = document.querySelector('#admin-table tbody');
    const adminSearch = document.getElementById('admin-search');
    
    const commentModal = document.getElementById('comment-modal');
    const adminCommentText = document.getElementById('admin-comment-text');
    const confirmStatusBtn = document.getElementById('confirm-status-btn');
    let currentAction = null;

    const viewModal = document.getElementById('view-modal');
    const viewDetailsContent = document.getElementById('view-details-content');

    let templates = []; 

    // Initial Check
    checkSession();

    // Theme Toggle Setup
    const themeBtn = document.createElement('button');
    themeBtn.textContent = '🌙 Theme';
    themeBtn.onclick = toggleTheme;
    
    // Auth Toggle
    toggleAuth.addEventListener('click', () => {
        isRegisterMode = !isRegisterMode;
        if (isRegisterMode) {
            nameField.style.display = 'block';
            authBtn.textContent = 'Register';
            toggleAuth.textContent = 'Already a member? Sign In';
        } else {
            nameField.style.display = 'none';
            authBtn.textContent = 'Sign In';
            toggleAuth.textContent = 'New ? Register';
        }
    });

    // Event Listeners
    authForm.addEventListener('submit', handleAuth);
    submissionForm.addEventListener('submit', handleSubmitForm);
    adminSearch.addEventListener('input', (e) => filterAdminTable(e.target.value));
    templateSelector.addEventListener('change', handleTemplateChange);
    confirmStatusBtn.addEventListener('click', processStatusUpdate);

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
            console.log('No active session');
        }
    }

    async function handleAuth(e) {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const name = document.getElementById('name').value;
        
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
                    toggleAuth.click(); // Switch to login
                }
            } else {
                showToast(data.error || 'Error occurred', true);
            }
        } catch (err) {
            showToast('Server connection error', true);
        }
    }

    function updateUIForUser() {
        if (!currentUser) return;
        authSection.classList.add('hidden');
        
        navLinks.innerHTML = '';
        navLinks.appendChild(themeBtn);
        
        const logoutBtn = document.createElement('button');
        logoutBtn.textContent = 'Logout';
        logoutBtn.onclick = handleLogout;
        navLinks.appendChild(logoutBtn);

        if (currentUser.role === 'admin') {
            adminDashboard.classList.remove('hidden');
            fetchAdminData();
            fetchTemplates(); 
        } else {
            userDashboard.classList.remove('hidden');
            fetchTemplates();
            fetchUserData();
        }
    }

    async function handleLogout() {
        await fetch('/api/logout', { method: 'POST' });
        location.reload();
    }

    // --- TEMPLATE LOGIC ---

    async function fetchTemplates() {
        try {
            const res = await fetch('/api/templates');
            if (!res.ok) throw new Error('Failed to fetch');
            templates = await res.json();
            renderTemplateSelector(templates);
        } catch (err) {
            console.error('Failed to load templates', err);
        }
    }

    function renderTemplateSelector(temps) {
        templateSelector.innerHTML = '<option value="">-- Select a Form --</option>';
        temps.forEach(t => {
            templateSelector.innerHTML += `<option value="${t.template_id}">${t.title}</option>`;
        });
    }

    function handleTemplateChange(e) {
        const id = e.target.value;
        if (!id) {
            submissionForm.style.display = 'none';
            return;
        }

        const template = templates.find(t => t.template_id == id);
        if (template) {
            dynamicFormTitle.textContent = template.title;
            dynamicFieldsContainer.innerHTML = ''; 
            
            if (!template.schema || template.schema.length === 0) {
                showToast('This template has no fields defined.', true);
                return;
            }

            template.schema.forEach((field, index) => {
                const div = document.createElement('div');
                div.className = 'input-group';
                
                // Create safe ID
                const safeId = `field-${index}`;
                
                let inputHtml = `<label>${escapeHtml(field.label)}</label>`;
                
                if (field.type === 'textarea') {
                    inputHtml += `<textarea name="${escapeHtml(field.label)}" id="${safeId}" rows="4" required></textarea>`;
                } else if (field.type === 'star') {
                    // Star Rating HTML (Reverse order for CSS logic)
                    inputHtml += `
                        <div class="star-rating-container">
                            <input type="radio" name="${escapeHtml(field.label)}" id="${safeId}-5" value="5">
                            <label for="${safeId}-5" title="5 stars">★</label>
                            <input type="radio" name="${escapeHtml(field.label)}" id="${safeId}-4" value="4">
                            <label for="${safeId}-4" title="4 stars">★</label>
                            <input type="radio" name="${escapeHtml(field.label)}" id="${safeId}-3" value="3">
                            <label for="${safeId}-3" title="3 stars">★</label>
                            <input type="radio" name="${escapeHtml(field.label)}" id="${safeId}-2" value="2">
                            <label for="${safeId}-2" title="2 stars">★</label>
                            <input type="radio" name="${escapeHtml(field.label)}" id="${safeId}-1" value="1" checked>
                            <label for="${safeId}-1" title="1 star">★</label>
                        </div>`;
                } else {
                    inputHtml += `<input type="${field.type}" name="${escapeHtml(field.label)}" id="${safeId}" required>`;
                }
                
                div.innerHTML = inputHtml;
                dynamicFieldsContainer.appendChild(div);
            });

            submissionForm.style.display = 'block';
        }
    }

    async function handleSubmitForm(e) {
        e.preventDefault();
        
        const templateId = templateSelector.value;
        if (!templateId) {
            showToast('Please select a form type', true);
            return;
        }

        const formData = {};
        
        // 1. Handle Standard Inputs & Textareas
        const inputs = dynamicFieldsContainer.querySelectorAll('input:not([type="radio"]), textarea, select');
        inputs.forEach(input => {
            formData[input.name] = input.value;
        });

        // 2. Handle Radio Buttons (Star Rating) - Get checked value for each group
        const checkedRadios = dynamicFieldsContainer.querySelectorAll('input[type="radio"]:checked');
        checkedRadios.forEach(radio => {
            formData[radio.name] = radio.value;
        });

        // Submission Logic
        try {
            const res = await fetch('/api/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ templateId, formData })
            });

            const result = await res.json();
            if (res.ok) {
                showToast('Submission received for review');
                submissionForm.reset();
                submissionForm.style.display = 'none';
                templateSelector.value = "";
                fetchUserData();
            } else {
                showToast(result.error || 'Submission failed', true);
            }
        } catch (err) {
            console.error(err);
            showToast('Server error', true);
        }
    }

    // --- DATA RENDERING ---

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
            const dateTime = new Date(sub.submitted_at).toLocaleDateString();
            const row = `
                <tr>
                    <td>#${sub.submission_id}</td>
                    <td>${escapeHtml(sub.form_title)}</td>
                    <td>${dateTime}</td>
                    <td><span class="status ${sub.status}">${sub.status}</span></td>
                    <td>
                        <button class="btn-small" onclick='showDetails(${JSON.stringify(sub).replace(/'/g, "&#39;")})'>View</button>
                    </td>
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
            const dateTime = new Date(sub.submitted_at).toLocaleDateString();
            const dataPreview = Object.values(sub.form_data).slice(0, 2).map(v => escapeHtml(String(v))).join(', ');

            const row = `
                <tr>
                    <td>#${sub.submission_id}</td>
                    <td>
                        <div>${escapeHtml(sub.user_name)}</div>
                        <small style="color:var(--antique-gold)">${escapeHtml(sub.email)}</small>
                    </td>
                    <td>${escapeHtml(sub.form_title)}</td>
                    <td><span style="font-size:0.8rem; opacity:0.8">${dataPreview}...</span></td>
                    <td>${dateTime}</td>
                    <td><span class="status ${sub.status}">${sub.status}</span></td>
                    <td>
                        <button class="btn-small" onclick='showDetails(${JSON.stringify(sub).replace(/'/g, "&#39;")})'>View</button>
                        <button class="action-btn btn-approve" onclick="promptUpdate(${sub.submission_id}, 'Approved')">✓</button>
                        <button class="action-btn btn-reject" onclick="promptUpdate(${sub.submission_id}, 'Rejected')">✕</button>
                        <button class="action-btn btn-delete" onclick="deleteSubmission(${sub.submission_id})">🗑</button>
                    </td>
                </tr>
            `;
            adminTableBody.innerHTML += row;
        });
    }

    // Helper to show details
    window.showDetails = (sub) => {
        let html = `<h4 style="margin-bottom:10px">Form: ${escapeHtml(sub.form_title)}</h4>`;
        html += `<p><strong>Status:</strong> <span class="status ${sub.status}">${sub.status}</span></p>`;
        html += '<hr style="margin: 15px 0; border-color: var(--antique-gold); opacity: 0.3">';
        
        // Determine schema for type checking
        let schema = [];
        if (sub.form_schema) schema = sub.form_schema;
        
        const schemaMap = {};
        schema.forEach(s => schemaMap[s.label] = s.type);

        for (let key in sub.form_data) {
            let val = sub.form_data[key];
            const type = schemaMap[key];

            if (type === 'star') {
                let stars = '';
                for(let i=0; i<5; i++) stars += i < parseInt(val) ? '★' : '☆';
                val = `<span class="star-display">${stars}</span> (${val}/5)`;
            } else {
                val = escapeHtml(String(val));
            }
            html += `<p><strong>${escapeHtml(key)}:</strong> ${val}</p>`;
        }

        if (sub.comments && sub.comments.length > 0) {
            html += '<hr style="margin: 15px 0; border-color: var(--antique-gold); opacity: 0.3">';
            html += '<h4>Info</h4>';
            sub.comments.forEach(c => {
                html += `<div class="audit-log"><strong>${escapeHtml(c.author_name)}:</strong> ${escapeHtml(c.comment_text)}</div>`;
            });
        }

        viewDetailsContent.innerHTML = html;
        viewModal.classList.remove('hidden');
    };

    window.closeViewModal = () => viewModal.classList.add('hidden');

    // --- ADMIN TEMPLATE BUILDER ---

    window.addTemplateField = () => {
        const container = document.getElementById('field-builder');
        const div = document.createElement('div');
        div.className = 'input-group';
        div.style.display = 'flex';
        div.style.gap = '10px';
        div.style.alignItems = 'center';
        
        div.innerHTML = `
            <input type="text" placeholder="Field Label" class="field-label" style="flex:2">
            <select class="field-type" style="flex:1">
                <option value="text">Text</option>
                <option value="date">Date</option>
                <option value="number">Number</option>
                <option value="textarea">Long Text</option>
                <option value="star">Star Rating</option>
            </select>
            <button class="btn-small" onclick="this.parentElement.remove()" style="background:#e57373; color:#fff; border-color:#e57373;">X</button>
        `;
        container.appendChild(div);
    };

    window.saveTemplate = async () => {
        const title = document.getElementById('template-name').value;
        if (!title) return showToast('Please enter a template name', true);

        const fieldContainers = document.querySelectorAll('#field-builder .input-group');
        const schema = [];
        
        fieldContainers.forEach(div => {
            const label = div.querySelector('.field-label').value.trim();
            const type = div.querySelector('.field-type').value;
            if (label) schema.push({ label, type });
        });

        if (schema.length === 0) return showToast('Please add at least one field', true);

        try {
            const res = await fetch('/api/admin/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, schema })
            });
            
            if (res.ok) {
                showToast('Template Created!');
                document.getElementById('template-name').value = '';
                document.getElementById('field-builder').innerHTML = '';
                fetchTemplates();
            } else {
                const data = await res.json();
                showToast(data.error || 'Error creating template', true);
            }
        } catch (err) {
            showToast('Server error', true);
        }
    };

    // --- MODALS & ACTIONS ---

    window.promptUpdate = (id, status) => {
        currentAction = { id, status };
        adminCommentText.value = '';
        commentModal.classList.remove('hidden');
    };

    window.closeModal = () => {
        commentModal.classList.add('hidden');
        currentAction = null;
    };

    async function processStatusUpdate() {
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
                fetchAdminData();
            }
        } catch (err) {
            showToast('Action failed', true);
        }
    }

    window.deleteSubmission = async (id) => {
        if(!confirm("Delete this submission permanently?")) return;

        try {
            const res = await fetch(`/api/admin/delete/${id}`, { method: 'DELETE' });
            if (res.ok) {
                showToast('Deleted');
                fetchAdminData();
            }
        } catch (err) {
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

    // Helper: Escape HTML
    function escapeHtml(text) {
        if (!text) return text;
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function showToast(msg, isError = false) {
        toast.textContent = msg;
        toast.style.background = isError ? '#e57373' : 'var(--antique-gold)';
        toast.style.color = isError ? '#fff' : 'var(--deep-green)';
        toast.classList.add('show');
        setTimeout(() => { toast.classList.remove('show'); }, 3000);
    }

    // Socket Listeners
    socket.on('new-submission', () => {
        if (currentUser && currentUser.role === 'admin') {
            fetchAdminData();
            showToast('New submission received!');
        }
    });

    socket.on('template-created', () => {
        if (currentUser) {
            fetchTemplates();
        }
    });

    socket.on('status-updated', (data) => {
        if (currentUser) {
            if (currentUser.role === 'user') {
                fetchUserData();
                showToast(`Status updated to ${data.status}`);
            } else {
                fetchAdminData();
            }
        }
    });

    socket.on('submission-deleted', () => {
        if (currentUser && currentUser.role === 'admin') fetchAdminData();
    });
});