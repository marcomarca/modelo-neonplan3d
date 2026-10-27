import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// State
let scene, camera, renderer, controls;
let modelRoot = null;
let meshes = [];
let initialTransforms = new Map();
let originalMaterials = new Map();
let neonMaterials = new Map();
let blueprintMaterials = new Map();
let wireframeMaterials = new Map();
let ghostMaterials = new Map();
let edgeLineObjects = [];
let currentTheme = 'realistic';
let needsRender = true;
let isAutoRotating = false;
let renderOnDemand = true;
let explodeDistance = 0;
let modelBounds = null;
let modelCenter = new THREE.Vector3();
let modelSize = new THREE.Vector3();

// Models configuration
const AVAILABLE_MODELS = {
  'unified': { name: 'Edificio Unificado (Multi-Planta)', file: 'unified', icon: '🏛️' },
  'building.glb': { name: 'Edificio Completo', file: '../building.glb', icon: '🏢' },
  'lobby.glb': { name: 'Lobby Witronix', file: '../lobby.glb', icon: '🏨' },
  'showroom.glb': { name: 'Showroom Multimedia', file: '../showroom.glb', icon: '💻' },
};

let currentModelFile = 'unified';

// Unification & Office Calibration State
let buildingGroup = null;
let lobbyGroup = null;
let showroomGroup = null;
let activeFloor = 'all';
let facadeXrayEnabled = true;
let focusedOffice = null; // null ('all') | 'lobby' | 'showroom'

// Default calibrated coordinates specified by user
let officeOffsets = {
  lobby: { x: 3.2, y: 2.2, z: -1.6, rotY: 0, scale: 1.0 },
  showroom: { x: -2.6, y: 2.4, z: -1.6, rotY: 0, scale: 1.0 },
};
let activeOfficeToCalibrate = 'lobby';

// Ultra-ghost material: casi invisible (3.5% opacidad) y sin depthWrite para no tapar oficinas
const ultraGhostMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x05101a,
  transparent: true,
  opacity: 0.035,
  roughness: 0.95,
  metalness: 0.05,
  depthWrite: false,
});

// Furniture / element filtering
let activeFurnitureGroup = 'all';
let isolationMode = 'isolate'; // 'isolate' | 'ghost' | 'focus'
let wallCutEnabled = true;

// FPS Counter
let lastTime = performance.now();
let frames = 0;
let fps = 60;

const container = document.getElementById('viewport-container');
const loaderEl = document.getElementById('loader');
const toastEl = document.getElementById('toast');

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  setTimeout(() => { toastEl.style.opacity = '0'; }, 2600);
}

function requestRender() {
  needsRender = true;
}

let ambientLight, dirLight, fillLight, bluePoint, magentaPoint;

function setupLighting() {
  ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
  scene.add(ambientLight);

  dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
  dirLight.position.set(70, 160, 90);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.bias = -0.0001;
  scene.add(dirLight);

  fillLight = new THREE.DirectionalLight(0xd8e8ff, 1.2);
  fillLight.position.set(-80, 80, -70);
  scene.add(fillLight);

  bluePoint = new THREE.PointLight(0x00e5ff, 1.8, 300);
  bluePoint.position.set(-60, 40, -40);
  scene.add(bluePoint);

  magentaPoint = new THREE.PointLight(0xff2a85, 1.4, 250);
  magentaPoint.position.set(70, 35, 60);
  scene.add(magentaPoint);
}

function init() {
  try {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1420);
    scene.fog = new THREE.FogExp2(0x0e1420, 0.003);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(120, 90, 160);

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI / 2 + 0.05;
    controls.minDistance = 1;
    controls.maxDistance = 1200;
    controls.addEventListener('change', () => requestRender());

    setupLighting();

    const grid = new THREE.GridHelper(400, 80, 0x00e5ff, 0x162c45);
    grid.position.y = -0.05;
    grid.material.opacity = 0.25;
    grid.material.transparent = true;
    scene.add(grid);

    // Read model from URL params if given e.g. ?model=building.glb
    const urlParams = new URLSearchParams(window.location.search);
    const paramModel = urlParams.get('model');
    if (paramModel && (paramModel in AVAILABLE_MODELS || AVAILABLE_MODELS[`${paramModel}.glb`])) {
      currentModelFile = AVAILABLE_MODELS[paramModel] ? paramModel : `${paramModel}.glb`;
    }

    const modelSelect = document.getElementById('model-select');
    if (modelSelect) modelSelect.value = currentModelFile;

    loadModelFile(currentModelFile);

    window.addEventListener('resize', onWindowResize);
    setupUIEvents();
    setupDragAndDrop();

    animate();
  } catch (err) {
    console.error('Initialization error:', err);
    if (loaderEl) {
      loaderEl.innerHTML = `<div style="color:#ff6b6b; padding:20px;">Error inicializando: ${err.message}</div>`;
    }
  }
}

