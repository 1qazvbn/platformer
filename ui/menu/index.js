(function () {
  const canvas = document.getElementById('game');
  const starfield = initStarfield(canvas);
  starfield.start();

  const menu = document.createElement('div');
  menu.id = 'main-menu';
  menu.innerHTML = `
    <h1 class="menu-title">SLIME CUBE</h1>
    <div class="menu-buttons">
      <button class="menu-btn" data-level="1">Level 1 (Platformer)</button>
      <button class="menu-btn" data-level="2">Level 2 (Roguelike)</button>
    </div>
    <p class="menu-hint">Press 1 or 2 • Enter to confirm</p>
  `;
  document.body.appendChild(menu);

  const buttons = Array.from(menu.querySelectorAll('.menu-btn'));
  let selected = 0;

  function updateSelection() {
    buttons.forEach((b, i) => {
      if (i === selected) b.classList.add('selected');
      else b.classList.remove('selected');
    });
    buttons[selected].focus();
  }

  function startLevel(level) {
    active = false;
    document.removeEventListener('keydown', onKeyDown);
    starfield.stop();
    menu.remove();
    bootLevel(level);
  }

  buttons.forEach((b, i) => {
    b.addEventListener('click', () => startLevel(b.dataset.level));
    b.addEventListener('mouseenter', () => {
      selected = i;
      updateSelection();
    });
  });

  function onKeyDown(e) {
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
    }
  }
  document.addEventListener('keydown', onKeyDown);

  let gpIndex = null;
  let gpPrev = { up: false, down: false, start: false };
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
        if (up && !gpPrev.up) {
          selected = (selected + buttons.length - 1) % buttons.length;
          updateSelection();
        }
        if (down && !gpPrev.down) {
          selected = (selected + 1) % buttons.length;
          updateSelection();
        }
        if (start && !gpPrev.start) {
          startLevel(buttons[selected].dataset.level);
        }
        gpPrev = { up, down, start };
      }
    }
    requestAnimationFrame(pollGamepad);
  }
  pollGamepad();

  updateSelection();
})();
