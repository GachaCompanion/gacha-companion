// ZZZ data loading from EnkaNetwork API store files.
// API endpoint: https://enka.network/api/zzz/uid/{uid}/

const BASE = 'https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/zzz';

let _avatars    = null; // avatars.json
let _weapons    = null; // weapons.json
let _equips     = null; // equipments.json { id → { Rarity, SuitId } }
let _loc        = null; // locs.json (en locale)
let _props      = null; // property.json { propId → { Name, Format } }
let _namecards  = null; // namecards.json { id → { Icon } }
let _loading    = null;

export async function loadZzzData() {
  if (_avatars) return;
  if (_loading) return _loading;
  _loading = (async () => {
    const [avatars, weapons, equips, locRaw, props, namecards] = await Promise.all([
      fetch(`${BASE}/avatars.json`).then(r => r.json()),
      fetch(`${BASE}/weapons.json`).then(r => r.json()),
      fetch(`${BASE}/equipments.json`).then(r => r.json()),
      fetch(`${BASE}/locs.json`).then(r => r.json()),
      fetch(`${BASE}/property.json`).then(r => r.json()),
      fetch(`${BASE}/namecards.json`).then(r => r.json()),
    ]);
    _avatars    = avatars;
    _weapons    = weapons;
    _equips     = equips;
    _loc        = locRaw['en'] ?? locRaw;
    _props      = props;
    _namecards  = namecards;
  })();
  return _loading;
}

export function getZzzAvatarData(id) {
  return _avatars?.[String(id)] ?? null;
}

export function getZzzAllAvatarIds() {
  return _avatars ? Object.keys(_avatars) : [];
}

export function getZzzWeaponData(id) {
  return _weapons?.[String(id)] ?? null;
}

export function getZzzEquipData(id) {
  return _equips?.Items?.[String(id)] ?? _equips?.[String(id)] ?? null;
}

export function getZzzSuitData(suitId) {
  return _equips?.Suits?.[String(suitId)] ?? null;
}

// property.json lookup — returns { Name, Format } or null
export function getZzzPropDef(propId) {
  return _props?.[String(propId)] ?? null;
}

// True if the property is a percent stat (stored in per-10000 units)
export function isZzzPctProp(propId) {
  const def = getZzzPropDef(propId);
  return def ? def.Format.includes('%') : false;
}

export function zzzText(nameKey) {
  if (!_loc || !nameKey) return '';
  return _loc[nameKey] ?? '';
}

export function zzzAsset(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  if (path.startsWith('/')) return `https://enka.network${path}`;
  return `https://enka.network/ui/zzz/${path}`;
}

export function getZzzNamecards() { return _namecards; }

// Namecard URL for a character. Shimmer variant unless M6 (mindscape === 6).

export function zzzNamecardIcon(avatarId, mindscape, namecards) {
  if (!namecards) return null;
  // 331{id} = shimmer variant, 332{id} = standard variant
  const prefix = mindscape >= 6 ? '332' : '331';
  const entry = namecards[`${prefix}${avatarId}`];
  if (!entry?.Icon) return null;
  return zzzAsset(entry.Icon);
}

// CoreSkillEnhancement string → CoreEnhancementProps index
export const CORE_ENHANCEMENT_IDX = { '': 0, A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 };

// Drive disc slot index → slot key
export const ZZZ_DISC_SLOT  = { 1: 'disc1', 2: 'disc2', 3: 'disc3', 4: 'disc4', 5: 'disc5', 6: 'disc6' };
export const ZZZ_SLOT_ORDER = ['disc1', 'disc2', 'disc3', 'disc4', 'disc5', 'disc6'];