async function loadModelFile(fileName) {
  currentModelFile = fileName;

  const unifSection = document.getElementById('unification-section');
  const pinsOverlay = document.getElementById('office-pins-overlay');

  if (fileName === 'unified') {
    if (unifSection) unifSection.classList.add('active');
    if (pinsOverlay) pinsOverlay.style.display = 'block';
    await loadUnifiedBuilding();
    return;
  }

  // Single model mode
  if (unifSection) unifSection.classList.remove('active');
  if (pinsOverlay) pinsOverlay.style.display = 'none';

  const config = AVAILABLE_MODELS[fileName] || { name: fileName, file: `../${fileName}` };

  if (loaderEl) {
    loaderEl.style.display = 'flex';
    loaderEl.style.opacity = '1';
    loaderEl.innerHTML = `
      <div class="spinner"></div>
      <div class="loading-text">Cargando <b>${config.name}</b>...</div>
      <div class="loading-subtext">Descargando y descomprimiendo modelo 3D con Draco...</div>`;
  }

  try {
    const res = await fetch(config.file);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    const subtext = document.querySelector('.loading-subtext');
    if (subtext) subtext.textContent = 'Generando mallas, materiales PBR y contornos Neón...';
    parseGLTFBuffer(arrayBuffer, config.name);
  } catch (err) {
    console.error('Fetch error:', err);
    if (loaderEl) {
      loaderEl.innerHTML = `
        <div style="text-align:center; padding:24px; max-width:420px; background:#0b1424; border:1px solid #00e5ff; border-radius:16px;">
          <div style="color:#ff6b6b; font-size:18px; font-weight:700; margin-bottom:10px;">Error de Carga</div>
          <p style="font-size:13px; color:#8faec9; margin-bottom:16px;">
            No se pudo descargar ${fileName} (${err.message}).
          </p>
          <label style="display:inline-block; background:#00e5ff; color:#041019; padding:10px 20px; border-radius:10px; font-weight:700; cursor:pointer;">
            📂 Seleccionar ${fileName} manualmente
            <input type="file" id="fallback-file-input" accept=".glb,.gltf" style="display:none;" />
          </label>
        </div>`;

      document.getElementById('fallback-file-input')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) {
          loaderEl.innerHTML = `
            <div class="spinner"></div>
            <div class="loading-text">Cargando <b>${file.name}</b>...</div>
            <div class="loading-subtext">Leyendo archivo local...</div>`;
          const reader = new FileReader();
          reader.onload = (evt) => parseGLTFBuffer(evt.target.result, file.name);
          reader.readAsArrayBuffer(file);
        }
      });
    }
  }
}

// Universal intelligent category classifier for any GLTF model
function classifyMesh(mesh) {
  const meshName = (mesh.name || '').toLowerCase();
  const matName = (mesh.material?.name || '').toLowerCase();
  const s = `${meshName} ${matName}`;

  if (s.includes('glass') || s.includes('translucent') || s.includes('vidrio') || s.includes('cristal') || meshName.startsWith('tr_')) {
    return 'glass';
  }
  if (s.includes('mirror') || s.includes('espejo')) {
    return 'mirror';
  }
  if (s.includes('samsung') || s.includes('tv') || s.includes('screen') || s.includes('pantalla') || s.includes('display') || s.includes('hdtv')) {
    return 'screen';
  }
  if (s.includes('lamp') || s.includes('light') || s.includes('luz') || s.includes('lampara') || s.includes('candelabro') || s.includes('吊灯') || s.includes('zmsj')) {
    return 'lighting';
  }
  if (s.includes('joy') || s.includes('chair') || s.includes('silla') || s.includes('seat') || s.includes('asiento') || s.includes('stool')) {
    return 'chairs';
  }
  if (s.includes('table') || s.includes('desk') || s.includes('mesa') || s.includes('escritorio') || s.includes('ahs_ap') || s.includes('counter')) {
    return 'tables';
  }
  if (s.includes('sofa') || s.includes('couch') || s.includes('fabric') || s.includes('linen') || s.includes('tela') || s.includes('cushion') || s.includes('vray_linen') || s.includes('vray_1linen')) {
    return 'upholstery';
  }
  if (s.includes('wood') || s.includes('oak') || s.includes('plywood') || s.includes('bamboo') || s.includes('cherry') || s.includes('madera') || s.includes('veneer') || s.includes('timber') || s.includes('tarima')) {
    return 'wood';
  }
  if (s.includes('aluminum') || s.includes('steel') || s.includes('metal') || s.includes('silver') || s.includes('gold') || s.includes('dorado') || s.includes('chrome') || s.includes('cromo') || s.includes('iron') || s.includes('hierro')) {
    return 'metal';
  }
  if (s.includes('blinds') || s.includes('persiana') || s.includes('curtain') || s.includes('cortina') || s.includes('roller')) {
    return 'blinds';
  }
  if (s.includes('grass') || s.includes('vegetation') || s.includes('plant') || s.includes('cesped') || s.includes('jardin') || s.includes('arbol') || s.includes('tree')) {
    return 'vegetation';
  }
  if (s.includes('sophie') || s.includes('shirt') || s.includes('person') || s.includes('mannequin') || s.includes('persona') || s.includes('human')) {
    return 'person';
  }
  if (s.includes('wall') || s.includes('pared') || s.includes('malla') || s.includes('corrugated') || s.includes('fachada') || s.includes('facade') || s.includes('concrete') || s.includes('hormigon') || s.includes('muro') || s.includes('color_m') || s.includes('color_d')) {
    return 'walls';
  }
  return 'structures';
}

