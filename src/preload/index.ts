/**
 * Preload — Main process IPC를 안전하게 renderer로 노출.
 * contextIsolation: true 이므로 contextBridge로 좁은 API만 공개.
 */
import { contextBridge, ipcRenderer } from 'electron'

type CameraStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

const api = {
  /** click-through 마우스 통과 설정 (캘리브레이션 시 false로 토글) */
  setClickThrough: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('glanceshift:set-click-through', enabled),

  /** macOS 카메라 권한 상태 조회 */
  getCameraPermission: (): Promise<CameraStatus> =>
    ipcRenderer.invoke('glanceshift:get-camera-permission'),

  /** macOS 카메라 권한 요청 */
  requestCameraPermission: (): Promise<boolean> =>
    ipcRenderer.invoke('glanceshift:request-camera-permission'),

  /** OS 볼륨 설정 (0..1). 실패 시 null. */
  setVolume: (value: number): Promise<number | null> =>
    ipcRenderer.invoke('glanceshift:set-volume', value),

  /** 현재 OS 볼륨 (0..1). 읽기 실패 시 null. */
  getVolume: (): Promise<number | null> =>
    ipcRenderer.invoke('glanceshift:get-volume'),

  /** OS 밝기 설정 (0..1, macOS 는 brightness CLI 필요). 실패 시 null. */
  setBrightness: (value: number): Promise<number | null> =>
    ipcRenderer.invoke('glanceshift:set-brightness', value),

  /** 현재 OS 밝기 (0..1). 읽기 실패 시 null. */
  getBrightness: (): Promise<number | null> =>
    ipcRenderer.invoke('glanceshift:get-brightness'),

  /** main → renderer 이벤트 구독 */
  onToggleDebug: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('glanceshift:toggle-debug', listener)
    return () => ipcRenderer.removeListener('glanceshift:toggle-debug', listener)
  },

  onClickThroughChange: (cb: (enabled: boolean) => void): (() => void) => {
    const listener = (_e: unknown, enabled: boolean): void => cb(enabled)
    ipcRenderer.on('glanceshift:click-through', listener)
    return () => ipcRenderer.removeListener('glanceshift:click-through', listener)
  },

  onToggleCalibration: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('glanceshift:toggle-calibration', listener)
    return () => ipcRenderer.removeListener('glanceshift:toggle-calibration', listener)
  }
}

contextBridge.exposeInMainWorld('glanceshift', api)

export type GlanceShiftAPI = typeof api
