import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { createGame, applyDatabaseLink } from '../engine/gameSchema';
import { parseUid } from '../engine/uidUtils';
import { StepBasic, StepCurrency, StepCharBanner, StepWeaponBanner } from './GameFormSteps';
import { COLORS } from '../../../shared/components/ColorPicker';
import ConfirmDialog from '../../../shared/components/ConfirmDialog';
import { useAccent } from '../../../shared/contexts/AccentContext';
import { useT } from '../../../shared/i18n';
import '../../../shared/components/Modal.css';
import { ScrollArea } from '../../../shared/components/ScrollArea';

const DEFAULT_FORM = {
  name: '',
  color: COLORS[0],
  usesAppColor: true,
  iconDataUrl: '',
  linkedDatabase: null,
  uid: '',
  currencyName: '',
  costPerPull: 160,
  pullItemName: '',
  charBaseRate: 0.6,
  charSoftPity: 74,
  charHardPity: 90,
  has5050: true,
  charFeaturedChance: 50,
  guaranteeCarryOver: true,
  weaponBaseRate: 0.7,
  weaponSoftPity: 63,
  weaponHardPity: 80,
  weaponHas5050: true,
  weaponFeaturedChance: 75,
  weaponGuaranteeCarryOver: true,
  specialMechanicId: 'none',
  specialMechanicConfig: {},
};

export default function AddGameModal({ onAdd, onClose, activeGames }) {
  const t = useT();
  const accentColor = useAccent();
  const [step, setStep] = useState(1);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [nameError, setNameError] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const pendingAction = useRef(null);

  const TOTAL_STEPS = form.linkedDatabase ? 1 : 4;

  const trimmedUid = form.uid.trim();
  const uidFormatError = trimmedUid && form.linkedDatabase
    ? (parseUid(trimmedUid, form.linkedDatabase).error ?? null)
    : null;
  const uidConflict = form.linkedDatabase && (activeGames ?? []).some(g =>
    g.linkedDatabase === form.linkedDatabase && (g.uid || 'default') === (trimmedUid || 'default')
  );
  const uidError = uidFormatError
    ? uidFormatError
    : uidConflict
      ? 'Another game already uses this database + UID.'
      : null;

  function startClose(action) {
    pendingAction.current = action;
    setIsClosing(true);
  }

  function requestClose() { setShowCloseConfirm(true); }
  function confirmClose() { startClose(onClose); }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !showCloseConfirm) setShowCloseConfirm(true); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCloseConfirm]);

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }));
    if (key === 'name' && nameError) setNameError(false);
  }

  function handleNext() {
    if (step === 1) {
      if (!form.name.trim()) { setNameError(true); return; }
      if (uidError) return;
    }
    setNameError(false);
    setStep(s => s + 1);
  }

  function handleSubmit() {
    if (!form.name.trim() || uidError) return;

    let game = createGame({
      name: form.name.trim(),
      color: form.color,
      usesAppColor: form.usesAppColor,
      iconPath: form.iconDataUrl,
    });

    if (form.linkedDatabase) {
      game = applyDatabaseLink(game, form.linkedDatabase);
      if (trimmedUid) game = { ...game, uid: trimmedUid };
    } else {
      const currencyName = form.currencyName.trim();
      const costPerPull = Number(form.costPerPull);
      game = {
        ...game,
        pullItemName: form.pullItemName.trim(),
        charBanner: {
          ...game.charBanner,
          currencyName, costPerPull,
          baseRate: Number(form.charBaseRate) / 100,
          softPity: Number(form.charSoftPity),
          hardPity: Number(form.charHardPity),
          has5050: form.has5050,
          featuredChance: Number(form.charFeaturedChance) / 100,
          guaranteeCarryOver: form.guaranteeCarryOver,
        },
        weaponBanner: {
          ...game.weaponBanner,
          currencyName, costPerPull,
          baseRate: Number(form.weaponBaseRate) / 100,
          softPity: Number(form.weaponSoftPity),
          hardPity: Number(form.weaponHardPity),
          has5050: form.weaponHas5050,
          featuredChance: Number(form.weaponFeaturedChance) / 100,
          guaranteeCarryOver: form.weaponGuaranteeCarryOver,
          specialMechanicId: form.specialMechanicId,
          specialMechanicConfig: form.specialMechanicConfig,
        },
      };
    }
    startClose(() => onAdd(game));
  }

  return (
    <>
      <motion.div
        className="modal-overlay modal-overlay--motion"
        initial={{ opacity: 0 }}
        animate={{ opacity: isClosing ? 0 : 1 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        onAnimationComplete={() => {
          if (isClosing && pendingAction.current) pendingAction.current();
        }}
      >
        <motion.div
          className="modal modal--wizard"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: isClosing ? 0 : 1, y: isClosing ? 12 : 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <div className="modal-header">
            <div>
              <h2 className="modal-title">{t('Add game')}</h2>
              <p className="modal-subtitle">{t('Step')} {step} {t('of')} {TOTAL_STEPS}</p>
            </div>
            <button className="modal-close" onClick={requestClose}><X size={18} /></button>
          </div>
          <div className="modal-progress" style={{ background: accentColor + '44' }}>
            <div className="modal-progress-fill" style={{ width: `${(step / TOTAL_STEPS) * 100}%`, background: accentColor }} />
          </div>
          <ScrollArea style={{ flex: 1 }} viewportClassName="modal-body">
            {step === 1 && (
              <StepBasic
                form={form} set={set} nameError={nameError}
                linkedDatabase={form.linkedDatabase}
                showDatabaseSelect
                uidError={uidError}
              />
            )}
            {step === 2 && <StepCurrency form={form} set={set} />}
            {step === 3 && <StepCharBanner form={form} set={set} />}
            {step === 4 && <StepWeaponBanner form={form} set={set} />}
          </ScrollArea>
          <div className="modal-footer">
            {step > 1 && <button className="btn btn-ghost" onClick={() => setStep(s => s - 1)}>{t('Back')}</button>}
            <div style={{ flex: 1 }} />
            {step < TOTAL_STEPS
              ? <button className="btn btn-primary" onClick={handleNext} disabled={!!uidError}>{t('Next')}</button>
              : <button className="btn btn-primary" onClick={handleSubmit} disabled={!form.name.trim() || !!uidError}>{t('Add game')}</button>
            }
          </div>
        </motion.div>
      </motion.div>
      <AnimatePresence>
        {showCloseConfirm && (
          <ConfirmDialog
            key="add-close-confirm"
            title={t('Discard changes?')}
            message={t("You haven't finished adding the game. Are you sure you want to close?")}
            confirmLabel={t('Close')} danger
            onConfirm={confirmClose}
            onCancel={() => setShowCloseConfirm(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
