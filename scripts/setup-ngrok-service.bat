@echo off
echo ===================================================
echo   Ngrok Automatic Background Startup Service Setup
echo ===================================================

set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SCRIPT_DIR=%~dp0

REM Copy start-ngrok.vbs to Windows Startup folder
if exist "%SCRIPT_DIR%start-ngrok.vbs" (
    copy /Y "%SCRIPT_DIR%start-ngrok.vbs" "%STARTUP_FOLDER%\start-ngrok.vbs"
    echo [SUCCESS] Copied start-ngrok.vbs to Windows Startup folder.
) else (
    echo Set WshShell = CreateObject("WScript.Shell") > "%STARTUP_FOLDER%\start-ngrok.vbs"
    echo WshShell.Run "cmd /c ngrok http --url=wreath-paddling-precook.ngrok-free.dev 8080", 0, False >> "%STARTUP_FOLDER%\start-ngrok.vbs"
    echo [SUCCESS] Created start-ngrok.vbs in Startup folder.
)

REM Check if native Ngrok service configuration exists
set NGROK_CONFIG=%USERPROFILE%\AppData\Local\ngrok\ngrok.yml
if exist "%NGROK_CONFIG%" (
    echo Installing native Ngrok Windows Service...
    ngrok service install --config="%NGROK_CONFIG%"
    ngrok service start
)

echo ===================================================
echo [COMPLETE] Ngrok is now configured to start silently in the background on Windows boot.
echo ===================================================
