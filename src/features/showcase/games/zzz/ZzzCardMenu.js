import React from 'react';
import './ZzzCardMenu.css';

function Switch({ leftLabel, rightLabel, right, onToggle, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={right}
      className={`zzz-card-menu__switch${right ? ' zzz-card-menu__switch--right' : ''}`}
      onClick={onToggle}
      title={title}
    >
      <span className="zzz-card-menu__switch-knob" />
      <span className="zzz-card-menu__switch-opt zzz-card-menu__switch-opt--left">{leftLabel}</span>
      <span className="zzz-card-menu__switch-opt zzz-card-menu__switch-opt--right">{rightLabel}</span>
    </button>
  );
}

export default function ZzzCardMenu({ cardMode, onChange, visible, style }) {
  const live = cardMode !== 'png';        // default + anything non-png => Live2D
  return (
    <div className={`zzz-card-menu${visible ? ' zzz-card-menu--visible' : ''}`} style={style}>
      <div className="zzz-card-menu__field">
        <span className="zzz-card-menu__field-label">Customization</span>
        <Switch
          leftLabel="PNG"
          rightLabel="Live2D"
          right={live}
          onToggle={() => onChange(live ? 'png' : 'live2d')}
          title="Toggle between static portrait and Live2D"
        />
      </div>
    </div>
  );
}
