import { useEffect, useState } from 'react';
import { getOwnedCharacters, computeCharCost, fetchRoster } from './costCalc';
import { getRosterConfig } from './rosterGameConfig';

// Sort within an element group: 5-star/S-rank block first, 4-star block
// after — each block alphabetical on its own, never interleaved by name.
function compareRosterChars(a, b) {
  return (b.rarity - a.rarity) || a.name.localeCompare(b.name);
}

// All Roster tab state/logic — see CostCalculatorTab.js (the grid, with a
// hover-to-reveal remove button on every character) and RosterManageModal.js
// (the "Manage Roster" search+add/remove list) for the actual rendering.
export function useRoster(game, onUpdate) {
  const { state, linkedDatabase } = game;
  const config = getRosterConfig(linkedDatabase);

  const [roster, setRoster] = useState({ characters: {}, elements: {} });
  useEffect(() => {
    let cancelled = false;
    fetchRoster(linkedDatabase).then(r => { if (!cancelled) setRoster(r); });
    return () => { cancelled = true; };
  }, [linkedDatabase]);

  if (!config) return { config: null };

  const owned = getOwnedCharacters(state.pullLog, linkedDatabase);
  const ownedByName = new Map(owned.map(c => [c.name, c]));

  const hiddenNames = state.rosterHidden ?? [];
  const autoMaxed = owned
    .filter(c => computeCharCost(c.count, c.rarity) >= 7)
    .filter(c => !config.isStandard(c.name, '9999-12-31 23:59:59'))
    .filter(c => !hiddenNames.includes(c.name));

  const manualNames = state.rosterManual ?? [];
  const shown = new Map(autoMaxed.map(c => [c.name, c]));
  for (const name of manualNames) {
    if (shown.has(name)) continue; // already auto-maxed — avoid a duplicate card
    const c = ownedByName.get(name);
    if (c) shown.set(name, c); // silently drop a stale name no longer in the pull log
  }
  const displayed = [...shown.values()];

  function addCharacter(name) {
    if (manualNames.includes(name) || shown.has(name)) return;
    onUpdate({ ...game, state: { ...state, rosterManual: [...manualNames, name] } });
  }

  function removeCharacter(name) {
    if (manualNames.includes(name)) {
      onUpdate({ ...game, state: { ...state, rosterManual: manualNames.filter(n => n !== name) } });
    } else if (!hiddenNames.includes(name)) {
      onUpdate({ ...game, state: { ...state, rosterHidden: [...hiddenNames, name] } });
    }
  }

  // Candidates for the search box: owned (pulled at least once), not already shown.
  const candidates = owned.filter(c => !shown.has(c.name));

  const groups = new Map(config.elementOrder.map(el => [el, []]));
  const other = [];
  for (const char of displayed) {
    const element = roster.elements[char.name];
    (groups.has(element) ? groups.get(element) : other).push(char);
  }
  for (const list of groups.values()) list.sort(compareRosterChars);
  other.sort(compareRosterChars);

  return {
    config, roster, linkedDatabase, displayed, candidates, groups, other,
    addCharacter, removeCharacter,
  };
}
