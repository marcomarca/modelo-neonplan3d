import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// State
let scene, camera, renderer, controls;
let modelRoot = null;
let buildingGroup = null;
let lobbyGroup = null;
let showroomGroup = null;
let meshes = [];
let originalMaterials = new Map();
let neonMaterials = new Map();
let edgeLineObjects = [];
let focusedOffice = null; // null ('all') | 'lobby' | 'showroom'
let activeFurnitureCategory = 'all';

// Fixed Calibrated Coordinates (Specified by User)
const OFFICE_COORDINATES = {
  lobby: { x: 3.2, y: 2.2, z: -1.6, rotY: 0, scale: 1.0 },
  showroom: { x: -2.6, y: 2.4, z: -1.6, rotY: 0, scale: 1.0 },
};

// Home Assistant Simulated / Synced Entity State
const HA_STATE = {
  lobby: {
    temp: 22.5,
    ac_on: true,
    light_on: true,
    presence: true,
  },
  showroom: {
    temp: 21.0,
    ac_on: true,
    light_on: true,
    presence: true,
  },
};

let activeOfficeForControls = 'showroom';

// Ultra-Ghost Material for Out-of-Focus Elements (nearly invisible, non-occluding)
const ultraGhostMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x05101a,
  transparent: true,
  opacity: 0.035,
  roughness: 0.95,
  metalness: 0.05,
  depthWrite: false,
});

let needsRender = true;
function requestRender() {
  needsRender = true;
}

const container = document.getElementById('viewport-container');
const loaderEl = document.getElementById('loader');
const toastEl = document.getElementById('toast');

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  setTimeout(() => { toastEl.style.opacity = '0'; }, 2400);
}

// Procedural 3D Modern Wall-Mounted AC Unit
function create3DAirConditioner(officeName) {
  const acGroup = new THREE.Group();
  acGroup.name = `AC_Unit_${officeName}`;

  // Main chassis (sleek curved white-slate body)
  const bodyGeo = new THREE.BoxGeometry(1.05, 0.32, 0.22);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x182436,
    roughness: 0.25,
    metalness: 0.4,
  });
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyMesh.userData.category = 'ac_unit';
  bodyMesh.userData.source = officeName;
  acGroup.add(bodyMesh);

  // Bottom airflow louver / flap
  const flapGeo = new THREE.BoxGeometry(0.95, 0.04, 0.12);
  const flapMat = new THREE.MeshStandardMaterial({
    color: 0x00e5ff,
    roughness: 0.3,
    metalness: 0.6,
    emissive: 0x00e5ff,
    emissiveIntensity: 0.25,
  });
  const flapMesh = new THREE.Mesh(flapGeo, flapMat);
  flapMesh.position.set(0, -0.14, 0.04);
  flapMesh.rotation.x = 0.3;
  flapMesh.userData.category = 'ac_unit';
  flapMesh.userData.source = officeName;
  acGroup.add(flapMesh);

  // Digital LED temperature display on front panel
  const ledGeo = new THREE.PlaneGeometry(0.18, 0.06);
  const ledMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.9,
  });
  const ledMesh = new THREE.Mesh(ledGeo, ledMat);
  ledMesh.position.set(0.32, 0.02, 0.115);
  ledMesh.userData.category = 'ac_unit';
  ledMesh.userData.source = officeName;
  acGroup.add(ledMesh);

  return acGroup;
}

// Lighting setup tailored for NeonPlan aesthetic
function setupLighting() {
  const ambient = new THREE.AmbientLight(0xffffff, 1.4);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
  dirLight.position.set(70, 160, 90);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.bias = -0.0001;
  scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0xd8e8ff, 1.2);
  fillLight.position.set(-80, 80, -70);
  scene.add(fillLight);

  const cyanPoint = new THREE.PointLight(0x00e5ff, 1.8, 300);
  cyanPoint.position.set(-50, 40, -40);
  scene.add(cyanPoint);

  const magentaPoint = new THREE.PointLight(0xff2a85, 1.5, 260);
  magentaPoint.position.set(60, 35, 60);
  scene.add(magentaPoint);
}

