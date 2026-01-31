@echo off
echo Building Auto Accept Agent 1.0.0...

echo Installing dependencies...
REM Ensure devDependencies install (build requires esbuild)
set NODE_ENV=
set npm_config_production=

if exist package-lock.json (
  call npm ci
) else (
  call npm install
)
if %errorlevel% neq 0 exit /b %errorlevel%

echo Compiling extension...
call npm run compile
if %errorlevel% neq 0 exit /b %errorlevel%

echo Packaging VSIX...
set GIT_PAGER=
set PAGER=
set LESS=
call npx vsce package --no-git-tag-version
if %errorlevel% neq 0 exit /b %errorlevel%

echo Build complete!
