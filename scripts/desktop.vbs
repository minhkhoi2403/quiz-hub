Option Explicit
Dim shell, fso, scriptPath, action
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "desktop.ps1")
action = "start"
If WScript.Arguments.Count > 0 Then
    If WScript.Arguments(0) = "stop" Then action = "stop"
End If
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """ -Action " & action, 0, False