// Category Classifier
function classifyMesh(mesh) {
  if (mesh.userData.category === 'ac_unit') return 'ac_unit';
  const name = (mesh.name || '').toLowerCase();
  const matName = (mesh.material?.name || '').toLowerCase();
  const s = `${name} ${matName}`;

  if (s.includes('glass') || s.includes('translucent') || s.includes('vidrio') || s.includes('cristal') || name.startsWith('tr_')) {
    return 'glass';
  }
  if (s.includes('samsung') || s.includes('tv') || s.includes('screen') || s.includes('pantalla') || s.includes('display')) {
    return 'screen';
  }
  if (s.includes('lamp') || s.includes('light') || s.includes('luz') || s.includes('lampara') || s.includes('candelabro')) {
    return 'lighting';
  }
  if (s.includes('joy') || s.includes('chair') || s.includes('silla') || s.includes('seat') || s.includes('asiento') || s.includes('stool')) {
    return 'chairs';
  }
  if (s.includes('table') || s.includes('desk') || s.includes('mesa') || s.includes('escritorio') || s.includes('counter')) {
    return 'tables';
  }
  if (s.includes('sofa') || s.includes('couch') || s.includes('fabric') || s.includes('linen') || s.includes('tela') || s.includes('cushion')) {
    return 'upholstery';
  }
  if (s.includes('wood') || s.includes('oak') || s.includes('plywood') || s.includes('madera') || s.includes('tarima')) {
    return 'wood';
  }
  if (s.includes('wall') || s.includes('pared') || s.includes('fachada') || s.includes('concrete') || s.includes('muro')) {
    return 'walls';
  }
  return 'structures';
}

function setupMeshPipeline(child, sourceName) {
  meshes.push(child);
  child.userData.source = sourceName;
  child.castShadow = true;
  child.receiveShadow = true;

  const cat = classifyMesh(child);
  child.userData.category = cat;

  // Generate crisp neon edge contours
  if (child.geometry) {
    try {
      const edgesGeo = new THREE.EdgesGeometry(child.geometry, 28);
      const edgeColor =
        sourceName === 'lobby' ? 0x00e5ff :
        sourceName === 'showroom' ? 0xff2a85 :
        cat === 'screen' || cat === 'lighting' ? 0xff2a85 : 0x00e5ff;

      const lineMat = new THREE.LineBasicMaterial({
        color: edgeColor,
        transparent: true,
        opacity: 0.82,
      });
      const line = new THREE.LineSegments(edgesGeo, lineMat);
      line.visible = true;
      child.add(line);
      edgeLineObjects.push(line);
    } catch (e) {}
  }

  originalMaterials.set(child, child.material);

  // Dedicated NeonPlan Material Palette
  let neonMat;
  if (cat === 'glass') {
    neonMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a223a,
      transparent: true,
      opacity: 0.2,
      roughness: 0.1,
      metalness: 0.1,
      transmission: 0.75,
    });
  } else if (cat === 'screen') {
    neonMat = new THREE.MeshStandardMaterial({
      color: 0x080c14,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0xff2a85,
      emissiveIntensity: 0.65,
    });
  } else if (cat === 'lighting') {
    neonMat = new THREE.MeshStandardMaterial({
      color: 0x140e1a,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0xffb547,
      emissiveIntensity: 0.8,
    });
  } else if (cat === 'ac_unit') {
    neonMat = child.material;
  } else if (cat === 'walls' && sourceName === 'building') {
    // Exterior building walls default to elegant translucent facade so interior offices are visible
    neonMat = new THREE.MeshPhysicalMaterial({
      color: 0x071b30,
      transparent: true,
      opacity: 0.16,
      roughness: 0.2,
      transmission: 0.78,
    });
  } else {
    neonMat = new THREE.MeshStandardMaterial({
      color: 0x0f1a2c,
      roughness: 0.45,
      metalness: 0.5,
    });
  }
  neonMaterials.set(child, neonMat);
  child.material = neonMat;
}

