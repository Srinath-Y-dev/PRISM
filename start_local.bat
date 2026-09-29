@echo off
REM PrescriptionReader Local Dev (Without Docker)
echo 🏥 Starting PrescriptionReader Locally...
echo ========================================

if not exist ".venv" (
    echo ❌ Virtual environment .venv not found. Please run setup.bat first.
    pause
    exit /b 1
)

if not exist "backend\.env" (
    copy "backend\.env.example" "backend\.env"
    echo 📝 Created backend\.env - remember to set your GROQ_API_KEY.
)

echo 🚀 Launching Backend API on http://localhost:8000 ...
start "PrescriptionReader Backend" cmd /k "call .venv\Scripts\activate && cd backend && uvicorn main:app --reload --port 8000"

echo 🚀 Launching Frontend on http://localhost:3000 ...
start "PrescriptionReader Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo ✨ Services are starting up!
echo 📱 Frontend: http://localhost:3000
echo 🔧 Backend API: http://localhost:8000
echo 📊 API Docs: http://localhost:8000/docs
echo.
pause
