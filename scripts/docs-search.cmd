@echo off
setlocal
node "%~dp0docs-search.mjs" %*
exit /b %ERRORLEVEL%
