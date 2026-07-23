import React from 'react';
import './CharacterFilter.css';

export default function CharacterFilter({
  savedBuild,
  savedSelected,
  onSelectSaved,
  liveBuilds,
  liveIndex,
  onSelectLive,
}) {
  const hasLive  = liveBuilds && liveBuilds.length > 0;
  const hasSaved = !!savedBuild;

  // Only render the strip if there's something to show
  if (!hasSaved && !hasLive) return null;

  return (
    <div className="char-filter">
      {/* Saved build slot — always one circle on the left */}
      <button
        className={`char-filter__item char-filter__item--saved${savedSelected ? ' char-filter__item--active' : ''}`}
        onClick={onSelectSaved}
        title={hasSaved ? savedBuild.name : 'No saved build selected'}
        disabled={!hasSaved}
      >
        <span className="char-filter__portrait-wrap">
          {hasSaved && savedBuild.smallIcon
            ? <img src={savedBuild.smallIcon} alt={savedBuild.name} className="char-filter__portrait" />
            : hasSaved
              ? <span className="char-filter__portrait-fallback">{savedBuild.name?.[0]}</span>
              : null
          }
        </span>
        <span className="char-filter__name">{hasSaved ? savedBuild.name : '—'}</span>
      </button>

      {/* Divider between saved slot and live characters */}
      {hasLive && <div className="char-filter__divider" />}

      {/* Live fetched characters */}
      {hasLive && liveBuilds.map((build, i) => (
        <button
          key={build.avatarId ?? i}
          className={`char-filter__item${!savedSelected && i === liveIndex ? ' char-filter__item--active' : ''}`}
          onClick={() => onSelectLive(i)}
          title={build.name}
        >
          <span className="char-filter__portrait-wrap">
            {build.smallIcon
              ? <img src={build.smallIcon} alt={build.name} className="char-filter__portrait" />
              : <span className="char-filter__portrait-fallback">{build.name?.[0]}</span>
            }
          </span>
          <span className="char-filter__name">{build.name}</span>
        </button>
      ))}
    </div>
  );
}