// Human-readable labels for known property IDs — used as display names in the card.
// For unlisted IDs, falls back to property.json Name.
const ZZZ_STAT_LABELS = {
  11101: { label: 'HP',                  short: 'HP'    },
  11102: { label: 'HP%',                 short: 'HP%'   },
  11103: { label: 'HP',                  short: 'HP'    },
  12101: { label: 'ATK',                 short: 'ATK'   },
  12102: { label: 'ATK%',                short: 'ATK%'  },
  12103: { label: 'ATK',                 short: 'ATK'   },
  12201: { label: 'Impact',              short: 'IMP'   },
  12202: { label: 'Impact%',             short: 'IMP%'  },
  12301: { label: 'Sheer Force',         short: 'SF'    },
  12303: { label: 'Sheer Force',         short: 'SF'    },
  13101: { label: 'DEF',                 short: 'DEF'   },
  13102: { label: 'DEF%',                short: 'DEF%'  },
  13103: { label: 'DEF',                 short: 'DEF'   },
  20101: { label: 'CRIT Rate',           short: 'CR'    },
  20103: { label: 'CRIT Rate',           short: 'CR'    },
  21101: { label: 'CRIT DMG',            short: 'CD'    },
  21103: { label: 'CRIT DMG',            short: 'CD'    },
  23101: { label: 'PEN Ratio',           short: 'PEN%'  },
  23103: { label: 'PEN Ratio',           short: 'PEN%'  },
  23201: { label: 'PEN',                 short: 'PEN'   },
  23203: { label: 'PEN',                 short: 'PEN'   },
  30501: { label: 'Energy Regen',        short: 'ER'    },
  30502: { label: 'Energy Regen%',       short: 'ER%'   },
  30503: { label: 'Energy Regen',        short: 'ER'    },
  31201: { label: 'Anomaly Proficiency', short: 'AP'    },
  31203: { label: 'Anomaly Proficiency', short: 'AP'    },
  31401: { label: 'Anomaly Mastery',     short: 'AM'    },
  31402: { label: 'Anomaly Mastery%',    short: 'AM%'   },
  31403: { label: 'Anomaly Mastery',     short: 'AM'    },
  31501: { label: 'Physical DMG Bonus',  short: 'PHY'   },
  31503: { label: 'Physical DMG Bonus',  short: 'PHY'   },
  31601: { label: 'Fire DMG Bonus',      short: 'FIRE'  },
  31603: { label: 'Fire DMG Bonus',      short: 'FIRE'  },
  31701: { label: 'Ice DMG Bonus',       short: 'ICE'   },
  31703: { label: 'Ice DMG Bonus',       short: 'ICE'   },
  31801: { label: 'Electric DMG Bonus',  short: 'ELEC'  },
  31803: { label: 'Electric DMG Bonus',  short: 'ELEC'  },
  31901: { label: 'Ether DMG Bonus',     short: 'ETHR'  },
  31903: { label: 'Ether DMG Bonus',     short: 'ETHR'  },
};

// Maps a property ID to one of ZzzStatIcon.js's icon keys, so disc main/sub
// stats (built generically from propId via buildZzzStat) can show the same
// icons the fixed-key center stat rows already do. Elemental DMG Bonus props
// map to a 'dmg<Element>' key instead — ZzzArtifactStatIcon.js (the StatIcon
// passed to ArtifactSlot for ZZZ discs) recognizes that prefix and renders
// ZzzElementIcon's gradient icon rather than a plain ZzzStatIcon glyph.
const ZZZ_STAT_ICON_KEY = {
  11101: 'hp', 11102: 'hp', 11103: 'hp',
  12101: 'atk', 12102: 'atk', 12103: 'atk',
  12201: 'impact', 12202: 'impact',
  12301: 'sheerForce', 12303: 'sheerForce',
  13101: 'def', 13102: 'def', 13103: 'def',
  20101: 'critRate', 20103: 'critRate',
  21101: 'critDmg', 21103: 'critDmg',
  23101: 'penRatio', 23103: 'penRatio',
  23201: 'penDelta', 23203: 'penDelta',
  30501: 'energyRegen', 30502: 'energyRegen', 30503: 'energyRegen',
  31201: 'anomalyProficiency', 31203: 'anomalyProficiency',
  31401: 'anomalyMastery', 31402: 'anomalyMastery', 31403: 'anomalyMastery',
  31501: 'dmgPhysics', 31503: 'dmgPhysics',
  31601: 'dmgFire',    31603: 'dmgFire',
  31701: 'dmgIce',     31703: 'dmgIce',
  31801: 'dmgElec',    31803: 'dmgElec',
  31901: 'dmgEther',   31903: 'dmgEther',
};

