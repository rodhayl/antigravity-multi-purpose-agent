@echo off
SETLOCAL EnableExtensions EnableDelayedExpansion

echo ========================================================
echo   Auto Accept Agent - Safe Process Cleaner
echo ========================================================
echo.

:: Use PowerShell to identify and kill specific Node processes
:: Filters:
::  1. Process Name must be "node.exe"
::  2. MUST contain one of: "live_cdp_debug.js", "debug-handler.js", or the project path "auto-accept-agent"
::  3. MUST NOT contain: "extensionHost" (VS Code internal), "renderer" (Electron), or "vads" (just in case)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$targetProcs = Get-CimInstance Win32_Process | Where-Object { "^
    "    $_.Name -eq 'node.exe' -and "^
    "    ( "^
    "        $_.CommandLine -like '*live_cdp_debug.js*' -or "^
    "        $_.CommandLine -like '*debug-handler.js*' -or "^
    "        $_.CommandLine -like '*auto-accept-agent*' "^
    "    ) -and "^
    "    $_.CommandLine -notlike '*extensionHost*' -and "^
    "    $_.CommandLine -notlike '*--type=*' "^
    "}; "^
    "if ($targetProcs) { "^
    "    Write-Host 'Found' $targetProcs.Count 'related processes.'; "^
    "    foreach ($p in $targetProcs) { "^
    "        Write-Host '   - Killing PID:' $p.ProcessId 'Cmd:' $p.CommandLine.Substring(0, [math]::Min(60, $p.CommandLine.Length))... -ForegroundColor Yellow; "^
    "        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; "^
    "    } "^
    "    Write-Host 'Done.' -ForegroundColor Green; "^
    "} else { "^
    "    Write-Host 'No lingering Auto-Accept processes found.' -ForegroundColor Green; "^
    "}"

echo.
echo Operation Complete.
pause
