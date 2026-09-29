@echo off
echo 🏥 PrescriptionReader Setup Script
echo ==================================

REM Check if we're in the right directory
if not exist "docker-compose.yml" (
    echo ❌ Please run this script from the prescription-reader root directory
    pause
    exit /b 1
)

echo 📦 Setting up Python virtual environment and backend dependencies...
if not exist ".venv" (
    where uv >nul 2>&1
    if not errorlevel 1 (
        uv venv --python 3.11 .venv
    ) else (
        python -m venv .venv
    )
)

if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
    python -m pip install --upgrade pip
    pip install -r backend\requirements.txt
) else (
    cd backend
    python -m pip install --upgrade pip
    pip install -r requirements.txt
    cd ..
)

echo 📦 Installing frontend dependencies...
cd frontend
call npm install
cd ..

echo ⚙️  Setting up environment...
if not exist "backend\.env" (
    copy "backend\.env.example" "backend\.env"
    echo 📝 Created backend\.env - please add your GROQ_API_KEY
)

echo 🧪 Running setup verification...
if exist ".venv\Scripts\python.exe" (
    .venv\Scripts\python.exe test_setup.py
) else (
    python test_setup.py
)

echo.
echo ✅ Setup complete!
echo.
echo Next steps:
echo 1. Add your GROQ_API_KEY to backend\.env
echo 2. Run: docker-compose up --build
echo 3. Open: http://localhost:3000
pause