function setupMeshPipeline(child, detectedCategories) {
  meshes.push(child);
  child.castShadow = true;
  child.receiveShadow = true;

  const cat = classifyMesh(child);
  child.userData.category = cat;
  if (detectedCategories) detectedCategories.add(cat);

  let tris = 0;
  if (child.geometry) {
    tris = child.geometry.index ? child.geometry.index.count / 3 : child.geometry.attributes.position.count / 3;

    try {
      const edgesGeo = new THREE.EdgesGeometry(child.geometry, 28);
      const edgeColor =
        child.userData.source === 'lobby' ? 0x00e5ff :
        child.userData.source === 'showroom' ? 0xff2a85 :
        cat === 'screen' || cat === 'lighting' ? 0xff2a85 :
        cat === 'vegetation' ? 0x00ff88 :
        cat === 'wood' ? 0xffb547 :
        cat === 'upholstery' ? 0x9d4edd : 0x00e5ff;

      const lineMat = new THREE.LineBasicMaterial({
        color: edgeColor,
        transparent: true,
        opacity: 0.82,
      });
      const line = new THREE.LineSegments(edgesGeo, lineMat);
      line.visible = false;
      child.add(line);
      edgeLineObjects.push(line);
    } catch (e) {}
  }

  initialTransforms.set(child, {
    pos: child.position.clone(),
    worldPos: child.getWorldPosition(new THREE.Vector3()),
  });

  originalMaterials.set(child, child.material);

  // 1. NeonPlan Style Material
  let neonMat;
  if (cat === 'glass') {
    neonMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a223a,
      transparent: true,
      opacity: 0.2,
      roughness: 0.1,
      metalness: 0.1,
      transmission: 0.7,
    });
  } else if (cat === 'mirror') {
    neonMat = new THREE.MeshStandardMaterial({
      color: 0x223650,
      roughness: 0.05,
      metalness: 0.95,
    });
  } else if (cat === 'screen') {
    neonMat = new THREE.MeshStandardMaterial({
      color: 0x080c14,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0xff2a85,
      emissiveIntensity: 0.6,
    });
  } else if (cat === 'lighting') {
    neonMat = new THREE.MeshStandardMaterial({
      color: 0x140e1a,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0xffb547,
      emissiveIntensity: 0.75,
    });
  } else if (cat === 'vegetation') {
    neonMat = new THREE.MeshStandardMaterial({
      color: 0x0d281e,
      roughness: 0.6,
      emissive: 0x00ff88,
      emissiveIntensity: 0.25,
    });
  } else if (cat === 'wood') {
    neonMat = new THREE.MeshStandardMaterial({
      color: 0x141f33,
      roughness: 0.7,
      metalness: 0.2,
      emissive: 0x1a2e4a,
      emissiveIntensity: 0.1,
    });
  } else if (cat === 'upholstery') {
    neonMat = new THREE.MeshStandardMaterial({
      color: 0x172138,
      roughness: 0.8,
      metalness: 0.1,
    });
  } else {
    neonMat = new THREE.MeshStandardMaterial({
      color: 0x0f1a2c,
      roughness: 0.45,
      metalness: 0.5,
    });
  }
  neonMaterials.set(child, neonMat);

  // 2. Blueprint Material
  const bpMat = new THREE.MeshStandardMaterial({
    color: 0x05152a,
    roughness: 0.3,
    metalness: 0.1,
    transparent: true,
    opacity: cat === 'glass' ? 0.12 : 0.85,
  });
  blueprintMaterials.set(child, bpMat);

  // 3. Wireframe Material
  const wfMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    wireframe: true,
    transparent: true,
    opacity: 0.35,
  });
  wireframeMaterials.set(child, wfMat);

  // 4. Ghost / X-Ray Material
  const ghostMat = new THREE.MeshStandardMaterial({
    color: 0x07111c,
    roughness: 0.9,
    transparent: true,
    opacity: 0.08,
  });
  ghostMaterials.set(child, ghostMat);

  return Math.round(tris);
}

// Unified Building Loader (Multi-Floor Composite Scene)
async function loadUnifiedBuilding() {
  currentModelFile = 'unified';
  const unifSection = document.getElementById('unification-section');
  if (unifSection) unifSection.classList.add('active');

  if (loaderEl) {
    loaderEl.style.display = 'flex';
    loaderEl.style.opacity = '1';
    loaderEl.innerHTML = `
      <div class="spinner"></div>
      <div class="loading-text">Ensamblando <b>Edificio Unificado</b>...</div>
      <div class="loading-subtext">Descargando Edificio Completo, Lobby y Showroom...</div>`;
  }

  try {
    const subtext = document.querySelector('.loading-subtext');
    const [resB, resL, resS] = await Promise.all([
      fetch('../building.glb'),
      fetch('../lobby.glb'),
      fetch('../showroom.glb')
    ]);

    if (!resB.ok || !resL.ok || !resS.ok) {
      throw new Error('No se pudieron descargar los 3 modelos');
    }

    if (subtext) subtext.textContent = 'Descomprimiendo geometrías Draco de cada salón...';

    const [bufB, bufL, bufS] = await Promise.all([
      resB.arrayBuffer(),
      resL.arrayBuffer(),
      resS.arrayBuffer()
    ]);

    const gltfLoader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('draco/');
    gltfLoader.setDRACOLoader(dracoLoader);

    const parseBuffer = (buf) => new Promise((resolve, reject) => gltfLoader.parse(buf, '', resolve, reject));

    const [gltfB, gltfL, gltfS] = await Promise.all([
      parseBuffer(bufB),
      parseBuffer(bufL),
      parseBuffer(bufS)
    ]);

    if (modelRoot) {
      scene.remove(modelRoot);
      meshes = [];
      initialTransforms.clear();
      originalMaterials.clear();
      neonMaterials.clear();
      blueprintMaterials.clear();
      wireframeMaterials.clear();
      ghostMaterials.clear();
      edgeLineObjects = [];
    }

    modelRoot = new THREE.Group();

    // 1. Building Structure Envelope
    const bRaw = gltfB.scene;
    const bBox = new THREE.Box3().setFromObject(bRaw);
    const bCenter = new THREE.Vector3();
    bBox.getCenter(bCenter);
    bRaw.position.set(-bCenter.x, -bBox.min.y, -bCenter.z);

    buildingGroup = new THREE.Group();
    buildingGroup.name = 'Building_Envelope';
    buildingGroup.add(bRaw);
    bRaw.traverse((child) => {
      if (child.isMesh) {
        child.userData.source = 'building';
        child.userData.floor = child.position.y > 6.5 ? 2 : child.position.y > 3.0 ? 1 : 0;
      }
    });
    modelRoot.add(buildingGroup);

    // 2. Lobby Reception (Ground Floor)
    const lRaw = gltfL.scene;
    const lBox = new THREE.Box3().setFromObject(lRaw);
    const lCenter = new THREE.Vector3();
    lBox.getCenter(lCenter);
    lRaw.position.set(-lCenter.x, -lBox.min.y, -lCenter.z);

    lobbyGroup = new THREE.Group();
    lobbyGroup.name = 'Lobby_GroundFloor';
    lobbyGroup.add(lRaw);
    lobbyGroup.position.set(officeOffsets.lobby.x, officeOffsets.lobby.y, officeOffsets.lobby.z);
    lobbyGroup.rotation.y = (officeOffsets.lobby.rotY * Math.PI) / 180;
    lobbyGroup.scale.setScalar(officeOffsets.lobby.scale);
    lRaw.traverse((child) => {
      if (child.isMesh) {
        child.userData.source = 'lobby';
        child.userData.floor = 0;
      }
    });
    modelRoot.add(lobbyGroup);

    // 3. Showroom Multimedia (Floor 1)
    const sRaw = gltfS.scene;
    const sBox = new THREE.Box3().setFromObject(sRaw);
    const sCenter = new THREE.Vector3();
    sBox.getCenter(sCenter);
    sRaw.position.set(-sCenter.x, -sBox.min.y, -sCenter.z);

    showroomGroup = new THREE.Group();
    showroomGroup.name = 'Showroom_Floor1';
    showroomGroup.add(sRaw);
    showroomGroup.position.set(officeOffsets.showroom.x, officeOffsets.showroom.y, officeOffsets.showroom.z);
    showroomGroup.rotation.y = (officeOffsets.showroom.rotY * Math.PI) / 180;
    showroomGroup.scale.setScalar(officeOffsets.showroom.scale);
    sRaw.traverse((child) => {
      if (child.isMesh) {
        child.userData.source = 'showroom';
        child.userData.floor = 1;
      }
    });
    modelRoot.add(showroomGroup);

    // Common setup for all meshes
    let totalTris = 0;
    let meshCount = 0;
    const detectedCategories = new Set();

    modelRoot.traverse((child) => {
      if (child.isMesh) {
        meshCount++;
        totalTris += setupMeshPipeline(child, detectedCategories);
      }
    });

    scene.add(modelRoot);

    modelBounds = new THREE.Box3().setFromObject(modelRoot);
    modelBounds.getCenter(modelCenter);
    modelBounds.getSize(modelSize);

    // Update stats
    const statTris = document.getElementById('stat-tris');
    const statMeshes = document.getElementById('stat-meshes');
    const statDraws = document.getElementById('stat-draws');
    if (statTris) statTris.textContent = totalTris.toLocaleString();
    if (statMeshes) statMeshes.textContent = meshCount;
    if (statDraws) statDraws.textContent = meshCount;

    populateDynamicFurnitureSelector(detectedCategories);
    applyTheme('realistic');
    applyWallCut();
    applyFacadeXray(facadeXrayEnabled);
    syncCalibrateSliders();

    fitCameraToObject(modelRoot);

    if (loaderEl) {
      loaderEl.style.opacity = '0';
      setTimeout(() => { loaderEl.style.display = 'none'; }, 400);
    }

    requestRender();
    showToast(`🏛️ ¡Edificio Unificado ensamblado! (${meshCount} mallas en 3 plantas)`);
  } catch (err) {
    console.error('Error ensamblando edificio unificado:', err);
    if (loaderEl) {
      loaderEl.innerHTML = `<div style="color:#ff6b6b; font-weight:700; text-align:center; padding:20px;">Error ensamblando: ${err.message}</div>`;
    }
  }
}

