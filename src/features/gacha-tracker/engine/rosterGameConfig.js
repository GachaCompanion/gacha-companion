// Per-game config for the Roster tab (CostCalculatorTab.js) — what counts as
// "standard pool" (excluded), and how to group/label/color the element (or
// NTE's Mental Attribute) a character belongs to. One file per concern lives
// per game already (standard pool, element data via nanokaRoster.js); this
// just wires the right ones together per linkedDatabase.

import { isGenshinStandardAt } from '../games/genshin/genshinStandardPool';
import { isHsrStandardAt } from '../games/hsr/hsrStandardPool';
import { isZzzStandardAt } from '../games/zzz/zzzStandardPool';
import { isWuwaStandardAt } from '../games/wuwa/wuwaStandardPool';

import gi_pyro from '../../../assets/elements/genshin/pyro.webp';
import gi_hydro from '../../../assets/elements/genshin/hydro.webp';
import gi_anemo from '../../../assets/elements/genshin/anemo.webp';
import gi_electro from '../../../assets/elements/genshin/electro.webp';
import gi_cryo from '../../../assets/elements/genshin/cryo.webp';
import gi_geo from '../../../assets/elements/genshin/geo.webp';
import gi_dendro from '../../../assets/elements/genshin/dendro.webp';

import hsr_fire from '../../../assets/elements/hsr/fire.webp';
import hsr_ice from '../../../assets/elements/hsr/ice.webp';
import hsr_thunder from '../../../assets/elements/hsr/thunder.webp';
import hsr_wind from '../../../assets/elements/hsr/wind.webp';
import hsr_quantum from '../../../assets/elements/hsr/quantum.webp';
import hsr_imaginary from '../../../assets/elements/hsr/imaginary.webp';
import hsr_physical from '../../../assets/elements/hsr/physical.webp';

import zzz_physical from '../../../assets/elements/zzz/physical.webp';
import zzz_fire from '../../../assets/elements/zzz/fire.webp';
import zzz_ice from '../../../assets/elements/zzz/ice.webp';
import zzz_electric from '../../../assets/elements/zzz/electric.webp';
import zzz_wind from '../../../assets/elements/zzz/wind.webp';
import zzz_ether from '../../../assets/elements/zzz/ether.webp';

import ww_glacio from '../../../assets/elements/ww/glacio.webp';
import ww_fusion from '../../../assets/elements/ww/fusion.webp';
import ww_electro from '../../../assets/elements/ww/electro.webp';
import ww_aero from '../../../assets/elements/ww/aero.webp';
import ww_spectro from '../../../assets/elements/ww/spectro.webp';
import ww_havoc from '../../../assets/elements/ww/havoc.webp';

// No usable icon asset exists for NTE's Mental Attribute system — nanoka's
// `element_icon` field points at a generic colored filter-button template
// (same shape, just recolored), not a real symbol. Groups render as text
// instead (see CostCalculatorTab.js's fallback), same as the "Other" bucket.
const ROSTER_CONFIG = {
  genshin: {
    isStandard: isGenshinStandardAt,
    elementOrder: ['Pyro', 'Hydro', 'Anemo', 'Electro', 'Cryo', 'Geo', 'Dendro'],
    elementColors: {
      Pyro: 'rgba(255,100,50,0.85)', Hydro: 'rgba(30,160,255,0.85)', Anemo: 'rgba(80,210,180,0.85)',
      Electro: 'rgba(180,100,255,0.85)', Cryo: 'rgba(140,210,255,0.85)', Geo: 'rgba(220,170,40,0.85)',
      Dendro: 'rgba(100,200,60,0.85)',
    },
    elementIcons: { Pyro: gi_pyro, Hydro: gi_hydro, Anemo: gi_anemo, Electro: gi_electro, Cryo: gi_cryo, Geo: gi_geo, Dendro: gi_dendro },
  },
  hsr: {
    isStandard: isHsrStandardAt,
    elementOrder: ['Fire', 'Ice', 'Thunder', 'Wind', 'Quantum', 'Imaginary', 'Physical'],
    elementColors: {
      Fire: 'rgba(240,80,80,0.9)', Ice: 'rgba(60,190,255,0.9)', Thunder: 'rgba(150,100,255,0.9)',
      Wind: 'rgba(60,210,150,0.9)', Quantum: 'rgba(90,90,220,0.9)', Imaginary: 'rgba(210,185,60,0.9)',
      Physical: 'rgba(190,190,190,0.9)',
    },
    elementIcons: { Fire: hsr_fire, Ice: hsr_ice, Thunder: hsr_thunder, Wind: hsr_wind, Quantum: hsr_quantum, Imaginary: hsr_imaginary, Physical: hsr_physical },
  },
  zzz: {
    isStandard: isZzzStandardAt,
    elementOrder: ['Physical', 'Fire', 'Ice', 'Electric', 'Wind', 'Ether'],
    elementColors: {
      Physical: 'rgba(232,193,60,0.9)', Fire: 'rgba(255,107,74,0.9)', Ice: 'rgba(74,212,232,0.9)',
      Electric: 'rgba(178,107,255,0.9)', Wind: 'rgba(74,232,160,0.9)', Ether: 'rgba(255,107,212,0.9)',
    },
    elementIcons: { Physical: zzz_physical, Fire: zzz_fire, Ice: zzz_ice, Electric: zzz_electric, Wind: zzz_wind, Ether: zzz_ether },
  },
  wuwa: {
    isStandard: isWuwaStandardAt,
    elementOrder: ['Glacio', 'Fusion', 'Electro', 'Aero', 'Spectro', 'Havoc'],
    elementColors: {
      Glacio: 'rgba(74,212,255,0.9)', Fusion: 'rgba(255,107,60,0.9)', Electro: 'rgba(178,107,255,0.9)',
      Aero: 'rgba(74,232,160,0.9)', Spectro: 'rgba(240,208,80,0.9)', Havoc: 'rgba(255,74,140,0.9)',
    },
    elementIcons: { Glacio: ww_glacio, Fusion: ww_fusion, Electro: ww_electro, Aero: ww_aero, Spectro: ww_spectro, Havoc: ww_havoc },
  },
  nte: {
    // No standard-pool data source found yet for NTE (see memory: NTE banner
    // source hunt) — every maxed character is included, not filtered.
    isStandard: () => false,
    elementOrder: ['Incantation', 'Chaos', 'Lakshana', 'Nature', 'Psyche', 'Cosmos'],
    elementColors: {
      Incantation: 'rgba(255,107,74,0.9)', Chaos: 'rgba(178,107,255,0.9)', Lakshana: 'rgba(240,208,80,0.9)',
      Nature: 'rgba(100,200,60,0.9)', Psyche: 'rgba(74,212,232,0.9)', Cosmos: 'rgba(190,190,190,0.9)',
    },
    elementIcons: null,
  },
};

export function getRosterConfig(linkedDatabase) {
  return ROSTER_CONFIG[linkedDatabase] ?? null;
}