// Returns { label, short, pct, iconKey } for a property ID.
// pct is derived from property.json Format at runtime, labels from ZZZ_STAT_LABELS with Name fallback.
export function getZzzStatInfo(propId) {
  const pct     = isZzzPctProp(propId);
  const known   = ZZZ_STAT_LABELS[propId];
  const propDef = getZzzPropDef(propId);
  const label   = known?.label ?? propDef?.Name ?? String(propId);
  const short   = known?.short ?? label;
  const iconKey = ZZZ_STAT_ICON_KEY[propId] ?? null;
  return { label, short, pct, iconKey };
}

// Rarity scale for drive disc main stat approximate formula
export const DISC_RARITY_SCALE = { 4: 0.2, 3: 0.25, 2: 0.3 };

// ── Icon sources ────────────────────────────────────────────────────────────
// Skill type icons — same for every agent, indexed by SkillLevelList.Index.
// Hoyoverse's own SVG files (act.hoyoverse.com/gt-ui/assets/icons/*.svg) each
// have a root <svg> with no viewBox/width/height of its own — only an inner
// <symbol viewBox="0 0 24 24" id="gti"> does, referenced via <use>. As a plain
// <img src>, browsers can't infer the true 24x24 canvas from that and render
// the actual artwork tiny inside a mostly-empty default-sized box, and a
// #gti URL fragment doesn't reliably fix it either. So instead, each icon's
// real artwork (an embedded PNG glyph for 5 of them; ultimate's is pure
// vector, rebuilt here as a small standalone SVG with a correct viewBox) is
// inlined directly as a self-contained data URI — correct sizing guaranteed,
// no network dependency either.
export const ZZZ_SKILL_ICONS = {
  0: 'data:image/png;base64,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', // Basic Attack
  1: 'data:image/png;base64,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', // Special Attack
  2: 'data:image/png;base64,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', // Dodge
  3: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTIiIGZpbGw9IiMwMDAiLz48ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxMiAxMikgc2NhbGUoMS4zNzUpIHRyYW5zbGF0ZSgtMTIgLTEyKSI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEyLjIyNiA0QzcuNzkzIDQgNC4yIDcuNjAyIDQuMiAxMi4wNDVjMCAyLjQ0OCAxLjA5IDQuNjQgMi44MTIgNi4xMTYgMi44OTkuMzU3IDQuMjkyLTEuMTEgNC4xMzctMS4xNzgtMi41NDMtMS4xMy00LjM4Ni0zLjA4LTQuMzg2LTUuNjkzIDAtMy43NCAzLjU1OS02Ljc3IDcuOTQ4LTYuNzcuMTI3IDAgLjI1My4wMDIuMzc4LjAwN0E3Ljk5MSA3Ljk5MSAwIDAgMCAxMi4yMjYgNFoiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTIuMTc0IDIwYzQuNDMzIDAgOC4wMjYtMy42MDIgOC4wMjYtOC4wNDUgMC0yLjQ0OC0xLjA5LTQuNjQtMi44MTItNi4xMTYtMi44OTktLjM1Ny00LjI5MiAxLjExLTQuMTM3IDEuMTc4IDIuNTQzIDEuMTMgNC4zODYgMy4wOCA0LjM4NiA1LjY5MiAwIDMuNzQtMy41NTkgNi43NzItNy45NDggNi43NzItLjEyNyAwLS4yNTMtLjAwMy0uMzc4LS4wMDhhNy45OSA3Ljk5IDAgMCAwIDIuODYzLjUyN1oiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTIuMzA0IDguNzQyYTMuMjE3IDMuMjE3IDAgMCAwIDMuMjEzIDMuMjJjLS4wMjggMCAwIC4yMDggMCAuMjA4YTMuMjE3IDMuMjE3IDAgMCAwLTMuMjEzIDMuMjJoLS4xMjZhMy4yMTcgMy4yMTcgMCAwIDAtMy4yMTMtMy4yMnYtLjIwN2EzLjIxNyAzLjIxNyAwIDAgMCAzLjIxMy0zLjIyMWguMTI2WiIvPjwvZz48L3N2Zz4=', // Ultimate/Chain — recolored white on a black circle backdrop; icon scaled 1.375x from center to nearly fill the circle (1px margin), matching the other PNG icons' proportions
  5: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEIAAABCCAYAAADjVADoAAAACXBIWXMAAAsTAAALEwEAmpwYAAAWg0lEQVR4nNVce1BU59n/7Z0FFliui7DILVw0RpPhIkiMk1i1xlaNdZRIrEnTIZ0YqSWpEkVjmplEjTMkaWqNt7b6RbRTY7RYM2I0RlFQKrTcxYV1lzu47ALLLpd9vj+W3Zyz5ywX9cvM95s5f+x73vOc533O+z7v8z6XFeDHQTSAVACzAcQBiAQQDMAXgPdYn34ARgBdALQA6gBUAigFoPmR+HzsEAJYCOALADoA9IiXbozWwjHajx2Cx0wvHMBGAC8DULveFAqFEIvFEIlEEAqFEIlEEAjsLBARRkdHYbPZMDo6ipGREdhsNr536AH8D4DPYRfQY8HjEkQMgDwArwCQsl4gECAgIADx8fGIiYlBWFgYVCoVfHx8nAIB4BSAyWRCe3s7Wltb0djYiPr6evT09ICIXN85BOAYgA8B3HvUAXAEwfNC6PV6FBQU4Pjx4+jo6GDe8gawA8BmAGLmjbCwMKSnpyM5ORnh4eGIjIxEWFgYAgMD4enpOS5TZrMZ3d3daGlpQXNzM/R6PW7duoWSkhK0tLS4dh8B8AmA92DXMwCAkJAQZGVl4be//S3Cw8PZgxZM4vsTEeu6e/cusrKy+LquBM/6T0tLo7y8PCosLCSNRkOPCxqNhgoLCykvL4/S0tLc6ZGXXJnMysrC3bt3WWOaFJgPVFdXY9myZa5d5AAOuTKSnp5O+fn5dP369cc2eHe4fv065efnU3p6Op9ADo3x6MSyZctQVVX1cIKoqanBkiVLXG9HALjDfLFaraacnBy6devWlAZjs9nIbDZTb28vGQwG6uvro8HBwSnRuHXrFuXk5JBarXYVxp0xXp1YvHixUxh84NURTU1NyMnJwblz55i35gA4DyDU0ZCRkYE333wTa9eunVDAWq0Wer0ePT09sFgsaGlpgclkwuDgIIgIEokEcrkcwcHBUCqV8Pb2xrRp0xAZGQkfH59xaRcWFuLzzz/HtWvXmM1tAJYCqHA0LFu2DAUFBYiNjZ2QX7S0tPDphGQABoxJ3NfXlzIzM6m8vHzcL6bX6+nKlSt0+PBhWr9+PSUkJJBMJpuU7eDv708LFiygnTt30rlz56i8vJwsFovbd5WXl1NmZib5+voy6RhgN+SccKPvuHjnnXdcm2YB6HUQV6lUlJeXR21tbW6ZampqoosXL9Ibb7xBERERJJPJSCAQPJQxJRaLSaFQUHJyMn322WdUWlpKfX19vO9ta2ujvLw8UqlUTBq9sM/mqSEoKIj5MxyMnUGtVtPu3bupt7eXl5EHDx5QcXExZWZmUlhYGIlEoke1KFmXt7c3zZw5k/bt20eVlZVks9k4PBiNRtqzZ4+r3tCNjeWh4AmGYgwNDaWPPvrI7deorq6m9957j6Kjo6c8wKnOFl9fX0pPT6d//OMfvB+lr6+Pdu/eTaGhoa4K1K0BIxpHEPthVzbw8fFBdnY2Nm3axFFcQ0NDuHz5Mnbs2IGTJ0+6GlxOCIVCyOVyKJVKKJVKREVFITo6GnFxcYiJiUF4eDhUKhU8PDzg6ekJiUTidu+3Wq3Q6XS4fv06RCIRR6FKpVI8+eSTMJvNqKyshNVqBQAV7Ir+LB9/7kyslQBOA4BEIsHatWuxZ88eqFQqVieLxYKzZ89i165dqKmpcUMKEIlESEhIwE9+8hPMmDEDvr6+UKlUkMlkkEqlEAgEGBkZwfDwMEwmEwwGAzo7O/Hdd9/h22+/hdFodLvt+fr6YsOGDdi4cSNiYmJYVmN7ezu2bNmCEydOYHh42NH8EoCv3DLLgDfsBxsCQPPmzaM7d+5wpp/ZbKZjx45RbGzshFPZw8ODcnNzaXR01I165ceXX35JISEhE9KXSqX02muvUXV1NUdv3Llzh+bNm8fsr8cPR/9xsdfxUGhoKBUWFnIYtFgsdOLECYqJiZnUmpZKpZSZmUl6vX7SQujp6aF33nmHPDw8Jq07Xn/9dWpsbOTQKiwsdNUXH08khFgAww7mN23axJHw8PAwnT9/nmbMmDFlpZidne1W2brik08+IX9/f97tVKlUklAo5J15eXl51N3dzaJls9koJyeHpFKpo+/w2FjdwnmGSElJoZs3b3II/ve//6XFixfzDjQgIIBeeOEFCgoK4t0ZIiMj6ejRoxMKobKyklJSUjg0hEIhLVy4kN577z3KyMhgDsx5KZVK+uKLLzjGV2lpqSvNQ+6EoAZgBUAymYx27drFYdBoNNLOnTvJ29ubw4CPjw/l5OSQXq+nLVu28H4xADR79myqqqpyK4Suri568cUXeZ/18fGhK1euEJH9nMEnLAAUHR1Nly5dopGRERbtXbt2MS1bK3icRwCw20EoPT2dysrKWESGh4epuLiYIiMjOS+Wy+X0+uuvU39/PxHZLTyVSuXWPkhPT6f79+9zll1XVxe98cYbvGa4UCikZ599ljo7O539Dx48SFFRUZz3iEQi2rBhA7W0tLDol5WVuZ5Yd7sKQQKgw/HCLVu2cL6UVqulNWvW8K7Zn//856x1aTQa6d133x33XJGcnEzFxcWk1Wrp/v379J///Ic2bNjAO9scU/7EiROcKf/nP//Z1aQmABQcHExFRUU0PDzM6r9161bmbO0YG7sTSxwEwsPD6dSpU6yHR0dH6eLFizRt2jTOun/qqaeoqKiIIziNRkMRERHjKk9vb2+KiYmhxMRE8vPzc7ucANDMmTPd7jrZ2dm8+mLVqlV07949Vt9Tp05ReHg4s99ipiAOOm6sXr2a83BLSwv9+te/5jCqUCgoPz+flzmDwUCvvvrqYzlvSKVSeuutt9yecS5fvkypqamcJeLv709FRUWsJXjv3j1avXo1s99B4AfX+CLA7st75plnEB0dzVo39fX1+Ne//sXyKgsEAsTFxeH5558HH7y8vLBq1SqEhYXx3p8KVCoVFi1a5NbXuWDBAqxYsQJ+fn6s9t7eXly7dg0mk8nZFh0djaSkJKYFugiwCyIaY94cPz8/jqPTZrOhsbGRc4ZQKBRYunQpFixYwMucRCJBcnIyAgMD3Q5QIpHAw8MDHh4ekMlkEIn4jz5eXl6IjIyERCLhvQ8A8+fPR3x8PMvEttlsOHPmDKqqqlh9w8PDoVQqHT8jAESLwXBcxMfHIyoqivWQTqfD1atXmbY6BAIBYmJi8Nxzz7llDLCfRUZGRjjtEokEfn5+SEtLQ0REBGQyGYxGIxoaGlBeXo7BwUHW7DMYDKioqEBcXBykUimHHgDMnTsXixYtQk1NDWsG1NXVoa2tjdU3MjIS8fHxuHHjhqMpVYwxp4VAIEBiYiKmT5/Oekir1aKkpITVJpfLkZGRgeTkZLdCGBgYwOnTp6HTsWMwcrkcP/3pT7F8+XKkpaVBrVZDKpXCaDSisbERxcXF+PLLL1FbW4vR0VEA9sPT4cOH8dxzzyEsLMwZC2FCKBQiJSUFwcHBLEEQEfR6PWw2m/M5tVqN+Ph43Lx503GYewoAzmBMIW3fvp2zPZ05c4YkEglLCQUFBdGBAwc4Sstms5HNZqPh4WH6/vvvKT4+nrNLvPLKK9TU1MSr9Bz45z//SU8//TRL0Tq29erqarJYLDQyMkKjo6POy2azUU1NDS1ZsoSjbH/1q1+xdhyLxULbtm1j7jRnxBizroRCIQIDAyGTyViSNpvNrGUBAJ6enggMDHSG6YaGhmCxWNDf3w+TyQSNRoM//elPqK+vdz4jkUiQkZGB/Px8REZGup1JAPDiiy/CYrHg97//PTQae/zXZrNh9+7dqK2txbPPPouEhAT4+fk5j/Kenp7o6uqCj48PPDw8YLFYnPR0Oh0MBoNTcctkMgQGBjJnVoQYQABg9xnweYvdOVq6u7tRVVWFuro6GAwGtLe3Q6PRoLq6GuXl5Rz/gVKpRGZmJp544olxheDA8uXLUVZWhk8//ZQ1qLNnz+LsWbtvxcvLC8HBwfDz84Ovry+ICPfv3+fopfb2dhiNRlabQqFgCkIlxtjZXCQSQSxmRe1gNpthMBg4TGq1WmRnZ09qQMAPO0hKSsqknxGLxUhKSoKnpydLEEwMDAygqalpQlpGo5FDQywWMwXhLQSgAOzK0lUJDQ8PO9xcjwShUIiIiAio1bxnHLdQqVSYPn06r3KcCiwWC2d5C4VCJl3FuG+w2Wy8299UIRAIIJVKOfpnIshkMnh4eEwuaDsOaOJQ35AQQJ+js2s+gsPgeVQQEQYGBjAwMDCl50wmE7q7u53b6MNCKpVylr3NZmOOt18Meyg9wJGcwcTjEsTw8DAqKytRXV2N9PT0ST+n1+vR1dXl9r5AIEBQUBCCg4MREhICb29vNDc3o76+nqUT+AThSEoZQ58YQA+A6Y4kDSZkMhmCg4M5DCiVSqxZswZz586FVqvF4OAgHjx4gI6ODjQ3N6Ouro6lW2w2GxoaGnD16tVJC0Kr1eLcuXMwm82s9vj4eCxcuBCzZ89GREQEfH19nSEAi8WCAwcOQKPRsAQRFBQEb2+2v7avr48piB4x7FGgZ2w2G7q7u2G1WllrmWGTOyGXyzFv3jysXbvWaWeYzWb09/ejt7cXer0e586dw7Fjx1gvPnbsGObMmcMXZefg0KFDuHLlCoaGhpxtaWlp2LZtG5KSkqBUKlmpRwKBAN3d3QDAWUphYWGsA5nVakV3dzdTEDoxgAbAPn31ej06OztZ2t3b2xs+Pj6s2WK1WtHV1QWxWOy0Pfz9/Z1KKSkpCbNmzUJ7ezsuXrwI4IdZ8e6778JkMmH16tW8SrC1tRVHjhzB3/72N/T29jrbVSoVtm/fjoULF0IikfA+29TUhIqKCgwODrLaY2JiWDO7s7MTer2euZPUiWEPhYGIUF9fD51OxxJESEgIZs6cyTygwGg04saNG1ixYoXzkCYQCJzMiUQixMbGYsuWLWhqakJjYyMAYGRkBJWVlcjNzUVFRQWSk5OhUqkgkUjQ39+Pe/fu4fLlyzh79iz6+/udml4kEmHx4sVISUlxe+gC7O6CpqYmzg4RFxfHMhZ1Oh3q6+uZ/SrFsOcxOgk1Nzez1nFsbCyef/55lJWVOafcyMgIbt++jbKyMs5p1QGxWIzZs2djzpw5TkEA9pnhyMny8vJCVFQU5HI5enp6oNPpYLFYWMsBsM+2uXPnwsvLy60QjEYjSkpKOAagQqGASqVizSCHQmWgVAx7MqcOgNpgMECv13MIJSUlwcPDg7X9tba24tq1a1i9erVbg8eRSsiHwcFBp5IVCASw2Wxu93qz2Yyurq5xt9Hvv/8e3333HccAzMjIQExMDKvNcfZw/ASgcYzgG8C+PG7fvu086AD2Ka9Wq5GQkMAiZrVaUVxcjDNnzrhlzmw2T2gCO9IKxzN4zGYzLl26xFn7TBQXF3OWhVQqxcqVK1nnG41G43oW+gb4wVV32tF648YNlJeXs14yY8YMrFu3DgqFgtXe2NiI06dP8zI4NDSE0tJSzgxzhVgsdqv8HCAi1NbWoq6ujldgf/nLX/DVV19xzhNqtRqJiYksG6K8vJyl78AYO+Dizt+6dSvHR3Dz5k3eMF9AQAB9/PHHnP49PT2UmZnp1nkrEolo9uzZtGnTJtq+fTtlZWWRQqFw68AVCoW0Zs0aTjjvxo0blJGRwXHcenp60h/+8AcymUys/hO58wFgj4MIX4BnYGCA9u3bR0qlksNkREQEx1HT3NzsNmlELpdTdnY2abVaevDgAfX29lJnZyeVlJSMG1339/dnRcnMZjNlZWVxHEcA6IknnqCSkhIWT7du3XKNjHMCPIBLyO/999/nfOXKykpKTU3lZTI5OdkpvN7eXlcPEOv6xS9+wYpYMVFSUjJugDkrK4vMZjMREeXm5pKPjw+nj6+vL+3fv5/jbXv//fcnFfIDGEHg1NRUKi0tZRGyWq108uRJTqAHY66+1NRUOnLkCBmNRo6bjimwiTJyDx8+TNOnT+cNGSoUCjp16hTl5uZSYGAg7zv4AjulpaWUnJzM7Oc2CAy4pAVs3ryZw6TJZKKPPvqI90sAoJiYGMrMzOTMBoFAQAkJCfT111+PKwQiew7Uxo0b3c6KWbNmuX3/jBkz6JtvvmGF+h4mLQCwJ1EQYA///f3vf+cwqtfr6a233nKrCMViMa+yy83NJavVOqEgiIgaGhrohRdecCsMvisiIoL++te/cpZEYWGh6yzeN5EQAJfUofnz5/OG8Wtra2n9+vWTYlAqldKGDRs4GnwiXL16lZ588slJZd2FhobSgQMHnBF5ByoqKiaVOsRn9g0BaAKwBgDa2tpgNpuRmprKOsoGBAQgLi4OAwMDqK+vH9eTJRaLkZiYiJCQEJhMJohEIsjlcl7bYWhoCF1dXaiqqsK///1vlJeXo7u7e1yDKzw8HPn5+Xj55ZdZPLa1teGDDz7AhQsXmCfNV2EvkWJhPB/YkbGHoFQqkZOTg9/97ncco+revXs4ePAgjh49is7OTl5CAoEAfn5+CAgIQFRUFOLi4qBWq6FQKCCVSiGRSDA0NASz2Qyj0YjW1lbcuXPHaQpbrVa3gkhMTMS2bduwYsUK1lnEaDRi7969+OMf/8j0YB8F8No4Y+aFJ+wJ3QTYs24LCgqcWxcTXV1ddOjQIYqNjZ1wGgsEAvLy8iJ/f38KDg6mkJAQCg0NpZCQEAoKCiKlUkmenp4TLgU/Pz/62c9+RpcuXeLonf7+ftq7d6+rXqjAOAmnHLgEbSMBdDqIRUVFUUFBAWcdEtmjR99++y398pe/pODg4Ckpualcnp6elJiYSPv376e7d+9y+DCZTLR3717X3IxOANMnLQQAePvtt12bngYjKT0sLIx27tzp1iDSarVUVFREL730Evn7+4+b/DGVSyaTUWxsLH344YdUUlLCm6nf3t5O27Ztc00l7B0bA4BJljEBdofpmjVrXJtTYPdtEmBP41m3bh1vIqoDDQ0NVFRURFu3bqWEhISHThjx8fGhpUuX0pEjR+jatWtudx5HmYKfnx/z+R64lClkZmbyjpu3cKWhoQGbN2/G+fPnmbdmALgAhlk6f/58/OY3vxm3cMVgMKCmpgYdHR24f/8+qqqqoNPpnGE4q9WKoaEhpwPW398fKpUK8fHxmDVrllPBJiYmun2Hm8IVHewpUc7c6KVLl6KgoABxcXGTEwQAVFdX4+2338aFCxeYtyMAfA1G/YNarcaqVauwbt06JCUluWXWgZaWFhgMBmf1zsjICEZHRyEWi53BXF9fX4SEhHAyYFxx+/ZtHD9+nC/9oBLActgrigHYS5n27duHmTNnTr3Kr7a2FitXrnTtIgPwGVymcHp6Ou3YseNHK27bsWOHu+K2w3DZHVauXImampqHr/Kjsfqu9evX83VdCYYF6rgc5Y4nT56cMA9iKmhqaqKTJ0+OV+6oB0+54/r1652eq/EE8aiVwN6wF57mgKcAdt68eUhJSUFYWBgiIyMxbdo0BAUFQS6X89FyYnBwEF1dXWhtbUVzczNaWlpQVlaG69evuyuA/RTATjAKYKeKx1USHQtgK3hKokUikbMkOjo62lkSrVAonCXRNBZ3HRkZQX9/Pzo6OtDS0gKNRuMsieZx3DpKoncDuPuoA3jcRfJqAG8CWAeeGqrxiuSZTtwJiuRbABzHYy6S/7+C428TDuLx/W3CQfw/+tsEd4gGMBf2P9KIh910DwLgA7ueGYZ9fRtgT1NoBlAP+zZ4Ez/CH2n8L1gFioI51kVdAAAAAElFTkSuQmCC', // Core Skill
  6: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEIAAABCCAYAAADjVADoAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA3FpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDYuMC1jMDAzIDc5LjE2NDUyNywgMjAyMC8xMC8xNS0xNzo0ODozMiAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDo2M2UwMTBlMC00MTY2LTlmNGMtYmI1Mi0xOWRmODg5NGIxOGIiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6MzgwREYyQjU4Q0FDMTFFQ0IyM0JFRUJEQjVGREM3NzYiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6MzgwREYyQjQ4Q0FDMTFFQ0IyM0JFRUJEQjVGREM3NzYiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENDIChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOjMxMjQ3NjgyLTk5YmUtYjA0Ni04ZDgwLTk2ZDlhY2RkNzE4MCIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDo2M2UwMTBlMC00MTY2LTlmNGMtYmI1Mi0xOWRmODg5NGIxOGIiLz4gPC9y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', // Assist
};

// Profession icons served by Enka CDN, matching ProfessionType exactly
export function zzzProfessionIcon(professionType) {
  return professionType ? `https://enka.network/ui/zzz/Icon${professionType}.png` : null;
}

// Approximate W-Engine stat multiplier constants
export const WEP_MAIN_A = 0.1568166666666667;
export const WEP_MAIN_B = 0.8922;
export const WEP_SEC_B  = 0.3;

export function formatZzzStat(propId, value) {
  if (isZzzPctProp(propId)) {
    // Percent stats stored in per-10000 → divide by 100 to get percentage
    return `${(value / 100).toFixed(1)}%`;
  }
  return Math.round(value).toLocaleString();
}