function parseGLTFBuffer(buffer, displayName = 'modelo') {
  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('draco/');
  gltfLoader.setDRACOLoader(dracoLoader);

  gltfLoader.parse(
    buffer,
    '',
    (gltf) => {
      if (modelRoot) {
        scene.remove(modelRoot);
        meshes = [];
        initialTransforms.clear();
        originalMaterials.clear();
        neonMaterials.clear();
        blueprintMaterials.clear();
        wireframeMaterials.clear();
        ghostMaterials.clear();
        edgeLineObjects = [];
      }

      modelRoot = gltf.scene;

      const box = new THREE.Box3().setFromObject(modelRoot);
      modelBounds = box;
      box.getCenter(modelCenter);
      box.getSize(modelSize);

      modelRoot.position.x = -modelCenter.x;
      modelRoot.position.y = -box.min.y;
      modelRoot.position.z = -modelCenter.z;

      let totalTris = 0;
      let meshCount = 0;
      const detectedCategories = new Set();

      modelRoot.traverse((child) => {
        if (child.isMesh) {
          meshCount++;
          totalTris += setupMeshPipeline(child, detectedCategories);
        }
      });

      scene.add(modelRoot);

      // Update HUD stats
      const statTris = document.getElementById('stat-tris');
      const statMeshes = document.getElementById('stat-meshes');
      const statDraws = document.getElementById('stat-draws');
      if (statTris) statTris.textContent = totalTris.toLocaleString();
      if (statMeshes) statMeshes.textContent = meshCount;
      if (statDraws) statDraws.textContent = meshCount;

      populateDynamicFurnitureSelector(detectedCategories);
      applyTheme('realistic');
      applyWallCut();
      fitCameraToObject(modelRoot);

      if (loaderEl) {
        loaderEl.style.opacity = '0';
        setTimeout(() => { loaderEl.style.display = 'none'; }, 400);
      }

      requestRender();
      showToast(`¡${displayName} cargado con éxito! (${meshCount} mallas, ${totalTris.toLocaleString()} polígonos)`);
    },
    (err) => {
      console.error('Error parseando GLTF:', err);
      if (loaderEl) {
        loaderEl.innerHTML = `<div style="color:#ff6b6b; font-weight:700; text-align:center;">Error parseando 3D: ${err.message}</div>`;
      }
    }
  );
}

