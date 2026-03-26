"""
StudyFlow Backend — FastAPI + MongoDB + JSON Cache Layer
Run: uvicorn main:app --reload --port 8000
"""

from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from motor.motor_asyncio import AsyncIOMotorClient
import bcrypt
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional, List
import json, os, asyncio, uuid

app = FastAPI(title="StudyFlow API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Config ──────────────────────────────────────────────────────────
MONGO_URL    = os.getenv("MONGO_URL", "mongodb://localhost:27017")
SECRET_KEY   = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM    = "HS256"
TOKEN_EXPIRE = 60 * 24  # 24 hours in minutes
CACHE_DIR    = "./json_cache"
os.makedirs(CACHE_DIR, exist_ok=True)

# ── DB ───────────────────────────────────────────────────────────────
client = AsyncIOMotorClient(MONGO_URL)
db = client.studyflow
users_col    = db.users
sessions_col = db.sessions

# ── Security ─────────────────────────────────────────────────────────
oauth2  = OAuth2PasswordBearer(tokenUrl="/auth/login")

def hash_password(p): return bcrypt.hashpw(p.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
def verify_password(plain, hashed): return bcrypt.checkpw(plain.encode('utf-8'), hashed.encode('utf-8'))

def create_token(data: dict):
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(minutes=TOKEN_EXPIRE)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(token: str = Depends(oauth2)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await users_col.find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ── JSON Cache Layer ──────────────────────────────────────────────────
def cache_path(user_id: str) -> str:
    return os.path.join(CACHE_DIR, f"{user_id}.json")

async def load_to_cache(user_id: str):
    """On login: pull all user sessions from MongoDB into a local JSON file."""
    sessions = await sessions_col.find({"user_id": user_id}).to_list(length=1000)
    for s in sessions:
        s["_id"] = str(s["_id"])
    user = await users_col.find_one({"_id": user_id})
    cache = {
        "user_id": user_id,
        "name": user.get("name", ""),
        "session_length": user.get("session_length", 60),
        "sessions": sessions,
        "last_updated": datetime.utcnow().isoformat(),
    }
    with open(cache_path(user_id), "w") as f:
        json.dump(cache, f, default=str)
    return cache

async def update_cache_session(user_id: str, session: dict):
    """Real-time: append or update a session in the JSON cache."""
    path = cache_path(user_id)
    if not os.path.exists(path):
        await load_to_cache(user_id)
        return
    with open(path) as f:
        cache = json.load(f)
    # upsert by session_id
    existing = next((i for i, s in enumerate(cache["sessions"]) if s.get("session_id") == session.get("session_id")), None)
    if existing is not None:
        cache["sessions"][existing] = session
    else:
        cache["sessions"].append(session)
    cache["last_updated"] = datetime.utcnow().isoformat()
    with open(path, "w") as f:
        json.dump(cache, f, default=str)

def read_cache(user_id: str):
    path = cache_path(user_id)
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)

# ── Schemas ───────────────────────────────────────────────────────────
class RegisterBody(BaseModel):
    name: str
    email: EmailStr
    password: str

class SessionBody(BaseModel):
    session_id: str
    duration_minutes: int
    completed: bool
    stopped_early: bool
    subject: Optional[str] = "Bio"
    started_at: str
    ended_at: str

class SettingsBody(BaseModel):
    session_length: int  # minutes

# ── Auth Routes ───────────────────────────────────────────────────────
@app.post("/api/auth/register")
async def register(body: RegisterBody):
    if await users_col.find_one({"email": body.email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    await users_col.insert_one({
        "_id": user_id,
        "name": body.name,
        "email": body.email,
        "password": hash_password(body.password),
        "session_length": 60,
        "created_at": datetime.utcnow().isoformat(),
    })
    token = create_token({"sub": user_id})
    await load_to_cache(user_id)
    return {"token": token, "name": body.name, "session_length": 60}

@app.post("/api/auth/login")
async def login(form: OAuth2PasswordRequestForm = Depends()):
    user = await users_col.find_one({"email": form.username})
    if not user or not verify_password(form.password, user["password"]):
        raise HTTPException(status_code=400, detail="Invalid credentials")
    token = create_token({"sub": user["_id"]})
    # Load fresh data into JSON cache on every login
    cache = await load_to_cache(user["_id"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "name": user["name"],
        "session_length": user.get("session_length", 60),
        "cache": cache,
    }

# ── Session Routes ─────────────────────────────────────────────────────
@app.post("/api/sessions")
async def save_session(body: SessionBody, user=Depends(get_current_user)):
    session_doc = {
        "session_id": body.session_id,
        "user_id": user["_id"],
        "duration_minutes": body.duration_minutes,
        "completed": body.completed,
        "stopped_early": body.stopped_early,
        "subject": body.subject,
        "started_at": body.started_at,
        "ended_at": body.ended_at,
    }
    # Upsert in MongoDB
    await sessions_col.update_one(
        {"session_id": body.session_id},
        {"$set": session_doc},
        upsert=True
    )
    # Real-time update in JSON cache
    await update_cache_session(user["_id"], session_doc)
    return {"status": "saved"}

@app.get("/api/sessions/cache")
async def get_cache(user=Depends(get_current_user)):
    """Frontend polls this for real-time data from JSON layer."""
    cache = read_cache(user["_id"])
    if not cache:
        cache = await load_to_cache(user["_id"])
    return cache

@app.get("/api/sessions/weekly-report")
async def weekly_report(user=Depends(get_current_user)):
    cache = read_cache(user["_id"])
    if not cache:
        cache = await load_to_cache(user["_id"])
    sessions = cache.get("sessions", [])
    # Last 7 days
    now = datetime.utcnow()
    report = {}
    for i in range(6, -1, -1):
        day = (now - timedelta(days=i)).strftime("%a")
        report[day] = {"minutes": 0, "sessions": 0}
    for s in sessions:
        try:
            ended = datetime.fromisoformat(s["ended_at"].replace("Z",""))
            days_ago = (now - ended).days
            if 0 <= days_ago < 7:
                day_key = ended.strftime("%a")
                if day_key in report:
                    report[day_key]["minutes"] += s.get("duration_minutes", 0)
                    report[day_key]["sessions"] += 1
        except Exception:
            pass
    return {"weekly": report, "total_minutes": sum(d["minutes"] for d in report.values())}

@app.put("/api/settings")
async def update_settings(body: SettingsBody, user=Depends(get_current_user)):
    await users_col.update_one(
        {"_id": user["_id"]},
        {"$set": {"session_length": body.session_length}}
    )
    # Update cache too
    path = cache_path(user["_id"])
    if os.path.exists(path):
        with open(path) as f:
            cache = json.load(f)
        cache["session_length"] = body.session_length
        with open(path, "w") as f:
            json.dump(cache, f)
    return {"status": "updated"}

# ── WebSocket for real-time timer broadcast ───────────────────────────
active_connections: dict[str, list[WebSocket]] = {}

@app.websocket("/api/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await websocket.accept()
    active_connections.setdefault(user_id, []).append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Broadcast timer state to all tabs/devices of this user
            for ws in active_connections.get(user_id, []):
                if ws != websocket:
                    await ws.send_text(data)
    except WebSocketDisconnect:
        active_connections[user_id].remove(websocket)
