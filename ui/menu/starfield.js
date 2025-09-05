(function (global) {
  function initStarfield(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    let stars = [];
    let w = 0;
    let h = 0;
    const maxStars = () => Math.min(350, Math.floor(window.innerWidth * dpr / 3));

    function createStars() {
      stars = [];
      const count = maxStars();
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.5 + Math.random(),
          base: 0.3 + Math.random() * 0.7,
          amp: 0.15 + Math.random() * 0.15,
          phase: Math.random() * Math.PI * 2,
          freq: 0.5 + Math.random(),
        });
      }
    }

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.scale(dpr, dpr);
      createStars();
    }

    let rafId = 0;
    let running = false;

    function step(t) {
      if (!running) return;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      for (const s of stars) {
        const b = s.base + s.amp * Math.sin(t * 0.001 * s.freq + s.phase);
        ctx.globalAlpha = Math.min(1, Math.max(0, b));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        s.y += s.r * 0.05;
        if (s.y > h + s.r) {
          s.y = -s.r;
          s.x = Math.random() * w;
        }
      }
      ctx.globalAlpha = 1;
      rafId = requestAnimationFrame(step);
    }

    function start() {
      if (!running) {
        running = true;
        rafId = requestAnimationFrame(step);
      }
    }

    function stop() {
      running = false;
      cancelAnimationFrame(rafId);
    }

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else start();
    });
    resize();
    return { start, stop, resize };
  }
  global.initStarfield = initStarfield;
})(self);
