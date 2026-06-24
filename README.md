# GlanceShift Tobii Pilot

GlanceShift is an Electron and React pilot experiment for hands-busy interruption control. This version uses Tobii Eye Tracker 5 gaze and head-pose input to compare a keyboard menu baseline with a gaze-and-head-tilt GlanceShift interaction.

## Requirements

- Windows 10 or later
- Tobii Eye Tracker 5 installed and calibrated with Tobii's app
- Tobii Game Integration API SDK, installed locally and not committed to this repository
- Node.js LTS and npm
- Visual Studio Build Tools with `Desktop development with C++`

## Quick Start

```powershell
git clone https://github.com/ThisIsSimple/glanceshift.git
cd glanceshift
npm install

$env:TOBII_TGI_SDK_DIR="C:\path\to\TobiiGameIntegrationAPI"
npm run build:tobii
npm run dev
```

The app starts in the pilot lobby. Use `Prepare audio`, then choose `Full pilot` or one of the practice modes.

## Tobii Bridge

The native helper is built from `tools/tobii-bridge/` and written to `tools/tobii-bridge/bin/tobii-bridge.exe`. The SDK and built binaries are local-machine artifacts and are intentionally ignored.

If the helper is built elsewhere, set:

```powershell
$env:GLANCESHIFT_TOBII_BRIDGE="C:\path\to\tobii-bridge.exe"
```

More setup details are in [TOBII_DEMO_CONTEXT.md](TOBII_DEMO_CONTEXT.md).

## Logs

Pilot CSV files are saved under the project folder by default:

```text
.\eval-logs\
```

Override the destination before launch with:

```powershell
$env:GLANCESHIFT_EVAL_LOG_DIR="D:\GlanceShiftLogs"
npm run dev
```

## Repository Hygiene

The repository excludes local research context, participant logs, Tobii SDK files, native build outputs, and generated recordings. Do not commit `context/`, `eval-logs/`, SDK folders, or built helper binaries.