// Dynamically generate the furniture dropdown options based on what is in the model
function populateDynamicFurnitureSelector(categoriesSet) {
  const select = document.getElementById('furniture-select');
  if (!select) return;
  select.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = 'all';
  defaultOption.textContent = '🏠 Vista Completa (Todo el Modelo)';
  select.appendChild(defaultOption);

  const categoryMeta = {
    screen: { label: '📺 Pantalla / TV Multimedia', priority: 1 },
    lighting: { label: '💡 Lámparas y Candelabros (Luminarias)', priority: 2 },
    tables: { label: '🖥️ Mesas y Escritorios', priority: 3 },
    chairs: { label: '🪑 Sillas y Asientos', priority: 4 },
    upholstery: { label: '🛋️ Sofás, Telas y Tapicería', priority: 5 },
    wood: { label: '🪵 Acabados y Suelos de Madera', priority: 6 },
    glass: { label: '🪟 Ventanales, Cristal y Vidrio', priority: 7 },
    mirror: { label: '🪞 Espejos y Reflejos', priority: 8 },
    blinds: { label: '🪟 Persianas y Estores', priority: 9 },
    metal: { label: '🔩 Estructuras Metálicas', priority: 10 },
    vegetation: { label: '🌱 Jardín y Vegetación', priority: 11 },
    person: { label: '👤 Escala Humana', priority: 12 },
    walls: { label: '🧱 Paredes y Muros', priority: 13 },
    structures: { label: '🏛️ Estructuras Generales', priority: 14 },
  };

  const sortedCats = Array.from(categoriesSet).sort((a, b) => {
    const pA = categoryMeta[a]?.priority || 99;
    const pB = categoryMeta[b]?.priority || 99;
    return pA - pB;
  });

  sortedCats.forEach((cat) => {
    const meta = categoryMeta[cat] || { label: `📦 ${cat}` };
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = meta.label;
    select.appendChild(opt);
  });

  const meshInspector = document.getElementById('mesh-inspector');
  const tagsContainer = document.getElementById('mesh-tags-container');
  if (tagsContainer) {
    tagsContainer.innerHTML = '';
    sortedCats.forEach((cat) => {
      const meta = categoryMeta[cat] || { label: cat };
      const tag = document.createElement('div');
      tag.className = 'mesh-tag';
      tag.dataset.cat = cat;
      tag.innerHTML = `<span>${meta.label}</span>`;
      tag.addEventListener('click', () => {
        document.querySelectorAll('.mesh-tag').forEach((t) => t.classList.remove('active'));
        tag.classList.add('active');
        if (select) select.value = cat;
        activeFurnitureGroup = cat;
        applyFurnitureFilter();
      });
      tagsContainer.appendChild(tag);
    });
    if (meshInspector) meshInspector.style.display = sortedCats.length ? 'block' : 'none';
  }
}

function applyTheme(theme) {
  currentTheme = theme;
  if (currentModelFile === 'unified' && focusedOffice) {
    focusOffice(focusedOffice);
    return;
  }

  meshes.forEach((mesh) => {
    if (theme === 'realistic') {
      mesh.material = originalMaterials.get(mesh);
    } else if (theme === 'neon') {
      mesh.material = neonMaterials.get(mesh);
    } else if (theme === 'blueprint') {
      mesh.material = blueprintMaterials.get(mesh);
    } else if (theme === 'wireframe') {
      mesh.material = wireframeMaterials.get(mesh);
    }
  });

  const showLines = theme === 'neon' || theme === 'blueprint';
  edgeLineObjects.forEach((line) => {
    line.visible = showLines;
  });

  if (currentModelFile === 'unified' && facadeXrayEnabled) {
    applyFacadeXray(true);
  }

  requestRender();
}

function applyWallCut() {
  if (!modelBounds) return;
  const cutThresholdY = modelBounds.min.y + (modelBounds.max.y - modelBounds.min.y) * 0.42;

  meshes.forEach((mesh) => {
    const isWall = mesh.userData.category === 'walls';
    if (!isWall) return;

    if (wallCutEnabled) {
      const init = initialTransforms.get(mesh);
      if (init && init.worldPos.y > cutThresholdY) {
        mesh.visible = false;
      } else {
        mesh.visible = true;
      }
    } else {
      mesh.visible = true;
    }
  });
  requestRender();
}

function applyFurnitureFilter() {
  if (activeFurnitureGroup === 'all') {
    applyTheme(currentTheme);
    applyWallCut();
    document.querySelectorAll('.mesh-tag').forEach((t) => t.classList.remove('active'));
    requestRender();
    return;
  }

  const targetMeshes = meshes.filter((m) => m.userData.category === activeFurnitureGroup);
  if (!targetMeshes.length) return;

  if (isolationMode === 'isolate') {
    meshes.forEach((mesh) => {
      mesh.visible = mesh.userData.category === activeFurnitureGroup;
    });
  } else if (isolationMode === 'ghost') {
    meshes.forEach((mesh) => {
      mesh.visible = true;
      if (mesh.userData.category === activeFurnitureGroup) {
        mesh.material = originalMaterials.get(mesh);
      } else {
        mesh.material = ghostMaterials.get(mesh);
      }
    });
  } else if (isolationMode === 'focus') {
    meshes.forEach((mesh) => { mesh.visible = true; });
    applyTheme(currentTheme);
    applyWallCut();
  }

  // Smoothly frame camera on selected furniture
  const targetBox = new THREE.Box3();
  targetMeshes.forEach((m) => targetBox.expandByObject(m));
  const center = new THREE.Vector3();
  targetBox.getCenter(center);
  const size = new THREE.Vector3();
  targetBox.getSize(size);

  controls.target.copy(center);
  const maxDim = Math.max(size.x, size.y, size.z, 2);
  camera.position.set(center.x + maxDim * 1.5, center.y + maxDim * 1.2, center.z + maxDim * 1.8);
  controls.update();
  requestRender();
}

function applyExplode(factor) {
  explodeDistance = factor;
  meshes.forEach((mesh) => {
    const init = initialTransforms.get(mesh);
    if (!init) return;

    const dir = init.pos.clone().normalize();
    const amount = factor * (modelSize.length() * 0.4);
    mesh.position.copy(init.pos).addScaledVector(dir, amount);
  });
  requestRender();
}

