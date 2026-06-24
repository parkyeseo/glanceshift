# Tobii Setup Guide

This guide is for running GlanceShift with Tobii Eye Tracker 5 on a Windows demo machine.

## Machine Setup

1. Install Tobii Eye Tracker 5 runtime and calibrate the device in Tobii's app.
2. Install Node.js LTS and Visual Studio Build Tools with `Desktop development with C++`.
3. Download the Tobii Game Integration API SDK from Tobii and keep it outside the repository.
4. Install dependencies from the repository root:

```powershell
npm install
```

## Build The Native Bridge

Point `TOBII_TGI_SDK_DIR` at the SDK root and build:

```powershell
$env:TOBII_TGI_SDK_DIR="C:\path\to\TobiiGameIntegrationAPI"
npm run build:tobii
```

Expected output:

```text
tools\tobii-bridge\bin\tobii-bridge.exe
```

## Run

```powershell
npm run dev
```

Useful shortcuts:

- `Ctrl+Shift+E`: return to the pilot lobby
- `Ctrl+Shift+D`: toggle the gaze pointer for debugging
- `Ctrl+Shift+I`: open DevTools
- `Ctrl+Shift+Q`: quit

## Runtime Behavior

- When the bridge is ready, the renderer receives Tobii gaze coordinates plus yaw, pitch, and roll.
- If the bridge is missing or fails, the app reports a Tobii error and keeps mouse fallback available for local debugging.
- Pilot CSV files are written to `eval-logs/` unless `GLANCESHIFT_EVAL_LOG_DIR` is set.

## Troubleshooting

- Confirm Tobii's app sees and calibrates the device before launching GlanceShift.
- Rebuild with `npm run build:tobii` after changing SDK location or native helper code.
- If the helper is outside the default path, set `GLANCESHIFT_TOBII_BRIDGE` to the executable path.
- Close other apps that may be using the Tobii device.