import React, { useState, useEffect, useRef } from 'react';
import { Search, Loader, ChevronDown } from 'lucide-react';
import { getActiveProfileId, scopedKey } from '../../../shared/utils/profileStorage';
import './UidLookup.css';

const GAMES = [
  { id: 'genshin', label: 'Genshin Impact', available: true  },
  { id: 'hsr',     label: 'Honkai: Star Rail', available: true  },
  { id: 'zzz',     label: 'Zenless Zone Zero',  available: true  },
];

// Remembers the last UID typed per game (not the fetched showcase itself —
// switching games still clears that, on purpose) so switching back to a game
// doesn't require retyping its UID. Persisted the same way as cardMode/
// cardDimension elsewhere in showcase state: localStorage, not user.json —
// scoped per-profile (see shared/utils/profileStorage.js) since localStorage
// itself is shared across every profile.
const UID_MAP_BASE_KEY = 'showcaseLastUidByGame';
function loadUidMap(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}

export default function UidLookup({ onSearch, status, error }) {
  const uidMapRef = useRef({});
  const storageKeyRef = useRef(null);
  const [game,     setGame]    = useState('genshin');
  const [uid,      setUid]     = useState('');
  const [dropOpen, setDropOpen] = useState(false);
  const wrapRef = useRef(null);

  const selectedGame = GAMES.find(g => g.id === game);

  useEffect(() => {
    let cancelled = false;
    getActiveProfileId().then(profileId => {
      if (cancelled) return;
      const key = scopedKey(UID_MAP_BASE_KEY, profileId);
      storageKeyRef.current = key;
      uidMapRef.current = loadUidMap(key);
      setUid(uidMapRef.current.genshin ?? '');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!dropOpen) return;
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setDropOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropOpen]);

  function handleSubmit(e) {
    e.preventDefault();
    onSearch(uid, game);
  }

  function selectGame(g) {
    if (!g.available) return;
    setGame(g.id);
    setUid(uidMapRef.current[g.id] ?? '');
    setDropOpen(false);
  }

  function handleUidChange(e) {
    const val = e.target.value;
    setUid(val);
    uidMapRef.current[game] = val;
    if (!storageKeyRef.current) return;
    try { localStorage.setItem(storageKeyRef.current, JSON.stringify(uidMapRef.current)); } catch { /* ignore */ }
  }

  const loading = status === 'loading';

  return (
    <div className="uid-lookup">
      <form className="uid-lookup__form" onSubmit={handleSubmit}>

        {/* Game selector — left of input */}
        <div className="uid-lookup__game-wrap" ref={wrapRef}>
          <button
            type="button"
            className="uid-lookup__game-btn"
            onClick={() => setDropOpen(o => !o)}
            disabled={loading}
          >
            <span>{selectedGame?.label}</span>
            <ChevronDown size={13} className={`uid-lookup__chevron${dropOpen ? ' uid-lookup__chevron--open' : ''}`} />
          </button>

          {dropOpen && (
            <ul className="uid-lookup__dropdown">
              {GAMES.map(g => (
                <li
                  key={g.id}
                  className={[
                    'uid-lookup__dropdown-item',
                    g.id === game       ? 'uid-lookup__dropdown-item--active' : '',
                    !g.available        ? 'uid-lookup__dropdown-item--disabled' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => selectGame(g)}
                >
                  {g.label}
                  {!g.available && <span className="uid-lookup__soon">Soon</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <input
          className="uid-lookup__input"
          type="text"
          placeholder="Enter UID…"
          value={uid}
          onChange={handleUidChange}
          disabled={loading}
          maxLength={12}
        />

        <button
          className="uid-lookup__btn"
          type="submit"
          disabled={loading || !uid.trim()}
        >
          {loading
            ? <Loader size={15} className="uid-lookup__spinner" />
            : <Search size={15} />
          }
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <p className="uid-lookup__error">{error}</p>}
    </div>
  );
}