function setCameraView(viewName) {
  if (!modelBounds) return;
  const dist = modelSize.length() * 1.35;
  controls.target.copy(modelCenter);

  if (viewName === 'top') {
    camera.position.set(modelCenter.x, modelCenter.y + dist * 1.2, modelCenter.z + 0.001);
  } else if (viewName === 'front') {
    camera.position.set(modelCenter.x, modelCenter.y + modelSize.y * 0.4, modelCenter.z + dist);
  } else if (viewName === 'side') {
    camera.position.set(modelCenter.x + dist, modelCenter.y + modelSize.y * 0.4, modelCenter.z);
  } else {
    camera.position.set(modelCenter.x + dist * 0.7, modelCenter.y + dist * 0.6, modelCenter.z + dist * 0.7);
  }
  controls.update();
  requestRender();
}

function fitCameraToObject(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);

  controls.target.copy(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.45;
  camera.position.set(center.x + cameraZ * 0.8, center.y + cameraZ * 0.55, center.z + cameraZ * 0.85);
  camera.lookAt(center);
  controls.update();
  requestRender();
}

// Facade X-Ray (Allows viewing interior offices through outer building walls)
function applyFacadeXray(enabled) {
  facadeXrayEnabled = enabled;
  if (currentModelFile !== 'unified') return;

  meshes.forEach((mesh) => {
    if (mesh.userData.source === 'building') {
      const isWallOrFacade = mesh.userData.category === 'walls' || mesh.userData.category === 'structures';
      if (isWallOrFacade) {
        if (facadeXrayEnabled) {
          mesh.material = new THREE.MeshPhysicalMaterial({
            color: 0x071b30,
            transparent: true,
            opacity: 0.18,
            roughness: 0.2,
            transmission: 0.75,
          });
        } else {
          mesh.material = (currentTheme === 'realistic') ? originalMaterials.get(mesh) : neonMaterials.get(mesh);
        }
      }
    }
  });
  requestRender();
}

// Floor Filtering
function applyFloorFilter(floorVal) {
  activeFloor = floorVal;
  if (currentModelFile !== 'unified') return;

  meshes.forEach((mesh) => {
    if (mesh.userData.source === 'lobby') {
      mesh.visible = (activeFloor === 'all' || activeFloor === '0');
    } else if (mesh.userData.source === 'showroom') {
      mesh.visible = (activeFloor === 'all' || activeFloor === '1');
    } else if (mesh.userData.source === 'building') {
      if (activeFloor === '0') {
        const origY = initialTransforms.get(mesh)?.worldPos.y ?? 0;
        mesh.visible = origY < 4.2;
      } else if (activeFloor === '1') {
        const origY = initialTransforms.get(mesh)?.worldPos.y ?? 0;
        mesh.visible = origY >= 3.0 && origY < 7.5;
      } else {
        mesh.visible = true;
      }
    }
  });

  const pinLobby = document.getElementById('pin-lobby');
  const pinShowroom = document.getElementById('pin-showroom');
  if (pinLobby) pinLobby.style.opacity = (activeFloor === 'all' || activeFloor === '0') ? '1' : '0.2';
  if (pinShowroom) pinShowroom.style.opacity = (activeFloor === 'all' || activeFloor === '1') ? '1' : '0.2';

  requestRender();
}

function syncCalibrateSliders() {
  const current = officeOffsets[activeOfficeToCalibrate];
  if (!current) return;

  const sliderX = document.getElementById('calib-x-slider');
  const sliderY = document.getElementById('calib-y-slider');
  const sliderZ = document.getElementById('calib-z-slider');
  const sliderRot = document.getElementById('calib-rot-slider');
  const sliderScale = document.getElementById('calib-scale-slider');

  const valX = document.getElementById('calib-x-val');
  const valY = document.getElementById('calib-y-val');
  const valZ = document.getElementById('calib-z-val');
  const valRot = document.getElementById('calib-rot-val');
  const valScale = document.getElementById('calib-scale-val');

  if (sliderX) { sliderX.value = current.x; if (valX) valX.textContent = `${current.x.toFixed(1)} m`; }
  if (sliderY) { sliderY.value = current.y; if (valY) valY.textContent = `${current.y.toFixed(1)} m`; }
  if (sliderZ) { sliderZ.value = current.z; if (valZ) valZ.textContent = `${current.z.toFixed(1)} m`; }
  if (sliderRot) { sliderRot.value = current.rotY; if (valRot) valRot.textContent = `${Math.round(current.rotY)}°`; }
  if (sliderScale) { sliderScale.value = current.scale; if (valScale) valScale.textContent = `${current.scale.toFixed(3)}x`; }
}

function updateActiveOfficeTransform() {
  const targetGroup = activeOfficeToCalibrate === 'lobby' ? lobbyGroup : showroomGroup;
  if (!targetGroup) return;

  const off = officeOffsets[activeOfficeToCalibrate];
  targetGroup.position.set(off.x, off.y, off.z);
  targetGroup.rotation.y = (off.rotY * Math.PI) / 180;
  targetGroup.scale.setScalar(off.scale);

  requestRender();
}

