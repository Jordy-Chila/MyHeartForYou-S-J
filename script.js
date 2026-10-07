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
  const HEART_COUNT = 9000;
  const hPos = new Float32Array(HEART_COUNT * 3);
  const hSeed = new Float32Array(HEART_COUNT * 4);
  const K = 0.2;       // escala del contorno (x en [-16,16] -> ±3.2)
  const T = 2.3;       // grosor máximo (profundidad)
  for (let n = 0; n < HEART_COUNT; n++) {
    const t = Math.random() * Math.PI * 2;
    const hx = 16 * Math.pow(Math.sin(t), 3);
    const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    const r = Math.random();
    let s, z, shell = 1;
    if (r < 0.62) {                 // superficie en forma de almohada
      s = Math.pow(Math.random(), 0.45);
      z = (Math.random() < 0.5 ? -1 : 1) * T * Math.sqrt(Math.max(0, 1 - s * s)) + (Math.random() - 0.5) * 0.12;
    } else if (r < 0.80) {          // borde que define la silueta
      s = 1 - Math.random() * 0.03;
      z = (Math.random() - 0.5) * 0.35;
    } else {                        // pocas partículas interiores
      s = Math.sqrt(Math.random());
      z = (Math.random() * 2 - 1) * T * Math.sqrt(Math.max(0, 1 - s * s)) * 0.9;
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
        float sz = (1.5 + aSeed.x * 2.4) * (aSeed.w > 0.5 ? 1.0 : 0.7);
        gl_PointSize = sz * atten * uPx * (1.0 + 0.5 * uBeat);
        // gradiente romántico-futurista: magenta -> rosa -> toque cian en los bordes
        vec3 c1 = vec3(1.0, 0.12, 0.38);
        vec3 c2 = vec3(1.0, 0.45, 0.70);
        vec3 c3 = vec3(0.35, 0.75, 1.0);
        float m = clamp(p.y * 0.12 + 0.5 + sin(ph) * 0.15, 0.0, 1.0);
        vec3 col = mix(c1, c2, m);
        col = mix(col, c3, smoothstep(0.82, 1.0, aSeed.x) * 0.55);
        vColor = col * (0.75 + 0.9 * uBeat);
        vAlpha = tw * (aSeed.w > 0.5 ? 0.9 : 0.45);
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
    ambient.material.uniforms.uBeat.value = beat;

    // leve balanceo de cámara para dar sensación cinematográfica
    camera.position.x = Math.sin(time * 0.15) * 0.35;
    camera.position.y = 0.4 + Math.sin(time * 0.2) * 0.15;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }
  animate();
})();
