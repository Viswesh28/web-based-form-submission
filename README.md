# Secure Web Based Form Submissions

**PBL Mini Project v2.0**

A full-stack web application designed for secure form submissions and administrative management. This system features a refined "Old Money" aesthetic, role-based access control, real-time updates, and a complete audit trail for submission status changes.

---

## 📖 Table of Contents
- [About The Project](#-about-the-project)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Usage](#-usage)
- [Security Implementations](#-security-implementations)
- [API Endpoints](#-api-endpoints)
- [Database Schema](#-database-schema)

---

## 🏛️ About The Project

This application provides a platform for users to submit requests (e.g., leave requests, budget proposals) and track their status in real-time. Administrators have a dedicated dashboard to review submissions, approve or reject them with notes, and export data.

The frontend utilizes a custom "Dark/Light" theme switcher with an aesthetic focused on typography and deep forest greens, while the backend ensures data integrity and secure handling of user credentials.

---

## ✨ Features

### User Functionalities
- **Authentication**: Secure Register and Login system.
- **Submission Portal**: Create new submissions with title and detailed justification.
- **Real-Time Tracking**: View submission status (Pending, Approved, Rejected) instantly.
- **Audit Log**: View administrative comments/notes attached to specific submissions.
- **Data Export**: Download personal submission history as a CSV file.

### Admin Functionalities
- **Authority Overview**: View all submissions from all users in a single dashboard.
- **Action Management**: Approve or Reject submissions via a modal interface.
- **Audit Notes**: Add mandatory or optional comments when changing status (creates an audit trail).
- **Search & Filter**: Quickly find specific submissions.
- **Data Export**: Export all system-wide submission data to CSV.

### System Features
- **Real-Time Updates**: Utilizes **Socket.io** for instant UI updates without page refreshes.
- **Theming**: Seamless switch between Dark Mode (Default) and Light Mode.
- **Security**: Password hashing, session management, and role-based access control (RBAC).

---

## 🛠️ Tech Stack

**Frontend:**
- HTML5, CSS3 (CSS Variables, Flexbox, Grid)
- Vanilla JavaScript (ES6+)
- [Socket.io Client](https://socket.io/)
- [Google Fonts](https://fonts.google.com/) (Cinzel, Lato)

**Backend:**
- [Node.js](https://nodejs.org/)
- [Express.js](https://expressjs.com/)
- [Socket.io](https://socket.io/) (WebSockets)

**Database:**
- [SQLite3](https://www.sqlite.org/index.html) (Lightweight, file-based SQL)

**Security & Utils:**
- `bcryptjs` (Password Hashing)
- `express-session` (Session Management)
- `cors` & `body-parser`

---

## 📂 Project Structure

To run this project correctly, place your files in the following structure:
