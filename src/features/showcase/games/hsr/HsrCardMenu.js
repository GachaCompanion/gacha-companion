// HSR-only showcase card menu. Sits in the strip revealed when the showcase
// sidebar is collapsed. Holds the per-card customization switches:
//   • PNG ↔ Live2D portrait
//   • 2D ↔ 3D
// Each switch: left = first option, right = second; enabling one disables the other.

import React from 'react';
import './HsrCardMenu.css';

function Switch({ leftLabel, rightLabel, right, onToggle, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={right}
      className={`hsr-card-menu__switch${right ? ' hsr-card-menu__switch--right' : ''}`}
      onClick={onToggle}
      title={title}
    >
      <span className="hsr-card-menu__switch-knob" />
      <span className="hsr-card-menu__switch-opt hsr-card-menu__switch-opt--left">{leftLabel}</span>
      <span className="hsr-card-menu__switch-opt hsr-card-menu__switch-opt--right">{rightLabel}</span>
    </button>
  );
}

export default function HsrCardMenu({ cardMode, onChange, dimension, onDimensionChange, visible, style }) {
  const live = cardMode !== 'png';        // default + anything non-png => Live2D
  const threeD = dimension !== '2d';      // default + anything non-2d => 3D
  return (
    <div className={`hsr-card-menu${visible ? ' hsr-card-menu--visible' : ''}`} style={style}>
      <div className="hsr-card-menu__field">
        <span className="hsr-card-menu__field-label">Customization</span>
        <Switch
          leftLabel="PNG"
          rightLabel="Live2D"
          right={live}
          onToggle={() => onChange(live ? 'png' : 'live2d')}
          title="Toggle between static portrait and Live2D"
        />
        <Switch
          leftLabel="2D"
          rightLabel="3D"
          right={threeD}
          onToggle={() => onDimensionChange(threeD ? '2d' : '3d')}
          title="Toggle between 2D and 3D"
        />
      </div>
    </div>
  );
}