function focusOffice(key) {
  // key can be 'lobby', 'showroom', or 'all' (or null)
  focusedOffice = (key === 'all' || !key) ? null : key;

  // 1. Update UI buttons (office-focus-selector pills)
  document.querySelectorAll('#office-focus-selector .segment-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.focus === (focusedOffice || 'all'));
  });

  // 2. Sync Floor Filter segment buttons if an office is focused
  if (focusedOffice === 'lobby') {
    document.querySelectorAll('#floor-filter .segment-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.floor === '0');
    });
  } else if (focusedOffice === 'showroom') {
    document.querySelectorAll('#floor-filter .segment-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.floor === '1');
    });
  } else {
    document.querySelectorAll('#floor-filter .segment-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.floor === 'all');
    });
  }

  // 3. Apply blur / ghost / ultra-faint invisibility to all other elements!
  if (focusedOffice) {
    meshes.forEach((mesh) => {
      const isTarget = (mesh.userData.source === focusedOffice);
      if (isTarget) {
        // Active office: 100% visible, sharp, vibrant materials
        mesh.visible = true;
        mesh.material = (currentTheme === 'realistic') ? originalMaterials.get(mesh) : neonMaterials.get(mesh);
        // Show neon edge contour lines on target
        mesh.children.forEach((c) => {
          if (c.isLineSegments) c.visible = (currentTheme === 'neon' || currentTheme === 'blueprint');
        });
      } else {
        // Other office + Building exterior: ultra-ghost, almost invisible, depthWrite=false
        mesh.visible = true;
        mesh.material = ultraGhostMaterial;
        // Hide distracting neon lines on ghost objects
        mesh.children.forEach((c) => {
          if (c.isLineSegments) c.visible = false;
        });
      }
    });

    // 4. Smooth Camera Focus directly inside the selected office
    const targetGroup = focusedOffice === 'lobby' ? lobbyGroup : showroomGroup;
    if (targetGroup) {
      const box = new THREE.Box3().setFromObject(targetGroup);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);

      controls.target.copy(center);
      const maxDim = Math.max(size.x, size.y, size.z);
      // Cinematic interior camera view looking directly into the office
      camera.position.set(
        center.x + maxDim * 1.15,
        center.y + maxDim * 0.75,
        center.z + maxDim * 1.25
      );
      controls.update();
    }

    // Update pins highlighting
    const pinLobby = document.getElementById('pin-lobby');
    const pinShowroom = document.getElementById('pin-showroom');
    if (pinLobby) {
      pinLobby.style.opacity = focusedOffice === 'lobby' ? '1' : '0.2';
      pinLobby.classList.toggle('active', focusedOffice === 'lobby');
    }
    if (pinShowroom) {
      pinShowroom.style.opacity = focusedOffice === 'showroom' ? '1' : '0.2';
      pinShowroom.classList.toggle('active', focusedOffice === 'showroom');
    }

    showToast(`📍 Enfocando ${focusedOffice === 'lobby' ? 'Lobby Witronix' : 'Showroom Multimedia'} (Entorno exterior atenuado)`);
  } else {
    // Ver Todo / Full Building view: restore standard materials
    applyTheme(currentTheme);
    applyWallCut();
    applyFacadeXray(facadeXrayEnabled);
    if (modelRoot) fitCameraToObject(modelRoot);

    const pinLobby = document.getElementById('pin-lobby');
    const pinShowroom = document.getElementById('pin-showroom');
    if (pinLobby) { pinLobby.style.opacity = '1'; pinLobby.classList.remove('active'); }
    if (pinShowroom) { pinShowroom.style.opacity = '1'; pinShowroom.classList.remove('active'); }

    showToast('🏢 Vista General: Todo el Edificio');
  }

  requestRender();
}

function updateOfficePins() {
  const overlay = document.getElementById('office-pins-overlay');
  if (currentModelFile !== 'unified' || !overlay || !camera) {
    if (overlay) overlay.style.display = 'none';
    return;
  }
  overlay.style.display = 'block';

  const pinL = document.getElementById('pin-lobby');
  const pinS = document.getElementById('pin-showroom');

  const projectPin = (el, vec) => {
    if (!el) return;
    const p = vec.clone().project(camera);
    if (p.z > 1) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'flex';
    const x = (p.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };

  if (lobbyGroup) {
    const lWorld = new THREE.Vector3();
    lobbyGroup.getWorldPosition(lWorld);
    lWorld.y += 2.6;
    projectPin(pinL, lWorld);
  }
  if (showroomGroup) {
    const sWorld = new THREE.Vector3();
    showroomGroup.getWorldPosition(sWorld);
    sWorld.y += 3.5;
    projectPin(pinS, sWorld);
  }
}

function setupDragAndDrop() {
  const dropZone = document.body;
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (file && (file.name.endsWith('.glb') || file.name.endsWith('.gltf'))) {
      if (loaderEl) {
        loaderEl.style.display = 'flex';
        loaderEl.style.opacity = '1';
        loaderEl.innerHTML = `
          <div class="spinner"></div>
          <div class="loading-text">Cargando <b>${file.name}</b>...</div>
          <div class="loading-subtext">Leyendo archivo arrastrado...</div>`;
      }
      const reader = new FileReader();
      reader.onload = (evt) => parseGLTFBuffer(evt.target.result, file.name);
      reader.readAsArrayBuffer(file);
    }
  });
}

