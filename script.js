(() => {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x000000, 1);
  document.body.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  const root = new THREE.Group();   // se controla con el mouse
  scene.add(root);

  // ---------- Corazón: contorno paramétrico con volumen tipo almohada ----------
  const HEART_COUNT = 18000;
  const hPos = new Float32Array(HEART_COUNT * 3);
  const hSeed = new Float32Array(HEART_COUNT * 4);
  const K = 0.2;       // escala del contorno (x en [-16,16] -> ±3.2)
  const T = 2.1;       // grosor máximo (profundidad)
  // Jacobiano del mapeo radial: muestrear t con esta densidad reparte las partículas de forma uniforme por área
  const heartX = (t) => 16 * Math.pow(Math.sin(t), 3);
  const heartY = (t) => 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  const jac = (t) => {
    const dx = 48 * Math.sin(t) * Math.sin(t) * Math.cos(t);
    const dy = -13 * Math.sin(t) + 10 * Math.sin(2 * t) + 6 * Math.sin(3 * t) + 4 * Math.sin(4 * t);
    return Math.abs(heartX(t) * dy - heartY(t) * dx);
  };
  let jMax = 0;
  for (let i = 0; i < 720; i++) jMax = Math.max(jMax, jac(i / 720 * Math.PI * 2));

  for (let n = 0; n < HEART_COUNT; n++) {
    let t;
    do { t = Math.random() * Math.PI * 2; } while (Math.random() * jMax > jac(t));
    const hx = heartX(t);
    const hy = heartY(t);
    const r = Math.random();
    let s, z, shell = 1;
    const prof = (q) => Math.sqrt(Math.max(0, 1 - q * q));
    if (r < 0.45) {                 // superficie con grosor (no una lámina fina)
      s = Math.sqrt(Math.random());
      const side = Math.random() < 0.5 ? -1 : 1;
      z = side * T * prof(s) * (0.82 + Math.random() * 0.18) + (Math.random() - 0.5) * 0.3;
    } else if (r < 0.60) {          // borde que define la silueta
      s = 1 - Math.random() * 0.05;
      z = (Math.random() - 0.5) * 0.7;
    } else {                        // relleno volumétrico suave
      s = Math.sqrt(Math.random());
      z = (Math.random() * 2 - 1) * T * prof(s) * 0.85;
      shell = 0;
    }
    hPos[n * 3] = hx * s * K;
    hPos[n * 3 + 1] = (hy * s + 2.5) * K;
    hPos[n * 3 + 2] = z;
    hSeed[n * 4] = Math.random();
    hSeed[n * 4 + 1] = Math.random() * 6.2831;
    hSeed[n * 4 + 2] = Math.random();
    hSeed[n * 4 + 3] = shell;
  }

  // ---------- Partículas ambientales ----------
  const AMB_COUNT = 900;
  const aPos = new Float32Array(AMB_COUNT * 3);
  const aSeed = new Float32Array(AMB_COUNT * 4);
  for (let i = 0; i < AMB_COUNT; i++) {
    const r = 4.2 + Math.pow(Math.random(), 0.8) * 5.5;
    const th = Math.random() * 6.2831;
    const ph = Math.acos(2 * Math.random() - 1);
    aPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    aPos[i * 3 + 1] = r * Math.cos(ph) * 0.8;
    aPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    aSeed[i * 4] = Math.random();
    aSeed[i * 4 + 1] = Math.random() * 6.2831;
    aSeed[i * 4 + 2] = Math.random();
    aSeed[i * 4 + 3] = 0;
  }

  const vertex = /* glsl */`
    attribute vec4 aSeed;          // x: rand, y: fase, z: rand2, w: cáscara(1)/interior(0)
    uniform float uTime;
    uniform float uBeat;
    uniform float uPx;
    uniform float uAmbient;
    varying float vAlpha;
    varying vec3 vColor;

    void main() {
      vec3 p = position;
      float t = uTime;
      float ph = aSeed.y;

      if (uAmbient < 0.5) {
        // vibración orgánica
        vec3 wob = vec3(
          sin(t * (0.7 + aSeed.x) + ph) + sin(t * 1.9 + ph * 2.3) * 0.4,
          sin(t * (0.8 + aSeed.z) + ph * 1.7) + sin(t * 2.1 + ph) * 0.4,
          sin(t * (0.6 + aSeed.x * aSeed.z) + ph * 0.6) + sin(t * 1.7 + ph * 3.1) * 0.4
        );
        p += wob * 0.045;
        // latido: todo el corazón crece y cada partícula se expande un poco distinto
        vec3 dir = normalize(p + vec3(0.0001));
        p *= 1.0 + 0.075 * uBeat;
        p += dir * uBeat * (0.06 + aSeed.x * 0.16);
      } else {
        // deriva aleatoria suave
        vec3 d = vec3(
          sin(t * 0.30 * (0.5 + aSeed.x) + ph),
          sin(t * 0.25 * (0.5 + aSeed.z) + ph * 1.9),
          cos(t * 0.28 * (0.5 + aSeed.x) + ph * 0.7)
        );
        p += d * (0.5 + aSeed.z * 0.9);
        p *= 1.0 + 0.02 * uBeat;
      }

      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;

      float depth = -mv.z;
      float atten = 9.0 / depth;                     // profundidad: lejos = más pequeño
      float tw = 0.7 + 0.3 * sin(t * 2.0 + ph * 3.0); // centelleo

      if (uAmbient < 0.5) {
        float sz = (1.7 + aSeed.x * 2.4) * (aSeed.w > 0.5 ? 1.0 : 0.8);
        gl_PointSize = sz * atten * uPx * (1.0 + 0.5 * uBeat);
        // gradiente romántico-futurista: magenta -> rosa -> toque cian en los bordes
        vec3 c1 = vec3(1.0, 0.12, 0.38);
        vec3 c2 = vec3(1.0, 0.45, 0.70);
        vec3 c3 = vec3(0.35, 0.75, 1.0);
        float m = clamp(p.y * 0.12 + 0.5 + sin(ph) * 0.15, 0.0, 1.0);
        vec3 col = mix(c1, c2, m);
        col = mix(col, c3, smoothstep(0.82, 1.0, aSeed.x) * 0.55);
        vColor = col * (0.75 + 0.9 * uBeat);
        vAlpha = tw * (aSeed.w > 0.5 ? 0.9 : 0.6);
      } else {
        gl_PointSize = (0.8 + aSeed.x * 1.6) * atten * uPx;
        vColor = mix(vec3(0.6, 0.8, 1.0), vec3(1.0, 0.6, 0.85), aSeed.z);
        vAlpha = tw * 0.45;
      }
    }
  `;
  const fragment = /* glsl */`
    varying float vAlpha;
    varying vec3 vColor;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if (d > 0.5) discard;
      float core = smoothstep(0.5, 0.0, d);
      float a = core * core * vAlpha;
      gl_FragColor = vec4(vColor * (0.6 + core), a);
    }
  `;

  const makeMaterial = (ambient) => new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uPx: { value: DPR * 1.6 },
      uAmbient: { value: ambient ? 1 : 0 },
    },
  });

  const makePoints = (pos, seed, ambient) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const pts = new THREE.Points(g, makeMaterial(ambient));
    pts.frustumCulled = false;
    return pts;
  };

  const heart = makePoints(hPos, hSeed, false);
  const ambient = makePoints(aPos, aSeed, true);
  root.add(heart);
  root.add(ambient);

  // ---------- Fondo estrellado: constelación de Tauro (nacimiento 05/05/2007) ----------
  const sky = new THREE.Group();
  scene.add(sky);   // fuera de "root": el fondo no gira con el corazón
  const SKY_Z = -30, KDEG = 1.1;
  const RA0 = 4.4, DEC0 = 19;
  const toXY = (raH, dec) => [(RA0 - raH) * 15 * Math.cos(DEC0 * Math.PI / 180) * KDEG, (dec - DEC0) * KDEG];
  // [ascensión recta (h), declinación (°), brillo]
  const TAU = {
    alpha: [4.599, 16.51, 1.0],  // Aldebarán
    beta:  [5.438, 28.61, 0.9],  // Elnath
    zeta:  [5.627, 21.14, 0.65], // Tianguan
    eps:   [4.477, 19.18, 0.65], // Ain
    gamma: [4.330, 15.63, 0.6],
    delta: [4.382, 17.54, 0.55],
    theta: [4.478, 15.87, 0.7],
    lambda:[4.011, 12.49, 0.5],
    omi:   [3.413, 9.03, 0.45],
    xi:    [3.453, 9.73, 0.45],
    alcyone:[3.791, 24.11, 0.7], // Pléyades
  };
  const LINES = [["zeta","alpha"],["alpha","theta"],["theta","gamma"],["gamma","delta"],["delta","eps"],
                 ["eps","beta"],["gamma","lambda"],["lambda","xi"],["xi","omi"],["alpha","delta"]];
  const stars = [];   // x, y, z, size, alpha
  const pos = {};
  for (const [k, [ra, dec, b]] of Object.entries(TAU)) {
    const [x, y] = toXY(ra, dec);
    pos[k] = [x, y, SKY_Z];
    stars.push(x, y, SKY_Z, 10 + b * 14, 0.7 + b * 0.3);
  }
  // cúmulo de las Pléyades: pequeñas estrellas alrededor de Alcyone
  for (let i = 0; i < 9; i++) {
    const [ax, ay] = toXY(3.791, 24.11);
    stars.push(ax + (Math.random() - 0.5) * 2.6, ay + (Math.random() - 0.5) * 2.6, SKY_Z, 4 + Math.random() * 3, 0.5);
  }
  // estrellas de fondo: miles, de brillo variable pero siempre menor que la constelación
  for (let i = 0; i < 9000; i++) {
    const x = (Math.random() * 2 - 1) * 65, y = (Math.random() * 2 - 1) * 42;
    const z = SKY_Z - Math.random() * 15;
    const q = Math.random();
    const big = q < 0.1;                          // algunas más brillantes (aun así < constelación)
    stars.push(x, y, z, big ? 3.2 + Math.random() * 1.8 : 1.4 + Math.random() * 1.8, big ? 0.45 + Math.random() * 0.2 : 0.22 + Math.random() * 0.3);
  }
  const sp = new Float32Array(stars.length / 5 * 3), ss = new Float32Array(stars.length / 5), sa = new Float32Array(stars.length / 5);
  for (let i = 0; i < ss.length; i++) {
    sp[i * 3] = stars[i * 5]; sp[i * 3 + 1] = stars[i * 5 + 1]; sp[i * 3 + 2] = stars[i * 5 + 2];
    ss[i] = stars[i * 5 + 3]; sa[i] = stars[i * 5 + 4];
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute("aSize", new THREE.BufferAttribute(ss, 1));
  starGeo.setAttribute("aAlpha", new THREE.BufferAttribute(sa, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: DPR } },
    vertexShader: `
      attribute float aSize; attribute float aAlpha;
      uniform float uTime; uniform float uPx;
      varying float vA; varying vec3 vTint;
      void main() {
        float h = fract(sin(dot(position.xy, vec2(12.9898, 78.233))) * 43758.5453);
        vTint = h < 0.6 ? vec3(0.75, 0.85, 1.0) : (h < 0.85 ? vec3(1.0, 0.95, 0.85) : vec3(1.0, 0.75, 0.85));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPx;
        vA = aAlpha * (0.6 + 0.4 * sin(uTime * (0.8 + h * 2.2) + h * 60.0));
      }`,
    fragmentShader: `
      varying float vA; varying vec3 vTint;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float g = pow(smoothstep(0.5, 0.0, d), 2.2);
        gl_FragColor = vec4(vTint * g, g * vA);
      }`,
  });
  const starPts = new THREE.Points(starGeo, starMat);
  starPts.frustumCulled = false;
  starPts.renderOrder = -2;
  sky.add(starPts);
  // líneas de la constelación (muy sutiles)
  const lp = [];
  for (const [a, b] of LINES) lp.push(...pos[a], ...pos[b]);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
    color: 0x7fa8ff, transparent: true, opacity: 0.35, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  lines.renderOrder = -3;
  sky.add(lines);

  // ---------- Resize / encuadre responsivo ----------
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    camera.aspect = w / h;
    // asegura que el corazón (~±3.4 de ancho) quepa tanto en pantallas anchas como en móviles
    const halfW = 4.4;
    const fovV = THREE.MathUtils.degToRad(camera.fov);
    const distH = 3.9 / Math.tan(fovV / 2);
    const distW = halfW / (Math.tan(fovV / 2) * camera.aspect);
    camera.position.set(0, 0.4, Math.max(distH, distW));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    // la constelación (≈34×21 u) se ajusta al ancho visible del fondo; en vertical se sube sobre el corazón
    const visH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (Math.abs(SKY_Z) + camera.position.z);
    const visW = visH * camera.aspect;
    sky.scale.setScalar(THREE.MathUtils.clamp(visW * 0.95 / 34, 0.55, 1.25));
    sky.position.y = camera.aspect < 1 ? THREE.MathUtils.clamp((1.1 - camera.aspect) * 16, 0, 9) : visH * 0.06;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Interacción: arrastre + giro manual con inercia ----------
  let rotY = 0, rotX = 0.12, velY = 0, velX = 0;
  let dragging = false, lastX = 0, lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    velY = dx * 0.006; velX = dy * 0.004;
    rotY += velY; rotX += velX;
    rotX = Math.max(-1.2, Math.min(1.2, rotX));
  });
  const endDrag = () => { dragging = false; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---------- Latido (lub-dub) con pausa ----------
  const bump = (t, c, w) => Math.exp(-Math.pow((t - c) / w, 2));
  const PERIOD = 1.7;
  let beat = 0;
  function beatTarget(time) {
    const t = time % PERIOD;
    return Math.min(1, bump(t, 0.12, 0.07) + 0.65 * bump(t, 0.38, 0.09));
  }

  // ---------- Bucle ----------
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;

    const target = beatTarget(time);
    beat += (target - beat) * Math.min(1, dt * 22); // suavizado para evitar saltos bruscos

    if (!dragging) {
      velY *= Math.pow(0.04, dt);       // inercia
      velX *= Math.pow(0.04, dt);
      rotY += velY;
      rotX += velX;
    }

    root.rotation.set(rotX, rotY, 0);
    heart.material.uniforms.uTime.value = time;
    heart.material.uniforms.uBeat.value = beat;
    ambient.material.uniforms.uTime.value = time;
    starMat.uniforms.uTime.value = time;
    ambient.material.uniforms.uBeat.value = beat;

    // leve balanceo de cámara para dar sensación cinematográfica
    camera.position.x = Math.sin(time * 0.15) * 0.35;
    camera.position.y = 0.4 + Math.sin(time * 0.2) * 0.15;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }
  animate();
})();