// Assemble the unified 3D building with fixed coordinates
async function loadUnifiedBuilding() {
  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('draco/');
  gltfLoader.setDRACOLoader(dracoLoader);

  const parseBuffer = (buf) => new Promise((res, rej) => gltfLoader.parse(buf, '', res, rej));

  try {
    const [resB, resL, resS] = await Promise.all([
      fetch('../building.glb'),
      fetch('../lobby.glb'),
      fetch('../showroom.glb')
    ]);

    const [bufB, bufL, bufS] = await Promise.all([
      resB.arrayBuffer(),
      resL.arrayBuffer(),
      resS.arrayBuffer()
    ]);

    const [gltfB, gltfL, gltfS] = await Promise.all([
      parseBuffer(bufB),
      parseBuffer(bufL),
      parseBuffer(bufS)
    ]);

    modelRoot = new THREE.Group();

    // 1. Building Envelope
    const bRaw = gltfB.scene;
    const bBox = new THREE.Box3().setFromObject(bRaw);
    const bCenter = new THREE.Vector3();
    bBox.getCenter(bCenter);
    bRaw.position.set(-bCenter.x, -bBox.min.y, -bCenter.z);

    buildingGroup = new THREE.Group();
    buildingGroup.name = 'Building_Envelope';
    buildingGroup.add(bRaw);
    bRaw.traverse((c) => {
      if (c.isMesh) setupMeshPipeline(c, 'building');
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

    // Add physical 3D AC Unit to Lobby wall
    const acLobby = create3DAirConditioner('lobby');
    acLobby.position.set(0.5, 3.2, -3.2);
    acLobby.traverse((c) => {
      if (c.isMesh) setupMeshPipeline(c, 'lobby');
    });
    lobbyGroup.add(acLobby);

    lobbyGroup.position.set(OFFICE_COORDINATES.lobby.x, OFFICE_COORDINATES.lobby.y, OFFICE_COORDINATES.lobby.z);
    lobbyGroup.rotation.y = (OFFICE_COORDINATES.lobby.rotY * Math.PI) / 180;
    lobbyGroup.scale.setScalar(OFFICE_COORDINATES.lobby.scale);

    lRaw.traverse((c) => {
      if (c.isMesh) setupMeshPipeline(c, 'lobby');
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

    // Add physical 3D AC Unit to Showroom wall
    const acShowroom = create3DAirConditioner('showroom');
    acShowroom.position.set(0, 3.6, -3.8);
    acShowroom.traverse((c) => {
      if (c.isMesh) setupMeshPipeline(c, 'showroom');
    });
    showroomGroup.add(acShowroom);

    showroomGroup.position.set(OFFICE_COORDINATES.showroom.x, OFFICE_COORDINATES.showroom.y, OFFICE_COORDINATES.showroom.z);
    showroomGroup.rotation.y = (OFFICE_COORDINATES.showroom.rotY * Math.PI) / 180;
    showroomGroup.scale.setScalar(OFFICE_COORDINATES.showroom.scale);

    sRaw.traverse((c) => {
      if (c.isMesh) setupMeshPipeline(c, 'showroom');
    });
    modelRoot.add(showroomGroup);

    scene.add(modelRoot);
    fitCameraToObject(modelRoot);

    if (loaderEl) {
      loaderEl.style.opacity = '0';
      setTimeout(() => { loaderEl.style.display = 'none'; }, 400);
    }

    requestRender();
    showToast('Witronix 3D listo para Home Assistant');
  } catch (err) {
    console.error('Error cargando modelos:', err);
    if (loaderEl) {
      loaderEl.innerHTML = `<div style="color:#ff6b6b; padding:24px; text-align:center;">Error: ${err.message}</div>`;
    }
  }
}

// Office Isolation and Blur Filter
function focusOffice(key) {
  focusedOffice = (key === 'all' || !key) ? null : key;

  // Sync Office Selector buttons
  document.querySelectorAll('#office-selector .segment-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.office === (focusedOffice || 'all'));
  });

  const pinLobby = document.getElementById('pin-lobby');
  const pinShowroom = document.getElementById('pin-showroom');

  if (focusedOffice) {
    activeOfficeForControls = focusedOffice;
    updateControllerCardContent();

    meshes.forEach((mesh) => {
      const isTarget = (mesh.userData.source === focusedOffice);
      if (isTarget) {
        mesh.visible = (activeFurnitureCategory === 'all' || mesh.userData.category === activeFurnitureCategory);
        mesh.material = neonMaterials.get(mesh) || mesh.material;
        mesh.children.forEach((c) => { if (c.isLineSegments) c.visible = true; });
      } else {
        // Blur / Ultra-ghost other elements
        mesh.visible = true;
        mesh.material = ultraGhostMaterial;
        mesh.children.forEach((c) => { if (c.isLineSegments) c.visible = false; });
      }
    });

    const targetGroup = focusedOffice === 'lobby' ? lobbyGroup : showroomGroup;
    if (targetGroup) {
      const box = new THREE.Box3().setFromObject(targetGroup);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);

      controls.target.copy(center);
      const maxDim = Math.max(size.x, size.y, size.z);
      camera.position.set(center.x + maxDim * 1.15, center.y + maxDim * 0.75, center.z + maxDim * 1.25);
      controls.update();
    }

    if (pinLobby) {
      pinLobby.style.opacity = focusedOffice === 'lobby' ? '1' : '0.2';
      pinLobby.classList.toggle('active', focusedOffice === 'lobby');
    }
    if (pinShowroom) {
      pinShowroom.style.opacity = focusedOffice === 'showroom' ? '1' : '0.2';
      pinShowroom.classList.toggle('active', focusedOffice === 'showroom');
    }

    showToast(`📍 Enfocando ${focusedOffice === 'lobby' ? 'Lobby' : 'Showroom'}`);
  } else {
    // Restore all
    activeOfficeForControls = 'showroom';
    updateControllerCardContent();

    meshes.forEach((mesh) => {
      mesh.visible = (activeFurnitureCategory === 'all' || mesh.userData.category === activeFurnitureCategory);
      mesh.material = neonMaterials.get(mesh) || mesh.material;
      mesh.children.forEach((c) => { if (c.isLineSegments) c.visible = true; });
    });

    if (modelRoot) fitCameraToObject(modelRoot);

    if (pinLobby) { pinLobby.style.opacity = '1'; pinLobby.classList.remove('active'); }
    if (pinShowroom) { pinShowroom.style.opacity = '1'; pinShowroom.classList.remove('active'); }

    showToast('🏢 Vista General: Edificio Completo');
  }

  requestRender();
}

// Furniture Inspector (Solo este Mueble)
function applyFurnitureFilter(cat) {
  activeFurnitureCategory = cat;

  if (cat === 'all') {
    focusOffice(focusedOffice);
    return;
  }

  const targetMeshes = meshes.filter((m) => {
    const matchesOffice = !focusedOffice || m.userData.source === focusedOffice;
    return matchesOffice && m.userData.category === cat;
  });

  if (!targetMeshes.length) {
    showToast(`No se encontraron elementos de tipo: ${cat}`);
    return;
  }

  meshes.forEach((mesh) => {
    const isTarget = targetMeshes.includes(mesh);
    mesh.visible = isTarget;
    if (isTarget) {
      mesh.material = neonMaterials.get(mesh);
      mesh.children.forEach((c) => { if (c.isLineSegments) c.visible = true; });
    }
  });

  const box = new THREE.Box3();
  targetMeshes.forEach((m) => box.expandByObject(m));
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);

  controls.target.copy(center);
  const maxDim = Math.max(size.x, size.y, size.z, 1.5);
  camera.position.set(center.x + maxDim * 1.5, center.y + maxDim * 1.2, center.z + maxDim * 1.8);
  controls.update();

  requestRender();
  showToast(`Inspección: Solo ${cat}`);
}

// Camera View Presets
function setCameraView(viewName) {
  if (!modelRoot) return;
  const box = new THREE.Box3().setFromObject(modelRoot);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  const dist = size.length() * 1.25;

  controls.target.copy(center);

  if (viewName === 'top') {
    // 2D Planta View
    camera.position.set(center.x, center.y + dist * 1.2, center.z + 0.001);
  } else if (viewName === 'side') {
    // 2D Lateral View
    camera.position.set(center.x + dist, center.y + size.y * 0.35, center.z);
  } else if (viewName === 'front') {
    // 2D Frontal View
    camera.position.set(center.x, center.y + size.y * 0.35, center.z + dist);
  } else {
    // Perspective 3D
    camera.position.set(center.x + dist * 0.7, center.y + dist * 0.55, center.z + dist * 0.7);
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
  let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.4;
  camera.position.set(center.x + cameraZ * 0.75, center.y + cameraZ * 0.5, center.z + cameraZ * 0.8);
  camera.lookAt(center);
  controls.update();
  requestRender();
}

// Project 3D positions of pins to 2D HTML coordinates
function updateOfficePins() {
  const overlay = document.getElementById('pins-overlay');
  if (!overlay || !camera) return;

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
    lWorld.y += 2.5;
    projectPin(pinL, lWorld);
  }
  if (showroomGroup) {
    const sWorld = new THREE.Vector3();
    showroomGroup.getWorldPosition(sWorld);
    sWorld.y += 3.4;
    projectPin(pinS, sWorld);
  }
}

// Update Controller Card content based on active office
function updateControllerCardContent() {
  const room = HA_STATE[activeOfficeForControls];
  if (!room) return;

  const titleEl = document.getElementById('active-room-title');
  const iconEl = document.getElementById('active-room-icon');
  const subEl = document.getElementById('active-room-sub');
  const tempVal = document.getElementById('temp-display');
  const acStatus = document.getElementById('ac-status-text');
  const lightStatus = document.getElementById('light-status-text');
  const chkAc = document.getElementById('chk-ac-power');
  const chkLight = document.getElementById('chk-lights-power');

  if (activeOfficeForControls === 'lobby') {
    if (titleEl) titleEl.textContent = 'Lobby Witronix (Planta Baja)';
    if (iconEl) iconEl.textContent = '🏨';
    if (subEl) subEl.textContent = 'Control de Recepción y Acceso';
  } else {
    if (titleEl) titleEl.textContent = 'Showroom Multimedia (Planta 1)';
    if (iconEl) iconEl.textContent = '💻';
    if (subEl) subEl.textContent = 'Control de Sala y Climatización';
  }

  if (tempVal) tempVal.textContent = `${room.temp.toFixed(1)}°`;
  if (acStatus) acStatus.textContent = room.ac_on ? `Activo · ${room.temp.toFixed(1)}°C` : 'Apagado';
  if (lightStatus) lightStatus.textContent = room.light_on ? 'Encendido' : 'Apagado';
  if (chkAc) chkAc.checked = room.ac_on;
  if (chkLight) chkLight.checked = room.light_on;

  // Also update 3D floating pin badges
  const bLobby = document.getElementById('badge-temp-lobby');
  const bShowroom = document.getElementById('badge-temp-showroom');
  if (bLobby) bLobby.textContent = `${HA_STATE.lobby.temp.toFixed(1)}°C`;
  if (bShowroom) bShowroom.textContent = `${HA_STATE.showroom.temp.toFixed(1)}°C`;
}

// Home Assistant Communication Helper (Calls HA Services or dispatches events)
function sendHomeAssistantService(domain, service, serviceData) {
  console.log('[Home Assistant Service Call]', domain, service, serviceData);
  // 1. If running inside Home Assistant panel/iframe with hass object:
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({
      type: 'call-service',
      domain,
      service,
      service_data: serviceData,
    }, '*');
  }
}