function setupUIEvents() {
  // Model selector dropdown
  const modelSelect = document.getElementById('model-select');
  if (modelSelect) {
    modelSelect.addEventListener('change', (e) => {
      loadModelFile(e.target.value);
    });
  }

  // Office Focus / Blur Selector
  document.querySelectorAll('#office-focus-selector .segment-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#office-focus-selector .segment-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      focusOffice(btn.dataset.focus);
    });
  });

  // Floor Filter
  document.querySelectorAll('#floor-filter .segment-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#floor-filter .segment-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      applyFloorFilter(btn.dataset.floor);
    });
  });

  // Facade X-Ray Checkbox
  const chkXray = document.getElementById('chk-facade-xray');
  if (chkXray) {
    chkXray.addEventListener('change', (e) => {
      applyFacadeXray(e.target.checked);
    });
  }

  // Calibrate Office Select
  const calibSelect = document.getElementById('calibrate-office-select');
  if (calibSelect) {
    calibSelect.addEventListener('change', (e) => {
      activeOfficeToCalibrate = e.target.value;
      syncCalibrateSliders();
      focusOffice(activeOfficeToCalibrate);
    });
  }

  // Calibrate Sliders
  const setupSlider = (id, prop, isAngle = false) => {
    const el = document.getElementById(id);
    const label = document.getElementById(id.replace('-slider', '-val'));
    if (el) {
      el.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        officeOffsets[activeOfficeToCalibrate][prop] = val;
        if (label) label.textContent = isAngle ? `${Math.round(val)}°` : prop === 'scale' ? `${val.toFixed(3)}x` : `${val.toFixed(1)} m`;
        updateActiveOfficeTransform();
      });
    }
  };
  setupSlider('calib-x-slider', 'x');
  setupSlider('calib-y-slider', 'y');
  setupSlider('calib-z-slider', 'z');
  setupSlider('calib-rot-slider', 'rotY', true);
  setupSlider('calib-scale-slider', 'scale');

  // Focus Button
  document.getElementById('btn-focus-active-office')?.addEventListener('click', () => {
    focusOffice(activeOfficeToCalibrate);
  });

  // Copy Coords Button
  document.getElementById('btn-copy-coords')?.addEventListener('click', () => {
    const off = officeOffsets[activeOfficeToCalibrate];
    const data = {
      office: activeOfficeToCalibrate === 'lobby' ? 'Lobby Witronix' : 'Showroom Multimedia',
      floor: activeOfficeToCalibrate === 'lobby' ? 0 : 1,
      elevation: off.y,
      coordinates_center: [off.x, off.z],
      rotation_deg: off.rotY,
      scale: off.scale
    };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
      showToast('📋 ¡Coordenadas copiadas al portapapeles!');
    }).catch(() => {
      showToast(`Coords: X=${off.x}, Y=${off.y}, Z=${off.z}`);
    });
  });

  // Pins Click
  document.getElementById('pin-lobby')?.addEventListener('click', () => focusOffice('lobby'));
  document.getElementById('pin-showroom')?.addEventListener('click', () => focusOffice('showroom'));

  // Theme selector
  document.querySelectorAll('#theme-selector .segment-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#theme-selector .segment-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      applyTheme(btn.dataset.theme);
    });
  });

  // Camera selector
  document.querySelectorAll('#camera-selector .segment-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#camera-selector .segment-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      setCameraView(btn.dataset.cam);
    });
  });

  // Furniture Selector
  const furnSelect = document.getElementById('furniture-select');
  if (furnSelect) {
    furnSelect.addEventListener('change', (e) => {
      activeFurnitureGroup = e.target.value;
      applyFurnitureFilter();
    });
  }

  // Isolation Mode Selector
  document.querySelectorAll('#isolation-mode .segment-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#isolation-mode .segment-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      isolationMode = btn.dataset.iso;
      applyFurnitureFilter();
    });
  });

  // Wall Cut Checkbox
  const chkWallCut = document.getElementById('chk-wallcut');
  if (chkWallCut) {
    chkWallCut.addEventListener('change', (e) => {
      wallCutEnabled = e.target.checked;
      applyWallCut();
    });
  }

  // Explode Slider
  const slider = document.getElementById('explode-slider');
  const valLabel = document.getElementById('explode-val');
  if (slider && valLabel) {
    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      valLabel.textContent = `${val}%`;
      applyExplode(val / 100);
    });
  }

  // Auto Rotate
  const chkRotate = document.getElementById('chk-rotate');
  if (chkRotate) {
    chkRotate.addEventListener('change', (e) => {
      isAutoRotating = e.target.checked;
      controls.autoRotate = isAutoRotating;
      controls.autoRotateSpeed = 2.0;
      if (isAutoRotating) requestRender();
    });
  }

  // Demand Render Toggle
  const chkDemand = document.getElementById('chk-demand');
  if (chkDemand) {
    chkDemand.addEventListener('change', (e) => {
      renderOnDemand = e.target.checked;
      const idleLabel = document.getElementById('stat-idle');
      if (idleLabel) {
        idleLabel.textContent = renderOnDemand ? '0% (Bajo demanda)' : 'Continuo (60 FPS)';
      }
    });
  }

  // Reset Camera
  const btnReset = document.getElementById('btn-reset-cam');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (furnSelect) furnSelect.value = 'all';
      activeFurnitureGroup = 'all';
      applyFurnitureFilter();
      fitCameraToObject(modelRoot);
    });
  }

  // Show all meshes in drawer
  document.getElementById('btn-show-all')?.addEventListener('click', () => {
    if (furnSelect) furnSelect.value = 'all';
    activeFurnitureGroup = 'all';
    applyFurnitureFilter();
  });

  // Fullscreen
  const btnFullscreen = document.getElementById('btn-fullscreen');
  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }

  // Custom File Input
  const btnLoadCustom = document.getElementById('btn-load-custom');
  const customFileInput = document.getElementById('custom-file-input');
  if (btnLoadCustom && customFileInput) {
    btnLoadCustom.addEventListener('click', () => customFileInput.click());
    customFileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        if (loaderEl) {
          loaderEl.style.display = 'flex';
          loaderEl.style.opacity = '1';
          loaderEl.innerHTML = `
            <div class="spinner"></div>
            <div class="loading-text">Cargando <b>${file.name}</b>...</div>
            <div class="loading-subtext">Leyendo modelo 3D...</div>`;
        }
        const reader = new FileReader();
        reader.onload = (evt) => parseGLTFBuffer(evt.target.result, file.name);
        reader.readAsArrayBuffer(file);
      }
    });
  }
}

function onWindowResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  requestRender();
}

function animate() {
  requestAnimationFrame(animate);

  frames++;
  const now = performance.now();
  if (now - lastTime >= 1000) {
    fps = Math.round((frames * 1000) / (now - lastTime));
    const statFps = document.getElementById('stat-fps');
    if (statFps) statFps.textContent = `${fps} FPS`;
    frames = 0;
    lastTime = now;
  }

  if (controls && controls.autoRotate) {
    controls.update();
    needsRender = true;
  } else if (controls) {
    controls.update();
  }

  updateOfficePins();

  if (renderer && scene && camera) {
    if (!renderOnDemand || needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
    }
  }
}

init();
