@echo off
REM Thin double-clickable wrapper around package-usb.ps1.
REM Usage: package-usb.bat E:\
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0package-usb.ps1" -UsbDrivePath %1
