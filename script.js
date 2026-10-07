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

  // ---------- Fondo estrellado: constelaciones que se transforman (Tauro <-> Libra) ----------
  const sky = new THREE.Group();
  scene.add(sky);   // fuera de "root": el fondo no gira con el corazón
  const SKY_Z = -30;
  const SLOTS = 20; // ambas constelaciones usan los mismos 20 "puntos": cada estrella migra a su nueva posición

  // [ascensión recta (h), declinación (°), brillo]
  const CONSTELLATIONS = {
    tauro: {
      label: '♉ Tauro · 05/05/2007',
      main: [
        [4.599, 16.51, 1.0],   // 0 Aldebarán
        [5.438, 28.61, 0.9],   // 1 Elnath
        [5.627, 21.14, 0.65],  // 2 Tianguan
        [4.477, 19.18, 0.65],  // 3 Ain
        [4.330, 15.63, 0.6],   // 4 γ
        [4.382, 17.54, 0.55],  // 5 δ1
        [4.478, 15.87, 0.7],   // 6 θ2
        [4.011, 12.49, 0.5],   // 7 λ
        [3.413, 9.03, 0.45],   // 8 ο
        [3.453, 9.73, 0.45],   // 9 ξ
        [3.791, 24.11, 0.7],   // 10 Alcyone (Pléyades)
      ],
      edges: [[2,0],[0,6],[6,4],[4,5],[5,3],[3,1],[4,7],[7,9],[9,8],[0,5]],
      cluster: 10,             // las estrellas sobrantes forman las Pléyades
    },
    libra: {
      label: '♎ Libra',
      main: [
        [14.848, -16.04, 0.9], // 0 Zubenelgenubi
        [15.283, -9.38, 0.9],  // 1 Zubeneschamali
        [15.592, -14.79, 0.6], // 2 Zubenelhakrabi
        [15.068, -25.28, 0.55],// 3 σ
        [15.617, -28.13, 0.5], // 4 υ
        [15.645, -29.78, 0.5], // 5 τ
        [15.000, -8.52, 0.6],  // 6 δ
        [15.898, -16.73, 0.45],// 7 θ
      ],
      edges: [[0,1],[1,2],[2,4],[4,3],[3,0],[1,6],[4,5],[2,7],[0,1],[1,2]],
      cluster: -1,
    },
  };

  // Proyecta a un plano, centra y escala cada constelación para que ocupe un recuadro similar
  function buildConstellation(c) {
    const ra0 = c.main.reduce((a, s) => a + s[0], 0) / c.main.length;
    const dec0 = c.main.reduce((a, s) => a + s[1], 0) / c.main.length;
    const proj = (ra, dec) => [(ra0 - ra) * 15 * Math.cos(dec0 * Math.PI / 180), dec - dec0];
    const pts = c.main.map(([ra, dec, b]) => [...proj(ra, dec), b]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const sc = Math.min(30 / w, 17 / h);
    const slots = pts.map(([x, y, b]) => [(x - cx) * sc, (y - cy) * sc, b]);
    // estrellas sobrantes: cúmulo (Pléyades) o polvo estelar alrededor de la figura
    while (slots.length < SLOTS) {
      const base = c.cluster >= 0 ? slots[c.cluster] : slots[Math.floor(Math.random() * c.main.length)];
      const r = c.cluster >= 0 ? 1.3 : 3.2;
      slots.push([base[0] + (Math.random() - 0.5) * r * 2, base[1] + (Math.random() - 0.5) * r * 2, 0.15 + Math.random() * 0.15]);
    }
    return { slots, edges: c.edges, label: c.label };
  }
  const CA = buildConstellation(CONSTELLATIONS.tauro);
  const CB = buildConstellation(CONSTELLATIONS.libra);

  // estrellas de la constelación (interpolación A -> B en el shader)
  const cpA = new Float32Array(SLOTS * 3), cpB = new Float32Array(SLOTS * 3);
  const cSz = new Float32Array(SLOTS * 2), cAl = new Float32Array(SLOTS * 2), cId = new Float32Array(SLOTS);
  for (let i = 0; i < SLOTS; i++) {
    cpA.set([CA.slots[i][0], CA.slots[i][1], SKY_Z], i * 3);
    cpB.set([CB.slots[i][0], CB.slots[i][1], SKY_Z], i * 3);
    const bA = CA.slots[i][2], bB = CB.slots[i][2];
    cSz.set([10 + bA * 14, 10 + bB * 14], i * 2);
    cAl.set([0.7 + bA * 0.3, 0.7 + bB * 0.3], i * 2);
    cId[i] = i;
  }
  const cGeo = new THREE.BufferGeometry();
  cGeo.setAttribute('position', new THREE.BufferAttribute(cpA, 3));
  cGeo.setAttribute('aPosB', new THREE.BufferAttribute(cpB, 3));
  cGeo.setAttribute('aSz', new THREE.BufferAttribute(cSz, 2));
  cGeo.setAttribute('aAl', new THREE.BufferAttribute(cAl, 2));
  cGeo.setAttribute('aId', new THREE.BufferAttribute(cId, 1));
  const glowFrag = /* glsl */`
    varying float vA; varying vec3 vTint;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if (d > 0.5) discard;
      float g = pow(smoothstep(0.5, 0.0, d), 2.2);
      gl_FragColor = vec4(vTint * g, g * vA);
    }`;
  const consMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: DPR }, uMix: { value: 0 } },
    vertexShader: /* glsl */`
      attribute vec3 aPosB; attribute vec2 aSz; attribute vec2 aAl; attribute float aId;
      uniform float uTime; uniform float uPx; uniform float uMix;
      varying float vA; varying vec3 vTint;
      void main() {
        float h = fract(sin(aId * 12.9898) * 43758.5453);
        float arc = sin(3.14159265 * uMix);
        // cada estrella viaja en una curva distinta (suave y orgánica) hacia su nuevo sitio
        vec3 p = mix(position, aPosB, uMix);
        p.xy += vec2(cos(h * 6.2831 + uTime * 0.4), sin(h * 6.2831 + uTime * 0.4)) * arc * (1.5 + h * 2.5);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        float sz = mix(aSz.x, aSz.y, uMix);
        gl_PointSize = sz * uPx * (1.0 + 0.35 * arc);
        vA = mix(aAl.x, aAl.y, uMix) * (0.8 + 0.2 * sin(uTime * (1.0 + h * 1.5) + h * 40.0)) * (1.0 - 0.25 * arc);
        vTint = h < 0.5 ? vec3(0.8, 0.9, 1.0) : vec3(1.0, 0.92, 0.85);
      }`,
    fragmentShader: glowFrag,
  });
  const consPts = new THREE.Points(cGeo, consMat);
  consPts.frustumCulled = false;
  consPts.renderOrder = -2;
  sky.add(consPts);

  // líneas: se desvanecen mientras las estrellas migran y reaparecen con la nueva figura
  const lA = [], lB = [];
  CA.edges.forEach((e, i) => {
    const eb = CB.edges[i];
    for (const k of [0, 1]) {
      lA.push(CA.slots[e[k]][0], CA.slots[e[k]][1], SKY_Z);
      lB.push(CB.slots[eb[k]][0], CB.slots[eb[k]][1], SKY_Z);
    }
  });
  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute('position', new THREE.Float32BufferAttribute(lA, 3));
  lGeo.setAttribute('aPosB', new THREE.Float32BufferAttribute(lB, 3));
  const lineMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uMix: { value: 0 } },
    vertexShader: /* glsl */`
      attribute vec3 aPosB; uniform float uMix; varying float vA;
      void main() {
        vec3 p = mix(position, aPosB, uMix);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        vA = 0.35 * pow(abs(2.0 * uMix - 1.0), 2.0);
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main() { gl_FragColor = vec4(vec3(0.5, 0.66, 1.0) * vA, vA); }`,
  });
  const lines = new THREE.LineSegments(lGeo, lineMat);
  lines.frustumCulled = false;
  lines.renderOrder = -3;
  sky.add(lines);

  // estrellas de fondo: miles, de brillo variable pero siempre menor que la constelación
  const bg = [];   // x, y, z, size, alpha
  for (let i = 0; i < 9000; i++) {
    const x = (Math.random() * 2 - 1) * 65, y = (Math.random() * 2 - 1) * 42;
    const z = SKY_Z - Math.random() * 15;
    const big = Math.random() < 0.1;
    bg.push(x, y, z, big ? 3.2 + Math.random() * 1.8 : 1.4 + Math.random() * 1.8, big ? 0.45 + Math.random() * 0.2 : 0.22 + Math.random() * 0.3);
  }
  const sp = new Float32Array(bg.length / 5 * 3), ss = new Float32Array(bg.length / 5), sa = new Float32Array(bg.length / 5);
  for (let i = 0; i < ss.length; i++) {
    sp[i * 3] = bg[i * 5]; sp[i * 3 + 1] = bg[i * 5 + 1]; sp[i * 3 + 2] = bg[i * 5 + 2];
    ss[i] = bg[i * 5 + 3]; sa[i] = bg[i * 5 + 4];
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(ss, 1));
  starGeo.setAttribute('aAlpha', new THREE.BufferAttribute(sa, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: DPR } },
    vertexShader: /* glsl */`
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
    fragmentShader: glowFrag,
  });
  const starPts = new THREE.Points(starGeo, starMat);
  starPts.frustumCulled = false;
  starPts.renderOrder = -4;
  sky.add(starPts);

  // ciclo: Tauro (pausa) -> Libra (pausa) -> Tauro ...
  const HOLD = 14, MORPH = 5;
  const CYCLE = 2 * (HOLD + MORPH);
  const ease = (x) => x * x * x * (x * (x * 6 - 15) + 10);   // smootherstep
  const skyMix = (time) => {
    const t = time % CYCLE;
    if (t < HOLD) return 0;
    if (t < HOLD + MORPH) return ease((t - HOLD) / MORPH);
    if (t < 2 * HOLD + MORPH) return 1;
    return 1 - ease((t - 2 * HOLD - MORPH) / MORPH);
  };
  const sign = document.getElementById('sign') || document.createElement('div');
  let signShown = 'A';
  function updateSign(mix) {
    const want = mix < 0.5 ? 'A' : 'B';
    if (want === signShown) return;
    signShown = want;
    sign.style.opacity = 0;
    setTimeout(() => { sign.textContent = want === 'A' ? CA.label : CB.label; sign.style.opacity = 1; }, 700);
  }

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
    sky.scale.setScalar(THREE.MathUtils.clamp(visW * 0.95 / 32, 0.55, 1.25));
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
  // Hombre joven (26 años) en reposo: ~62 lpm (ciclo ≈ 0.97 s), con una leve variación natural al respirar.
  const BPM = 62;
  const bump = (p, c, w) => Math.exp(-Math.pow((p - c) / w, 2));
  let beat = 0, beatPhase = 0;   // beatPhase: 0..1 dentro de cada ciclo
  function beatTarget(p) {
    // "lub" (sístole) más fuerte, "dub" más suave, y reposo hasta el siguiente latido
    return Math.min(1, bump(p, 0.10, 0.075) + 0.6 * bump(p, 0.38, 0.09));
  }

  // ---------- Bucle ----------
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;

    const bpm = BPM * (1 + 0.04 * Math.sin(time * 0.9));   // arritmia sinusal respiratoria (±4 %)
    beatPhase = (beatPhase + dt * bpm / 60) % 1;
    const target = beatTarget(beatPhase);
    beat += (target - beat) * Math.min(1, dt * 13);       // suavizado: sin cambios bruscos

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
    const mix = skyMix(time);
    consMat.uniforms.uTime.value = time;
    consMat.uniforms.uMix.value = mix;
    lineMat.uniforms.uMix.value = mix;
    updateSign(mix);
    ambient.material.uniforms.uBeat.value = beat;

    // leve balanceo de cámara para dar sensación cinematográfica
    camera.position.x = Math.sin(time * 0.15) * 0.35;
    camera.position.y = 0.4 + Math.sin(time * 0.2) * 0.15;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }
  animate();
})();
