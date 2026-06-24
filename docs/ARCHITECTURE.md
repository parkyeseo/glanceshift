# GlanceShift Architecture

GlanceShift is an Electron overlay that runs a Tobii-based pilot experiment. The current public build focuses on the pilot workflow rather than the earlier webcam/WebGazer prototype.

## Processes

- `src/main/index.ts`: creates the transparent always-on-top Electron window, registers global shortcuts, exposes IPC handlers, saves CSV logs, and starts or stops the Tobii bridge.
- `src/preload/index.ts`: exposes a narrow `window.glanceshift` API through `contextBridge` with context isolation enabled.
- `src/renderer/src/**`: React renderer for the pilot lobby, runner task, mixer overlay, gaze/head input, and interaction state.
- `tools/tobii-bridge/**`: native Windows helper that reads Tobii Game Integration API samples and streams newline-delimited JSON to Electron.

## Input Pipeline

1. The main process launches `tools/tobii-bridge/bin/tobii-bridge.exe` with the overlay window handle.
2. The helper tracks the overlay rectangle and emits gaze coordinates plus head yaw, pitch, and roll.
3. `src/main/tobii-bridge.ts` normalizes helper messages and sends them to the renderer.
4. `src/renderer/src/perception/tobii.ts` maps Tobii samples into the renderer tracker types.
5. `PilotExperiment.tsx` uses gaze for edge target selection and head roll for continuous volume adjustment.

Mouse fallback remains available for local debugging when Tobii is not ready. It is not the intended experiment input path.

## Pilot Flow

The pilot compares two within-subject conditions:

- `mouse-menu`: keyboard-driven menu baseline.
- `glanceshift`: bottom-edge gaze selection with head-tilt adjustment.

The runner task, obstacle sequence, prompts, and output schema live in `src/renderer/src/experiment/`.

## Data Output

CSV logs are saved through the main process to `eval-logs/` by default, or to `GLANCESHIFT_EVAL_LOG_DIR` when set. Local logs are ignored by git.

## Native Build Artifacts

Tobii SDK files and compiled helper binaries are not committed. Build outputs stay under `tools/tobii-bridge/bin/`, which is ignored.