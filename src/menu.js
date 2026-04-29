// ============================================================
// MENU — start screen, pause menu, about overlay
// ============================================================
// Owns the modal screens and the GAME.paused flag they imply. Other modules
// read GAME.paused / GAME.started; this module is the only writer.
//
// Lifecycle:
//   bootstrap → showStartScreen() (paused, started=false)
//   click "New Game" → hideAll() (paused=false, started=true)
//   Esc during play → openPauseMenu() (paused=true)
//   click Resume / Esc again → hideAll() (paused=false)
//
// Esc handling lives here in capture phase so we beat input.js's bubble
// handler — that way Esc reliably toggles the menu without also dropping a
// held entity or resetting build mode.

import { GAME, handState, payDay, sim } from './state.js';
import { PAY_DAY_INTERVAL } from './constants.js';
import { playSfx } from './audio.js';

function _qs(id) { return document.getElementById(id); }

function _setVisible(id, vis) {
  const el = _qs(id);
  if (!el) return;
  el.classList.toggle('hidden', !vis);
}

function _hideAllScreens() {
  _setVisible('startScreen', false);
  _setVisible('pauseMenu', false);
  _setVisible('aboutScreen', false);
}

export function showStartScreen() {
  _hideAllScreens();
  _setVisible('startScreen', true);
  GAME.menuOpen = 'start';
  GAME.paused = true;
}

export function showAboutScreen(returnTo) {
  _hideAllScreens();
  _setVisible('aboutScreen', true);
  GAME.menuOpen = 'about';
  GAME.paused = true;
  // Stash where to go back to (start vs pause) via dataset on the about screen.
  const el = _qs('aboutScreen');
  if (el) el.dataset.returnTo = returnTo || 'start';
}

export function openPauseMenu() {
  if (!GAME.started || GAME.over) return;
  _hideAllScreens();
  _setVisible('pauseMenu', true);
  GAME.menuOpen = 'pause';
  GAME.paused = true;
  playSfx('whoosh', { minInterval: 200 });
}

export function hideAllScreens() {
  _hideAllScreens();
  GAME.menuOpen = null;
  GAME.paused = false;
}

export function startNewGame() {
  hideAllScreens();
  GAME.started = true;
  // Pay-day clock starts ticking from "now" — sim.time has been frozen on the
  // start screen, so the first wage event lands ~PAY_DAY_INTERVAL after
  // unpause regardless of how long the player lingered on the menu.
  payDay.lastAt = sim.time;
  payDay.nextAt = sim.time + PAY_DAY_INTERVAL;
  playSfx('confirm', { minInterval: 200 });
}

function _restart() {
  // Cheapest reset that's guaranteed to be clean — reload the page. Any
  // future progressive load (saves, settings) can override.
  window.location.reload();
}

function _gotoMainMenu() {
  // Same as restart for now (no save layer to preserve). Reloading lands the
  // player back on the start screen.
  _restart();
}

export function installMenu() {
  // Start screen buttons
  document.querySelectorAll('#startScreen [data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      if (a === 'start') startNewGame();
      else if (a === 'about') showAboutScreen('start');
    });
  });

  // Pause menu buttons
  document.querySelectorAll('#pauseMenu [data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      if (a === 'resume') hideAllScreens();
      else if (a === 'about') showAboutScreen('pause');
      else if (a === 'restart') _restart();
      else if (a === 'quit') _gotoMainMenu();
    });
  });

  // About screen buttons
  document.querySelectorAll('#aboutScreen [data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      if (a === 'back') {
        const el = _qs('aboutScreen');
        const back = (el && el.dataset.returnTo) || 'start';
        if (back === 'pause') openPauseMenu();
        else showStartScreen();
      }
    });
  });

  // Click-outside on pause menu = resume (matches DK2 esc-to-close-menu feel).
  const pauseEl = _qs('pauseMenu');
  if (pauseEl) {
    pauseEl.addEventListener('mousedown', (ev) => {
      // Only the dim backdrop counts as "outside"; the inner content shouldn't.
      if (ev.target === pauseEl || ev.target.classList.contains('screen-bg')) {
        hideAllScreens();
      }
    });
  }

  // Capture-phase Esc handler: open / close the pause menu before input.js
  // can drop held entities or reset build mode. We don't fight possession —
  // possession.js's Esc handler also runs in capture and exits its own state
  // (with stopPropagation) before we'd see the event.
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    // Don't intercept Esc during the start screen — there's nothing to pause.
    if (!GAME.started) return;
    // If a screen is open, close it.
    if (GAME.menuOpen === 'pause') {
      hideAllScreens();
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (GAME.menuOpen === 'about') {
      const el = _qs('aboutScreen');
      const back = (el && el.dataset.returnTo) || 'start';
      if (back === 'pause') openPauseMenu();
      else hideAllScreens();
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    // Otherwise, open the pause menu — but only if no entity is held in the
    // Hand. In that case let input.js handle Esc as "drop + cancel mode".
    if (handState.heldEntity) return;
    openPauseMenu();
    ev.preventDefault();
    ev.stopPropagation();
  }, true /* capture */);
}
