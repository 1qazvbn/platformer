(function () {
  const canvas = document.getElementById('game');
  const starfield = initStarfield(canvas);
  starfield.start();

  const loader = document.getElementById('loading-screen');
  if (loader) loader.style.display = 'none';

  const DIFF_KEY = 'platformer.difficulty.v1';
  const DIFF_FACTORS = { Easy: 1.0, Normal: 1.6, Hard: 2.2 };

  const menu = document.createElement('div');
  menu.id = 'main-menu';
  menu.innerHTML = `
    <div id="screen-start" class="menu-screen">
      <h1 class="menu-title">SLIME CUBE</h1>
      <div class="menu-buttons">
        <button class="menu-btn" data-action="play">Start</button>
        <button class="menu-btn" data-action="settings">Settings</button>
      </div>
    </div>
    <div id="screen-levels" class="menu-screen hidden">
      <h1 class="menu-title">Select Level</h1>
      <div class="menu-buttons">
        <button class="menu-btn level-btn" data-level="1">Level 1 (Platformer)</button>
        <button class="menu-btn level-btn" data-level="2">Level 2 (Roguelike)</button>
      </div>
      <p class="menu-hint">Press 1 or 2 • Enter to confirm</p>
    </div>
    <div id="screen-settings" class="menu-screen hidden">
      <div class="difficulty-options">
        ${Object.keys(DIFF_FACTORS)
          .map(
            (d) =>
              `<label><input type="radio" name="difficulty" value="${d}">${d}</label>`,
          )
          .join('')}
      </div>
      <button class="menu-btn" data-action="back">Back</button>
    </div>
  `;
  document.body.appendChild(menu);

  const screens = {
    start: document.getElementById('screen-start'),
    levels: document.getElementById('screen-levels'),
    settings: document.getElementById('screen-settings'),
  };

  let currentScreen = 'start';
  let buttons = Array.from(screens[currentScreen].querySelectorAll('.menu-btn'));
  let selected = 0;

  function updateSelection() {
    buttons.forEach((b, i) => {
      if (i === selected) b.classList.add('selected');
      else b.classList.remove('selected');
    });
    buttons[selected]?.focus();
  }

  function show(screen) {
    currentScreen = screen;
    Object.entries(screens).forEach(([k, el]) => {
      el.classList.toggle('hidden', k !== screen);
    });
    buttons = Array.from(screens[screen].querySelectorAll('.menu-btn'));
    selected = 0;
    updateSelection();
  }

  function startLevel(level) {
    active = false;
    document.removeEventListener('keydown', onKeyDown);
    starfield.dispose();
    menu.remove();
    bootLevel(level);
  }

  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('.menu-btn');
    if (!btn) return;
    if (btn.dataset.level) startLevel(btn.dataset.level);
    else if (btn.dataset.action === 'play') show('levels');
    else if (btn.dataset.action === 'settings') show('settings');
    else if (btn.dataset.action === 'back') show('start');
  });

  function onKeyDown(e) {
    if (currentScreen === 'levels') {
      if (e.key === '1') {
        selected = 0;
        updateSelection();
        startLevel('1');
      } else if (e.key === '2') {
        selected = 1;
        updateSelection();
        startLevel('2');
      } else if (e.key === 'ArrowUp') {
        selected = (selected + buttons.length - 1) % buttons.length;
        updateSelection();
      } else if (e.key === 'ArrowDown') {
        selected = (selected + 1) % buttons.length;
        updateSelection();
      } else if (e.key === 'Enter') {
        startLevel(buttons[selected].dataset.level);
      } else if (e.key === 'Escape') {
        show('start');
      }
    } else if (currentScreen === 'start') {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        selected = (selected + buttons.length - 1) % buttons.length;
        updateSelection();
      } else if (e.key === 'Enter') {
        const btn = buttons[selected];
        if (btn.dataset.action === 'play') show('levels');
        else if (btn.dataset.action === 'settings') show('settings');
      }
    } else if (currentScreen === 'settings') {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        show('start');
      }
    }
  }
  document.addEventListener('keydown', onKeyDown);

  let gpIndex = null;
  let gpPrev = { up: false, down: false, start: false, back: false };
  window.addEventListener('gamepadconnected', (e) => {
    gpIndex = e.gamepad.index;
  });
  let active = true;
  function pollGamepad() {
    if (!active) return;
    if (gpIndex !== null) {
      const gp = navigator.getGamepads()[gpIndex];
      if (gp) {
        const up = gp.buttons[12]?.pressed;
        const down = gp.buttons[13]?.pressed;
        const start = gp.buttons[9]?.pressed || gp.buttons[0]?.pressed;
        const back = gp.buttons[8]?.pressed || gp.buttons[1]?.pressed;
        if (up && !gpPrev.up) {
          selected = (selected + buttons.length - 1) % buttons.length;
          updateSelection();
        }
        if (down && !gpPrev.down) {
          selected = (selected + 1) % buttons.length;
          updateSelection();
        }
        if (start && !gpPrev.start) {
          const btn = buttons[selected];
          if (btn.dataset.level) startLevel(btn.dataset.level);
          else if (btn.dataset.action === 'play') show('levels');
          else if (btn.dataset.action === 'settings') show('settings');
          else if (btn.dataset.action === 'back') show('start');
        }
        if (back && !gpPrev.back) {
          if (currentScreen === 'levels' || currentScreen === 'settings') show('start');
        }
        gpPrev = { up, down, start, back };
      }
    }
    requestAnimationFrame(pollGamepad);
  }
  pollGamepad();

  const diffRadios = menu.querySelectorAll('input[name="difficulty"]');
  diffRadios.forEach((r) =>
    r.addEventListener('change', (e) => {
      localStorage.setItem(DIFF_KEY, e.target.value);
    }),
  );
  const saved = menu.querySelector(
    `input[name="difficulty"][value="${localStorage.getItem(DIFF_KEY) || 'Easy'}"]`,
  );
  if (saved) saved.checked = true;

  show('start');
})();

