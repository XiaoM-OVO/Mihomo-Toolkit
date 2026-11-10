@echo off
rem Root launcher: same as node src\targets\cli.js, no global install needed.
node "%~dp0src\targets\cli.js" %*
