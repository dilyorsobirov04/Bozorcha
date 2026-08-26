Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c ngrok http --url=wreath-paddling-precook.ngrok-free.dev 8080", 0, False
