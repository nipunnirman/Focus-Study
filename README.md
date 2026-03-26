# StudyFlow — Study Timer App

## Architecture

```
Frontend (React + Vite)  ←→  Backend (FastAPI Python)  ←→  MongoDB
                                     ↕
                              JSON Cache Layer
                          (per-user .json file)
```

### JSON Cache Layer (solves real-time sync)
- On **login**: all user sessions are pulled from MongoDB → written to `backend/json_cache/{user_id}.json`
- **Real-time**: every session save updates this JSON file instantly
- **Frontend** polls `/sessions/cache` every 5 seconds — reads from JSON (fast), not MongoDB
- **WebSocket** at `/ws/{user_id}` syncs timer state across tabs/devices

---

## Setup

### 1. MongoDB
```bash
# Start MongoDB (Docker)
docker run -d -p 27017:27017 --name mongo mongo:7
```

### 2. Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:3000

---

## Features

| Feature | Details |
|---|---|
| Auth | Register / Login with JWT (24h tokens) |
| Timer | Start / Pause / Stop with animated ring |
| Session length | Customizable (5–180 min), quick chips: 25/45/60/90/120 min |
| Subjects | 10 subjects to label sessions |
| Auto-save | Sessions saved to MongoDB + JSON cache on stop/complete |
| Weekly report | Bar chart + stats (total hours, sessions, daily avg, best day) |
| History | Last 8 sessions with subject, duration, timestamp |
| Real-time sync | JSON cache polled every 5s — fixes stale timetable issue |
| WebSocket | Cross-tab timer sync |
| Mobile responsive | Works on all screen sizes |

---

## API Routes

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Login → loads JSON cache |
| GET | `/sessions/cache` | Get cached user data (JSON layer) |
| POST | `/sessions` | Save session to DB + cache |
| GET | `/sessions/weekly-report` | Weekly bar chart data |
| PUT | `/settings` | Update session length |
| WS | `/ws/{user_id}` | Real-time timer sync |

---

## Environment Variables (backend)

```env
MONGO_URL=mongodb://localhost:27017
SECRET_KEY=your-super-secret-key-here
```
