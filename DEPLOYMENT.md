# PRISM — Deployment Guide

This guide covers deploying **PRISM** (*Prescription Recognition and Intelligent Safety for Medication*) across cloud platforms, containerized environments, and standalone servers.

PRISM has two decoupled components:
- **Backend API**: Python 3.11 + FastAPI + PyTorch/TrOCR + Groq Vision API
- **Frontend App**: Next.js 14 + Tailwind CSS + TypeScript

---

## 🚀 Recommended Cloud Deployment (Free / Serverless)

The easiest and most cost-effective production deployment:
- **Frontend**: [Vercel](https://vercel.com) (Free global CDN & edge hosting)
- **Backend**: [Render](https://render.com) or [Railway](https://railway.app) (Free / Hobby tier)

---

### Step 1: Deploy Backend (Render / Railway)

#### Deploying on Render (Web Service):
1. Go to [render.com](https://render.com) and click **New → Web Service**.
2. Connect your GitHub repository: `https://github.com/Srinath-Y-dev/PRISM.git`.
3. Configure the service:
   - **Name**: `prism-backend`
   - **Root Directory**: `backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Plan**: Starter / Standard (At least 1GB–2GB RAM recommended for TrOCR)
4. Add **Environment Variables**:
   ```ini
   GROQ_API_KEY=your_groq_api_key_here
   GROQ_MODEL=qwen/qwen3.8-27b
   GROQ_VISION_MODEL=qwen/qwen3.8-27b
   DATABASE_URL=sqlite:///./prescriptions.db
   TROCR_MODEL=microsoft/trocr-large-handwritten
   ```
5. Click **Create Web Service**. Once deployed, copy your backend URL (e.g. `https://prism-backend.onrender.com`).

---

### Step 2: Deploy Frontend (Vercel)

1. Go to [vercel.com](https://vercel.com) and click **Add New... → Project**.
2. Import `https://github.com/Srinath-Y-dev/PRISM.git`.
3. Configure project settings:
   - **Framework Preset**: `Next.js`
   - **Root Directory**: Click *Edit* and select `frontend`
4. Add **Environment Variable**:
   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://prism-backend.onrender.com` (Your backend URL from Step 1) |
5. Click **Deploy**. Vercel will build and serve your app globally on an SSL domain (`https://prism.vercel.app`).

---

## 🐳 Containerized Deployment (Docker & Docker Compose)

To run the complete PRISM stack locally or on any cloud VPS (AWS EC2, DigitalOcean, Hetzner, Linode):

### 1. Clone & Set Environment
```bash
git clone https://github.com/Srinath-Y-dev/PRISM.git
cd PRISM

# Set your Groq API key
export GROQ_API_KEY="your_groq_api_key_here"  # On Windows: set GROQ_API_KEY=your_key
```

### 2. Build & Launch
```bash
docker-compose up --build -d
```

### 3. Verify
- **Frontend**: `http://localhost:3000`
- **Backend API & Swagger Docs**: `http://localhost:8000/docs`
- **Health Check**: `http://localhost:8000/health`

---

## 🤗 Hugging Face Spaces (Free GPU Option)

For hardware-accelerated TrOCR inference on a free T4 GPU:

1. Create a new Space at [huggingface.co/new-space](https://huggingface.co/new-space).
2. Choose **Gradio** SDK.
3. Push the contents of the `backend/` directory to the Space repository.
4. Go to **Settings → Variables and Secrets** and add:
   - `GROQ_API_KEY`: Your Groq API key
   - `GROQ_MODEL`: `qwen/qwen3.8-27b`
5. The Space will automatically run `app.py` and provide a public Gradio demo URL.

---

## 🐧 Linux VPS Production Setup (Ubuntu / Debian + Nginx)

If deploying directly on an Ubuntu/Debian server:

### 1. System Packages
```bash
sudo apt update && sudo apt install -y python3.11 python3.11-venv nodejs npm nginx libgl1
```

### 2. Backend Service (Systemd)
Create `/etc/systemd/system/prism-backend.service`:
```ini
[Unit]
Description=PRISM FastAPI Backend
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/PRISM/backend
Environment="PATH=/home/ubuntu/PRISM/backend/.venv/bin"
EnvironmentFile=/home/ubuntu/PRISM/backend/.env
ExecStart=/home/ubuntu/PRISM/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```
Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now prism-backend
```

### 3. Frontend Service (PM2)
```bash
cd /home/ubuntu/PRISM/frontend
npm install
npm run build
sudo npm install -g pm2
pm2 start npm --name "prism-frontend" -- start
pm2 save
pm2 startup
```

### 4. Nginx Reverse Proxy
```nginx
server {
    server_name your-domain.com;

    # Frontend
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 15M;
    }
}
```

---

## ⚙️ Environment Variables Reference

### Backend (`backend/.env`)
| Variable | Required | Default / Recommended | Purpose |
|---|---|---|---|
| `GROQ_API_KEY` | **Yes** | — | Groq Cloud API authentication |
| `GROQ_MODEL` | No | `qwen/qwen3.8-27b` | Primary multimodal vision model |
| `GROQ_VISION_MODEL`| No | `qwen/qwen3.8-27b` | Vision chat completion model |
| `TROCR_MODEL` | No | `microsoft/trocr-large-handwritten` | Hugging Face model identifier for OCR |
| `DATABASE_URL` | No | `sqlite:///./prescriptions.db` | Storage for audit records & stats |
| `OPENFDA_BASE` | No | `https://api.fda.gov/drug/label.json` | OpenFDA API endpoint |

### Frontend (`frontend/.env.local`)
| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | **Yes (in prod)**| `http://localhost:8000` | Points frontend fetch requests to backend |