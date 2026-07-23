import React from 'react';
import GenshinCard from '../../games/genshin/GenshinCard';
import HsrCard from '../../games/hsr/HsrCard';
import ZzzCard from '../../games/zzz/ZzzCard';

export default function CharacterCard({ build, cardMode, cacheable, dimension }) {
  if (build?.resolutionFailed) {
    return (
      <div className="char-card char-card--error">
        <p className="char-card__error-msg">
          Character data could not be resolved.<br />
          The data files may not yet include this character.
        </p>
      </div>
    );
  }

  if (build?.game === 'genshin') return <GenshinCard build={build} />;
  if (build?.game === 'hsr')     return <HsrCard     build={build} cardMode={cardMode} cacheable={cacheable} dimension={dimension} />;
  if (build?.game === 'zzz')     return <ZzzCard     build={build} cardMode={cardMode} dimension={dimension} />;

  return (
    <div className="char-card char-card--error">
      <p className="char-card__error-msg">No card renderer for game: {build?.game}</p>
    </div>
  );
}