// Setup Event Handlers
function setupUIEvents() {
  // Office focus buttons
  document.querySelectorAll('#office-selector .segment-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      focusOffice(btn.dataset.office);
    });
  });

  // Pins Click
  document.getElementById('pin-lobby')?.addEventListener('click', () => focusOffice('lobby'));
  document.getElementById('pin-showroom')?.addEventListener('click', () => focusOffice('showroom'));

  // Camera selector
  document.querySelectorAll('#camera-selector .segment-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#camera-selector .segment-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      setCameraView(btn.dataset.cam);
    });
  });

  // Reset Camera
  document.getElementById('btn-reset-cam')?.addEventListener('click', () => {
    if (focusedOffice) {
      focusOffice(focusedOffice);
    } else if (modelRoot) {
      fitCameraToObject(modelRoot);
    }
  });

  // Temperature Controls
  document.getElementById('btn-temp-plus')?.addEventListener('click', () => {
    const room = HA_STATE[activeOfficeForControls];
    if (room && room.temp < 30) {
      room.temp = Math.round((room.temp + 0.5) * 10) / 10;
      updateControllerCardContent();
      sendHomeAssistantService('climate', 'set_temperature', {
        entity_id: `climate.${activeOfficeForControls}_ac`,
        temperature: room.temp,
      });
      showToast(`❄️ Temp ${activeOfficeForControls}: ${room.temp}°C`);
    }
  });

  document.getElementById('btn-temp-minus')?.addEventListener('click', () => {
    const room = HA_STATE[activeOfficeForControls];
    if (room && room.temp > 16) {
      room.temp = Math.round((room.temp - 0.5) * 10) / 10;
      updateControllerCardContent();
      sendHomeAssistantService('climate', 'set_temperature', {
        entity_id: `climate.${activeOfficeForControls}_ac`,
        temperature: room.temp,
      });
      showToast(`❄️ Temp ${activeOfficeForControls}: ${room.temp}°C`);
    }
  });

  // AC Power Toggle
  document.getElementById('chk-ac-power')?.addEventListener('change', (e) => {
    const room = HA_STATE[activeOfficeForControls];
    if (room) {
      room.ac_on = e.target.checked;
      updateControllerCardContent();
      sendHomeAssistantService('climate', room.ac_on ? 'turn_on' : 'turn_off', {
        entity_id: `climate.${activeOfficeForControls}_ac`,
      });
      showToast(`❄️ AC ${activeOfficeForControls} ${room.ac_on ? 'Encendido' : 'Apagado'}`);
    }
  });

  // Lights Power Toggle
  document.getElementById('chk-lights-power')?.addEventListener('change', (e) => {
    const room = HA_STATE[activeOfficeForControls];
    if (room) {
      room.light_on = e.target.checked;
      updateControllerCardContent();
      sendHomeAssistantService('light', room.light_on ? 'turn_on' : 'turn_off', {
        entity_id: `light.${activeOfficeForControls}_lights`,
      });

      // Visually toggle light emission in 3D
      meshes.forEach((m) => {
        if (m.userData.source === activeOfficeForControls && m.userData.category === 'lighting') {
          if (m.material) {
            m.material.emissiveIntensity = room.light_on ? 0.8 : 0.05;
          }
        }
      });
      requestRender();
      showToast(`💡 Luces ${activeOfficeForControls} ${room.light_on ? 'Encendidas' : 'Apagadas'}`);
    }
  });

  // Solo Muebles Selector
  document.getElementById('furniture-select')?.addEventListener('change', (e) => {
    applyFurnitureFilter(e.target.value);
  });

  // Toggle Card Collapse
  const card = document.getElementById('ha-controller-card');
  const btnToggle = document.getElementById('btn-toggle-card');
  if (btnToggle && card) {
    let collapsed = false;
    btnToggle.addEventListener('click', () => {
      collapsed = !collapsed;
      btnToggle.textContent = collapsed ? '+' : '−';
      const rows = card.querySelectorAll('.control-row, .furn-row');
      rows.forEach((r) => { r.style.display = collapsed ? 'none' : 'flex'; });
      if (!collapsed) {
        const furn = card.querySelector('.furn-row');
        if (furn) furn.style.display = 'block';
      }
    });
  }

  // Listen for Home Assistant inbound messages
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.type === 'ha-state-update') {
      if (data.entity_id.includes('lobby') && data.temperature) {
        HA_STATE.lobby.temp = data.temperature;
      }
      if (data.entity_id.includes('showroom') && data.temperature) {
        HA_STATE.showroom.temp = data.temperature;
      }
      updateControllerCardContent();
    }
  });
}

function onWindowResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  requestRender();
}

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b14);
  scene.fog = new THREE.FogExp2(0x070b14, 0.0035);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(110, 80, 140);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.maxPolarAngle = Math.PI / 2 + 0.04;
  controls.minDistance = 1;
  controls.maxDistance = 1000;
  controls.addEventListener('change', () => requestRender());

  setupLighting();

  const grid = new THREE.GridHelper(300, 60, 0x00e5ff, 0x122438);
  grid.position.y = -0.05;
  grid.material.opacity = 0.22;
  grid.material.transparent = true;
  scene.add(grid);

  loadUnifiedBuilding();
  updateControllerCardContent();

  window.addEventListener('resize', onWindowResize);
  setupUIEvents();

  animate();
}

function animate() {
  requestAnimationFrame(animate);

  if (controls) controls.update();
  updateOfficePins();

  if (renderer && scene && camera) {
    if (needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
    }
  }
}

init();
