// ============================================================
// TOOLBAR ICONS — inline SVG glyphs injected into each mode button's swatch.
// ============================================================
// Tiny single-color silhouettes (16×16). They overlay the existing colored
// swatches so the button keeps its glow / cooldown bar / locked padlock and
// gains a recognizable shape. Stroke / fill use currentColor so each icon
// inherits the swatch's foreground tint.

// Each entry is the SVG body (path / shapes inside a viewBox 0 0 16 16).
const ICONS = {
  // --- ROOMS ---
  dig:       '<path d="M3 13 L8 4 L13 13 Z" fill="currentColor"/>',                                  // pickaxe / mound
  treasury:  '<circle cx="8" cy="10" r="4" fill="currentColor"/><rect x="6" y="3" width="4" height="3" fill="currentColor"/>',  // chest
  lair:      '<path d="M3 12 Q3 6 8 6 Q13 6 13 12 Z" fill="currentColor"/>',                          // cocoon dome
  hatchery:  '<ellipse cx="8" cy="9" rx="4" ry="5" fill="currentColor"/><circle cx="6" cy="7" r="1" fill="#000"/>', // egg
  training:  '<rect x="3" y="7" width="10" height="2" fill="currentColor"/><rect x="2" y="5" width="2" height="6" fill="currentColor"/><rect x="12" y="5" width="2" height="6" fill="currentColor"/>', // dumbbell
  library:   '<rect x="3" y="3" width="3" height="10" fill="currentColor"/><rect x="7" y="4" width="3" height="9" fill="currentColor"/><rect x="11" y="3" width="2" height="10" fill="currentColor"/>', // books
  workshop:  '<rect x="3" y="9" width="10" height="2" fill="currentColor"/><rect x="6" y="3" width="4" height="6" fill="currentColor"/><polygon points="2,11 14,11 12,14 4,14" fill="currentColor"/>', // anvil
  prison:    '<rect x="3" y="3" width="2" height="10" fill="currentColor"/><rect x="7" y="3" width="2" height="10" fill="currentColor"/><rect x="11" y="3" width="2" height="10" fill="currentColor"/><rect x="2" y="3" width="12" height="1.5" fill="currentColor"/>',   // bars
  torture:   '<path d="M2 13 L8 3 L14 13 Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="10" r="1.6" fill="currentColor"/>',  // rack/triangle
  // --- FEATURES ---
  door_wood:  '<rect x="4" y="2" width="8" height="12" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-width="1"/><circle cx="10.5" cy="8" r="0.8" fill="currentColor"/>',
  door_steel: '<rect x="3" y="2" width="10" height="12" fill="currentColor"/><line x1="3" y1="6" x2="13" y2="6" stroke="#000" stroke-width="1"/><line x1="3" y1="10" x2="13" y2="10" stroke="#000" stroke-width="1"/>',
  // --- TRAPS ---
  trap_spike:    '<polygon points="2,13 5,4 8,13 11,4 14,13" fill="currentColor"/>',
  trap_lightning:'<polygon points="9,2 4,9 7,9 5,14 12,7 9,7 11,2" fill="currentColor"/>',
  // --- TOOLS ---
  hand:      '<path d="M5 5 L5 10 Q5 13 8 13 Q11 13 11 10 L11 6 L11 4 L9 4 L9 8 L8 8 L8 3 L7 3 L7 8 L6 8 L6 4 L5 4 Z" fill="currentColor"/>',  // grasping hand
  // --- SPELLS ---
  heal:       '<rect x="3" y="6" width="10" height="4" fill="currentColor"/><rect x="6" y="3" width="4" height="10" fill="currentColor"/>',     // plus
  lightning:  '<polygon points="9,2 4,9 7,9 5,14 12,7 9,7 11,2" fill="currentColor"/>',
  callToArms: '<polygon points="3,3 13,7 3,11 5,7" fill="currentColor"/><line x1="3" y1="3" x2="3" y2="14" stroke="currentColor" stroke-width="1.4"/>',  // banner
  haste:      '<polygon points="4,3 13,8 4,13 7,8" fill="currentColor"/><polygon points="2,5 5,8 2,11" fill="currentColor"/>',                // double arrow
  createImp:  '<circle cx="8" cy="6" r="3" fill="currentColor"/><polygon points="5,3 6,1 7,3" fill="currentColor"/><polygon points="9,3 10,1 11,3" fill="currentColor"/><rect x="6" y="9" width="4" height="4" fill="currentColor"/>',  // imp head + horns
  possess:    '<path d="M8 2 Q4 2 4 7 Q4 10 6 12 L6 14 L10 14 L10 12 Q12 10 12 7 Q12 2 8 2 Z" fill="currentColor"/><circle cx="6.5" cy="7" r="0.8" fill="#000"/><circle cx="9.5" cy="7" r="0.8" fill="#000"/>',  // skull
  sight:      '<path d="M2 8 Q8 2 14 8 Q8 14 2 8 Z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/>',  // eye
};

export function applyToolbarIcons() {
  const buttons = document.querySelectorAll('#toolbar .mode-btn[data-mode]');
  buttons.forEach(btn => {
    const mode = btn.dataset.mode;
    const svg = ICONS[mode];
    if (!svg) return;
    const swatch = btn.querySelector('.swatch');
    if (!swatch) return;
    // Replace the swatch contents with an inline SVG. The swatch keeps its
    // background color (acts as the icon's amber/blue/red plate); the SVG
    // foreground uses currentColor so we set color: <ink> via CSS.
    swatch.innerHTML = `<svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true">${svg}</svg>`;
    swatch.classList.add('has-icon');
  });
}
