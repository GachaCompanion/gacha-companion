const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readStorage: () => ipcRenderer.invoke('storage:read'),
  writeStorage: (data) => ipcRenderer.invoke('storage:write', data),

  getSystemTheme: () => ipcRenderer.invoke('theme:get-system'),
  onSystemThemeChange: (cb) => {
    const handler = (_, theme) => cb(theme);
    ipcRenderer.on('theme:system-changed', handler);
    return () => ipcRenderer.removeListener('theme:system-changed', handler);
  },

  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  moveWindowBy: (dx, dy) => ipcRenderer.send('window:move-by', dx, dy),

  getLoginItem: () => ipcRenderer.invoke('loginItem:get'),
  setLoginItem: (enabled) => ipcRenderer.invoke('loginItem:set', enabled),

  saveBackground: (data) => ipcRenderer.invoke('background:save', data),
  readBackground: (filename) => ipcRenderer.invoke('background:read', filename),
  getBackgroundInfo: (filename) => ipcRenderer.invoke('background:info', filename),
  hashBackground: (filename) => ipcRenderer.invoke('background:hash', filename),
  deleteBackground: (filename) => ipcRenderer.invoke('background:delete', filename),
  listBackgrounds: () => ipcRenderer.invoke('background:list'),
  getBgServerPort: () => ipcRenderer.invoke('background:server-port'),
  getFontsServerPort: () => ipcRenderer.invoke('fonts:server-port'),
  notifyReady: () => ipcRenderer.send('app:ready'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  fetchGenshinBanners: () => ipcRenderer.invoke('genshin:fetchBanners'),
  getGenshinBannerImageById: (id) => ipcRenderer.invoke('genshin:getBannerImageById', { id }),

  readGenshinLog: () => ipcRenderer.invoke('gacha:readGenshinLog'),
  fetchWishHistory: (url, gachaType, cutoffTime, extraParams) => ipcRenderer.invoke('gacha:fetchWishHistory', { url, gachaType, cutoffTime, extraParams }),
  cancelFetch: (requestId) => ipcRenderer.invoke('gacha:cancelFetch', { requestId }),
  parsePaimonMoe: (jsonText, existingLog) => ipcRenderer.invoke('gacha:parsePaimonMoe', { jsonText, existingLog }),
  parseExcelMoe: (buffer, existingLog) => ipcRenderer.invoke('gacha:parseExcelMoe', { buffer, existingLog }),
  detectMismatch: (jsonLog, excelLog) => ipcRenderer.invoke('gacha:detectMismatch', { jsonLog, excelLog }),
  mergeJsonIntoExcel: (jsonLog, excelLog) => ipcRenderer.invoke('gacha:mergeJsonIntoExcel', { jsonLog, excelLog }),
  exportGenshinHistory: (pullLog, serverOffset) => ipcRenderer.invoke('genshin:exportHistory', { pullLog, serverOffset }),

  parseHsrExcel: (buffer) => ipcRenderer.invoke('hsr:parseExcel', { buffer }),
  exportHsrDatBackup: (pullLog, serverOffset, baseBuffer) => ipcRenderer.invoke('hsr:exportDatBackup', { pullLog, serverOffset, baseBuffer }),
  exportZzzRngMoeBackup: (pullLog, uid) => ipcRenderer.invoke('zzz:exportRngMoeBackup', { pullLog, uid }),
  exportWuwaTrackerBackup: (pullLog, uid) => ipcRenderer.invoke('wuwa:exportWuwaTrackerBackup', { pullLog, uid }),
  fetchHsrBanners: () => ipcRenderer.invoke('hsr:fetchBanners'),
  getHsrBannerImage: (id) => ipcRenderer.invoke('hsr:getBannerImage', { id }),
  readHsrLog: () => ipcRenderer.invoke('hsr:readLog'),
  readZzzLog: () => ipcRenderer.invoke('zzz:readLog'),
  fetchZzzBanners: () => ipcRenderer.invoke('zzz:fetchBanners'),
  getZzzBannerImage: (id) => ipcRenderer.invoke('zzz:getBannerImage', { id }),

  readWuwaLog: () => ipcRenderer.invoke('wuwa:readLog'),
  fetchWuwaGachaLog: (url, cardPoolType) => ipcRenderer.invoke('wuwa:fetchGachaLog', { url, cardPoolType }),
  fetchWuwaBanners: () => ipcRenderer.invoke('wuwa:fetchBanners'),
  getWuwaBannerImage: (id) => ipcRenderer.invoke('wuwa:getBannerImage', { id }),

  fetchNteBanners: () => ipcRenderer.invoke('nte:fetchBanners'),
  getNteBannerImage: (id) => ipcRenderer.invoke('nte:getBannerImage', { id }),
  fetchNteRosterImageIds: () => ipcRenderer.invoke('nte:fetchRosterImageIds'),

  fetchEnkaUid:    (uid) => ipcRenderer.invoke('showcase:fetchEnkaUid', { uid }),
  fetchEnka:       (uid, game) => ipcRenderer.invoke('showcase:fetchEnka', { uid, game }),
  fetchHsrBuilds:  (uid) => ipcRenderer.invoke('showcase:fetchHsrBuilds', { uid }),
  fetchImageB64:   (url) => ipcRenderer.invoke('showcase:fetchImageB64', { url }),

  saveIcon: (gameId, dataUrl, gameName) => ipcRenderer.invoke('icon:save', { gameId, dataUrl, gameName }),
  readIcon: (filename)       => ipcRenderer.invoke('icon:read', filename),
  deleteIcon: (filename)     => ipcRenderer.invoke('icon:delete', filename),

  ensureLive2d:        (game, characterId) => ipcRenderer.invoke('live2d:ensure', { game, characterId }),
  getLive2dServerPort: () => ipcRenderer.invoke('live2d:server-port'),
  listManifestLive2d:  (game) => ipcRenderer.invoke('live2d:list-manifest', { game }),
  listLocalLive2d:     (game) => ipcRenderer.invoke('live2d:list-local', { game }),
  clearFramingLive2d:  (game, id) => ipcRenderer.invoke('live2d:clear-framing', { game, id }),
  ensureCharImage:          (game, avatarId)          => ipcRenderer.invoke('showcase:ensure-char-image', { game, avatarId }),
  ensureCharIcon:           (game, avatarId, iconUrl) => ipcRenderer.invoke('showcase:ensure-char-icon',  { game, avatarId, iconUrl }),
  getPngFraming:            (game, avatarId)          => ipcRenderer.invoke('showcase:get-png-framing',   { game, avatarId }),
  getAllPngFraming:         (game)                    => ipcRenderer.invoke('showcase:get-png-framing-all', { game }),
  getShowcasesServerPort:   () => ipcRenderer.invoke('showcases:server-port'),

  uidExists:      (linkedDatabase, uid) => ipcRenderer.invoke('game:uidExists',  { linkedDatabase, uid }),
  readGameState:  (linkedDatabase, uid) => ipcRenderer.invoke('game:readState',  { linkedDatabase, uid }),
  writeGameState: (linkedDatabase, uid, state)  => ipcRenderer.invoke('game:writeState',  { linkedDatabase, uid, state }),
  clearUidState:   (linkedDatabase, uid) => ipcRenderer.invoke('game:clearUidState', { linkedDatabase, uid }),
  clearPullHistory: (linkedDatabase, uid) => ipcRenderer.invoke('game:clearPullHistory', { linkedDatabase, uid }),

  onFetchProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('gacha:fetchProgress', handler);
    return () => ipcRenderer.removeListener('gacha:fetchProgress', handler);
  },

  listProfiles:   ()               => ipcRenderer.invoke('profiles:list'),
  createProfile:  (name)           => ipcRenderer.invoke('profiles:create', name),
  renameProfile:  (id, name)       => ipcRenderer.invoke('profiles:rename', { id, name }),
  deleteProfile:  (id)             => ipcRenderer.invoke('profiles:delete', id),
  switchProfile:  (id)             => ipcRenderer.invoke('profiles:switch', id),

  exportProfile:      (id)      => ipcRenderer.invoke('profiles:export', id),
  inspectImportZip:   (zipPath) => ipcRenderer.invoke('profiles:inspect-import', zipPath),
  importProfile:      (payload) => ipcRenderer.invoke('profiles:import', payload),

  nteFindCaptureWindow: () => ipcRenderer.invoke('nte:capture:findWindow'),
  nteStartCapture:      (uid, overlayEnabled, calibration) => ipcRenderer.send('nte:capture:start', { uid, overlayEnabled, calibration }),
  nteCancelCapture:     () => ipcRenderer.send('nte:capture:cancel'),
  onNteCaptureStatus: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('nte:capture:status', handler);
    return () => ipcRenderer.removeListener('nte:capture:status', handler);
  },
  onNteCaptureProgress: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('nte:capture:progress', handler);
    return () => ipcRenderer.removeListener('nte:capture:progress', handler);
  },

  nteElevatedSetupStatus:     () => ipcRenderer.invoke('nte:elevatedSetup:status'),
  nteElevatedSetupRegister:   () => ipcRenderer.invoke('nte:elevatedSetup:register'),
  nteElevatedSetupUnregister: () => ipcRenderer.invoke('nte:elevatedSetup:unregister'),

  nteStartCalibrate:  (pointId) => ipcRenderer.send('nte:calibrate:start', { pointId }),
  nteCancelCalibrate: () => ipcRenderer.send('nte:calibrate:cancel'),
  onNteCalibrateStatus: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('nte:calibrate:status', handler);
    return () => ipcRenderer.removeListener('nte:calibrate:status', handler);
  },

});
