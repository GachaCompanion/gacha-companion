import React, { useRef } from 'react';
import TitleBar from '../../shared/components/TitleBar';
import GameDashboard from './components/GameDashboard';
import AddGameModal from './components/AddGameModal';
import EditGameModal from './components/EditGameModal';
import EmptyState from './components/EmptyState';
import ConfirmDialog from '../../shared/components/ConfirmDialog';
import GameSettingsModal from './components/GameSettingsModal';
import { useSyncRouter } from './useSyncRouter';

// Main content only — the sidebar is now a single persistent instance
// mounted once in App.js (see shared/components/sidebar/), shared with
// Showcase so switching between them never unmounts it. `tracker` is
// useTrackerState()'s return value, now owned by App.js (hoisted so
// Sidebar can read games/selection from the same instance) and passed
// down here as a prop.
export default function GachaTracker({
  revealed,
  tracker,
  data,
  bannerDataRef,
  bannerSchedules,
  bannerPanelWidths,
  gameBgUrl,
  nteOverlayEnabled,
  nteCalibration,
  onNteCalibrationChange,
}) {
  // Always mirrors the latest games array, assigned directly on every render
  // (not inside an effect) so it's current by the time any event handler runs
  // after this render commits. A multi-second sync (network calls + delays)
  // used to read `game.state.pullLog` once at click-time and reuse that stale
  // snapshot for its final merge/save — if an import or another sync landed
  // in the meantime, the sync would silently overwrite that newer data with
  // its own stale base. Sync hooks look up the current game here instead of
  // trusting the `game` object passed in when the sync started.
  const gamesRef = useRef(data.games);
  gamesRef.current = data.games;

  const sync = useSyncRouter({ handleUpdateGame: tracker.handleUpdateGame, bannerDataRef, nteOverlayEnabled, nteCalibration, gamesRef });

  return (
    <>
      <div className={`app-ui gacha-tracker-page${revealed ? '' : ' app-ui--hidden'}`}>
        <div className="app-right">
          <TitleBar />
          <main className="app-main">
            {tracker.selectedGame ? (
              <GameDashboard
                game={tracker.selectedGame}
                onUpdate={tracker.handleUpdateGame}
                onOpenSettings={() => tracker.setShowGameSettings(true)}
                bannerPanelWidths={bannerPanelWidths}
                bannerSchedule={
                  tracker.selectedGame.linkedDatabase === 'hsr'  ? bannerSchedules.hsr :
                  tracker.selectedGame.linkedDatabase === 'zzz'  ? bannerSchedules.zzz :
                  tracker.selectedGame.linkedDatabase === 'nte'  ? bannerSchedules.nte :
                  tracker.selectedGame.linkedDatabase === 'wuwa' ? bannerSchedules.wuwa :
                  bannerSchedules.genshin
                }
              />
            ) : (
              <EmptyState onAddGame={() => tracker.setShowAddModal(true)} />
            )}
          </main>
        </div>
      </div>

      {tracker.showAddModal && (
        <AddGameModal
          onAdd={tracker.handleAddGame}
          onClose={() => tracker.setShowAddModal(false)}
          activeGames={tracker.activeGames}
        />
      )}
      {tracker.editingGame && (
        <EditGameModal
          game={tracker.editingGame}
          onUpdate={tracker.handleUpdateGame}
          onClose={() => tracker.setEditingGameId(null)}
        />
      )}
      {tracker.pendingDeleteId && (() => {
        const game = data.games.find(g => g.id === tracker.pendingDeleteId);
        return game ? (
          <ConfirmDialog
            title="Move to bin?"
            message={`"${game.name}" will be moved to the bin. You can restore it at any time.`}
            confirmLabel="Move to bin" danger
            onConfirm={() => { tracker.handleDeleteGame(tracker.pendingDeleteId); tracker.setPendingDeleteId(null); }}
            onCancel={() => tracker.setPendingDeleteId(null)}
          />
        ) : null;
      })()}
      {tracker.showGameSettings && tracker.selectedGame && (
        <GameSettingsModal
          game={tracker.selectedGame}
          bgUrl={gameBgUrl}
          onUpload={tracker.handleGameBgUpload}
          onRemove={tracker.handleGameBgRemove}
          onUpdate={tracker.handleUpdateGame}
          onUpdateMany={tracker.handleUpdateMultiple}
          onClose={() => tracker.setShowGameSettings(false)}
          activeGames={tracker.activeGames}
          syncState={sync.syncState}
          onStartSync={sync.handleStartSync}
          onCancelSync={sync.handleCancelSync}
          formatSyncTime={sync.formatSyncTime}
          onUidChange={tracker.handleGameUidChange}
          nteConsentModal={sync.nteConsentModal}
          nteCalibration={nteCalibration}
          onNteCalibrationChange={onNteCalibrationChange}
        />
      )}
    </>
  );
}
