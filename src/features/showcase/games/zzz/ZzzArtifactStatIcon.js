import React from 'react';
import ZzzStatIcon from './ZzzStatIcon';
import ZzzElementIcon from './ZzzElementIcon';

// Passed as ArtifactSlot's StatIcon prop for ZZZ discs. ArtifactSlot only knows
// how to render one icon component per statKey — this picks between the two
// ZZZ has (ZzzStatIcon for plain stats, ZzzElementIcon for elemental DMG bonus,
// keyed 'dmg<Element>' by ZZZ_STAT_ICON_KEY in zzzData.js) so ArtifactSlot
// itself never needs to know ZZZ has two icon sources.
export default function ZzzArtifactStatIcon({ statKey, size = 12, className }) {
  if (statKey?.startsWith('dmg')) {
    const elementType = statKey.slice(3);
    return (
      <span
        className={className}
        style={{ width: size, height: size, display: 'inline-flex', flexShrink: 0 }}
      >
        <ZzzElementIcon elementType={elementType} className="zzz-artifact-elem-icon" />
      </span>
    );
  }
  return <ZzzStatIcon statKey={statKey} size={size} className={className} />;
}
