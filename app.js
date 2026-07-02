// --- CONFIGURATION & STATE ---

// Scene units -> real-world meters. Used by the efficiency metrics AND the ruler/measurement tool.
const UNIT_TO_METER = 2.5;

const CONFIG = {
    // Genişletilmiş alan: Serbest Tasarım modunda eskisinden daha fazla boş alanda
    // makineleri konumlandırabilmeniz için taban ölçüleri büyütüldü.
    floorSize: { width: 92, depth: 48 },
    gridDivisions: 92,
    wallHeight: 6, // scene units - adjustable live via the "Duvar Yüksekliği" slider
    colors: {
        background: 0x05070c,
        floor: 0x0a0f1d,
        grid: 0x1e293b,
        fixed: 0x0ea5e9,     // Sky Blue
        office: 0x10b981,    // Emerald Green
        stock: 0xa855f7,     // Purple
        cnc: 0xf97316,       // Orange
        utility: 0x14b8a6,   // Teal
        gate: 0xef4444,      // Red
        glow: 0x38bdf8,
        activeBorder: 0x22c55e, // Green for selected/movable
        wallDark: 0x0b1220,  // Dark, solid facility wall color
        window: 0x7dd3fc     // Glass/window pane tint
    }
};

// Icon glyphs used both on the 3D floating labels and in the "Yeni Eleman Ekle" type picker,
// so every machine/element type has a consistent, recognizable visual representation.
const TYPE_ICONS = {
    fixed: '⚙️', cnc: '⚙️', stock: '📦', office: '🏢',
    utility: '🔧', gate: '🚪', forklift_zone: '🚚', column: '🏛️'
};

let scene, camera, renderer, controls;
// Structural wall visibility - persists across createFactoryBase() rebuilds (e.g. when resizing the floor)
let wallVisibility = { factoryWallBack: true, factoryWallLeft: true, factoryWallRight: true };
let showWindows = true; // toggle for window strips embedded in the dark facility walls
let selectedNewElemType = 'cnc'; // active type in the icon-based "Yeni Eleman Ekle" picker
let currentLayout = 'current'; // 'current' | 'optimized' | 'custom'
let baselineDistanceMeters = null; // captured once from the initial Alternatif 1 layout, used for cost comparisons
let lastDistanceMeters = 0;
let viewMode = '3d'; // '3d' | '2d'
let showFlowLines = true;
let showGrid = true;

// Raycasting & Drag and Drop state
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedObject = null;
let plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // drag plane
let dragOffset = new THREE.Vector3();
let dragIntersection = new THREE.Vector3();
let dragStartMetrics = null; // snapshot of metrics taken the instant a machine is picked up

// Ruler / measurement tool state
let rulerActive = false;
let rulerPendingPoint = null; // first click of the current measurement, awaiting the second
let measurements = []; // { p1: THREE.Vector3, p2: THREE.Vector3, line, markers: [mesh, mesh], labelEl }

// Custom elements added by the user via the 3D Yerleşim Editörü
let customElementCounter = 0;

// Bağlantı Kurma Modu (connection mode): draw custom material-flow or forklift routes
let connectionModeActive = false;
let connectionPendingId = null;
let customConnections = []; // { fromId, toId, kind: 'material'|'forklift', line, vehicleMesh, curve, progress, speed }
const connectionsGroup = new THREE.Group();
const suggestionGroup = new THREE.Group(); // ghost outline shown when we propose a better position
let pendingSuggestion = null; // { targetId, idealPos }

// Spaghetti diagram + safety zone overlay groups
const spaghettiGroup = new THREE.Group();
const safetyZoneGroup = new THREE.Group();
let spaghettiVisible = false;
let safetyZonesVisible = false;
let flowSpeedMultiplier = 1;
let lastFlowRoutes = []; // populated by recreateFlowPaths(), reused by the spaghetti diagram

// Click vs drag detection, and the currently inspected element
let pointerDownPos = null;
let selectedDetailElement = null;

// Factory elements data
const factoryElements = {
    // FIXED ELEMENTS (Cannot be moved)
    fixed: [
        { id: 'offices', name: 'İdari Ofisler', type: 'office', x: -22, z: -11.5, w: 14, d: 5, h: 2.5, label: 'OFİSLER (İDARİ)' }
    ],
    // OPTIMIZABLE ELEMENTS (Can change coordinates based on layout)
    movable: [
        // Ana üretim hattı & teknik altyapı — Alternatif 1 / Layout B ön ayarlarında
        // orijinal yerinde kalır, ama Serbest Tasarım modunda mouse ile taşınabilir.
        { id: 'torwegge', name: 'Torwegge Hattı', type: 'fixed', w: 10, d: 3, h: 1.8, label: 'TORWEGGE', current: { x: -13, z: -2 }, optimized: { x: -13, z: -2 } },
        { id: 'homag', name: 'Homag Hattı', type: 'fixed', w: 12, d: 3, h: 1.8, label: 'HOMAG', current: { x: 0, z: -2 }, optimized: { x: 0, z: -2 } },
        { id: 'eta', name: 'ETA Pres Hattı', type: 'fixed', w: 10, d: 4, h: 2.2, label: 'ETA', current: { x: 13, z: -2 }, optimized: { x: 13, z: -2 } },
        { id: 'toz_emme', name: 'Toz Emme Ünitesi', type: 'utility', w: 3, d: 6, h: 4, label: 'TOZ EMME', current: { x: 28, z: 4 }, optimized: { x: 28, z: 4 } },
        { id: 'merdiven', name: 'Merdiven', type: 'office', w: 2, d: 4, h: 3.5, label: 'MERDİVEN', current: { x: 28, z: -2 }, optimized: { x: 28, z: -2 } },
        { id: 'kompresor', name: 'Kompresör Odası', type: 'utility', w: 3, d: 2, h: 2, label: 'KOMPR.', current: { x: -28, z: -14 }, optimized: { x: -28, z: -14 } },

        // Kapılar - artık taşınabilir (bina duvarı boyunca istediğiniz yere sürükleyebilirsiniz)
        { id: 'gate_left_top', name: 'Giriş Kapısı 1', type: 'gate', w: 1, d: 3, h: 0.1, label: 'GİRİŞ', current: { x: -45.5, z: -8 }, optimized: { x: -45.5, z: -8 } },
        { id: 'gate_left_mid', name: 'Çıkış Kapısı (Lojistik)', type: 'gate', w: 1, d: 3, h: 0.1, label: 'ÇIKIŞ', current: { x: -45.5, z: -2 }, optimized: { x: -45.5, z: -2 } },
        { id: 'gate_left_bot', name: 'Giriş Kapısı 2', type: 'gate', w: 1, d: 3, h: 0.1, label: 'GİRİŞ', current: { x: -45.5, z: 9 }, optimized: { x: -45.5, z: 9 } },
        { id: 'gate_right_top', name: 'Giriş Kapısı 3', type: 'gate', w: 1, d: 3, h: 0.1, label: 'GİRİŞ', current: { x: 45.5, z: -8 }, optimized: { x: 45.5, z: -8 } },

        // Raw stocks & Prep (now includes Levha Stok and Seren Kesim-Montaj)
        { id: 'levha_stok', name: 'Levha Stok Alanı', type: 'stock', w: 4, d: 3, h: 1, label: 'LEVHA STOK', current: { x: 24, z: 9 }, optimized: { x: -25, z: -6 } },
        { id: 'seren_stok', name: 'Seren Stok Alanı', type: 'stock', w: 4, d: 3, h: 1, label: 'SEREN STOK', current: { x: 16, z: 9 }, optimized: { x: -20, z: -6 } },
        { id: 'seren_kesim_montaj', name: 'Seren Kesim - Montaj', type: 'stock', w: 5, d: 3, h: 1.2, label: 'SEREN K-M', current: { x: 10, z: 9 }, optimized: { x: -13, z: -6 } },
        { id: 'montajli_seren', name: 'Montajlı Seren Stok', type: 'stock', w: 4, d: 3, h: 1, label: 'M. SEREN STOK', current: { x: 4, z: 9 }, optimized: { x: -6, z: -6 } },
        { id: 'seren_dolum', name: 'Seren Dolum', type: 'stock', w: 4, d: 3, h: 1, label: 'SEREN DOLUM', current: { x: -1, z: 9 }, optimized: { x: 1, z: -6 } },
        { id: 'dolum_stok', name: 'Dolum Stok Alanı', type: 'stock', w: 4, d: 3, h: 1, label: 'DOLUM STOK', current: { x: -6, z: 9 }, optimized: { x: 8, z: -6 } },
        { id: 'kopuk_stok', name: 'Köpük Stok Alanı', type: 'stock', w: 4, d: 3, h: 1, label: 'KÖPÜK STOK', current: { x: 25, z: 9 }, optimized: { x: 15, z: -6 } },

        // CNC and intermediate operations
        { id: 'cnc', name: 'CNC Router', type: 'cnc', w: 4, d: 3, h: 2, label: 'CNC', current: { x: 18, z: 7 }, optimized: { x: -24, z: 6 } },
        { id: 'cnc_bitmis_stok', name: 'CNC Bitmiş Ürün Stok', type: 'stock', w: 4, d: 3, h: 1, label: 'CNC BİTMİŞ STOK', current: { x: 15, z: 7 }, optimized: { x: -24, z: 2 } },
        { id: 'yatar_small', name: 'Yatar Kesim (Küçük)', type: 'cnc', w: 3, d: 2, h: 1.2, label: 'YATAR (K)', current: { x: 19, z: 3 }, optimized: { x: -24, z: 10 } },
        { id: 'yatar_large', name: 'Yatar Kesim (Büyük)', type: 'cnc', w: 4, d: 3, h: 1.2, label: 'YATAR (B)', current: { x: -15, z: 7 }, optimized: { x: -18, z: 6 } },
        { id: 'doper', name: 'Doper', type: 'cnc', w: 3, d: 2, h: 1.5, label: 'DOPER', current: { x: -9, z: 7 }, optimized: { x: -12, z: 6 } },
        
        // Vacuum Cell
        { id: 'vakum_hazirlik', name: 'Vakum Hazırlık Ürün Stok', type: 'stock', w: 4, d: 3, h: 1, label: 'VAKUM HAZIRLIK', current: { x: 5, z: 7 }, optimized: { x: 5, z: 11 } },
        { id: 'vakum_makinesi', name: 'Vakum Makinesi', type: 'cnc', w: 5, d: 3, h: 1.8, label: 'VAKUM PRES', current: { x: 0, z: 7 }, optimized: { x: 5, z: 8 } },
        { id: 'vakum_bitis', name: 'Presten Çıkan Ürün Stok', type: 'stock', w: 4, d: 3, h: 1, label: 'P. ÇIKAN STOK', current: { x: -5, z: 7 }, optimized: { x: 12, z: 8 } }
    ]
};

// Dynamically generate the 15 presses in the movable list
for (let i = 1; i <= 15; i++) {
    // Alternatif 1: consecutive line under Homag (Z = 5)
    const currentX = -8 + i * 1.0;
    const currentZ = 5.5;

    // Layout B (Optimized): split into Left (1-7) and Right (8-15) rows around Vacuum (X = 5)
    let optX, optZ = 9.5;
    if (i <= 7) {
        // Pres 1-7 on the left: X from -8 to 0 (spaced by 1.3 units)
        optX = -8 + (i - 1) * 1.3;
    } else {
        // Pres 8-15 on the right: X from 9 to 18 (spaced by 1.3 units)
        optX = 9 + (i - 8) * 1.3;
    }

    factoryElements.movable.push({
        id: `pres_${i}`,
        name: `Pres ${i}`,
        type: 'cnc',
        w: 1.0,
        d: 1.5,
        h: 1.8,
        label: `PRES ${i}`,
        current: { x: currentX, z: currentZ },
        optimized: { x: optX, z: optZ }
    });
}

// Machine 3D Object Group mappings
const sceneObjects = {};
let flowLineGroup = new THREE.Group();
let particlesArray = [];

// Initialize application
function init() {
    const container = document.getElementById('canvas-container');
    
    // Create Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.background);
    scene.fog = new THREE.FogExp2(CONFIG.colors.background, 0.01);

    // Create Camera
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 1000);
    resetCameraPosition();

    // Create Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Orbit Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent camera going below floor
    controls.minDistance = 10;
    controls.maxDistance = 170;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(20, 40, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 150;
    const d = 40;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);

    const blueLight = new THREE.PointLight(CONFIG.colors.fixed, 2, 40);
    blueLight.position.set(0, 10, -2);
    scene.add(blueLight);

    const orangeLight = new THREE.PointLight(CONFIG.colors.cnc, 1.5, 30);
    orangeLight.position.set(-15, 8, 5);
    scene.add(orangeLight);

    // Setup Floor, Grid, Walls
    createFactoryBase();

    // Spawn elements in initial positions
    spawnFactoryElements();
    
    // Add Flow Lines group
    scene.add(flowLineGroup);
    scene.add(connectionsGroup);
    scene.add(spaghettiGroup);
    scene.add(safetyZoneGroup);
    scene.add(suggestionGroup);

    // Set up interactive drag listeners
    setupInteractions(container);

    // Hide loader
    document.getElementById('loader').style.opacity = 0;
    setTimeout(() => {
        document.getElementById('loader').style.display = 'none';
    }, 500);

    // Initial Layout Setup & Metrics Update
    setLayout('current');

    // Populate the area calculator with the default factory dimensions
    updateFactoryArea();

    // Start render loop
    animate();
}

// Set up floor and grid visual elements
function createFactoryBase() {
    // Remove any previously built base geometry (used when Alan Hesaplayıcı resizes the factory)
    ['factoryFloor', 'factoryWallBack', 'factoryWallLeft', 'factoryWallRight', 'factoryBorder', 'gridHelper'].forEach(name => {
        const existing = scene.getObjectByName(name);
        if (existing) scene.remove(existing);
    });

    // Floor
    const floorGeo = new THREE.PlaneGeometry(CONFIG.floorSize.width, CONFIG.floorSize.depth);
    const floorMat = new THREE.MeshStandardMaterial({
        color: CONFIG.colors.floor,
        roughness: 0.6,
        metalness: 0.4
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.name = 'factoryFloor';
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Grid
    if (showGrid) {
        const gridHelper = new THREE.GridHelper(
            CONFIG.floorSize.width,
            CONFIG.gridDivisions,
            CONFIG.colors.grid,
            CONFIG.colors.grid
        );
        gridHelper.position.y = 0.01;
        gridHelper.name = 'gridHelper';
        scene.add(gridHelper);
    }

    // Factory Outer Walls: dark, solid facility panels (not the old transparent wireframe look)
    const wallMaterial = new THREE.MeshStandardMaterial({
        color: CONFIG.colors.wallDark,
        transparent: true,
        opacity: 0.94,
        roughness: 0.75,
        metalness: 0.15
    });

    const wallHeight = CONFIG.wallHeight;
    const w = CONFIG.floorSize.width;
    const d = CONFIG.floorSize.depth;

    // Remove any previously built window strips too
    const oldWindows = scene.getObjectByName('windowsGroup');
    if (oldWindows) scene.remove(oldWindows);
    const windowsGroup = new THREE.Group();
    windowsGroup.name = 'windowsGroup';

    // Build a wall panel plus an evenly-spaced row of glowing window panes set slightly in front of it.
    function buildWall(name, boxGeo, position, axis) {
        const wall = new THREE.Mesh(boxGeo, wallMaterial);
        wall.name = name;
        wall.position.copy(position);
        wall.visible = wallVisibility[name];
        wall.receiveShadow = true;
        scene.add(wall);

        if (showWindows) {
            const span = axis === 'x' ? w : d;
            const windowCount = Math.max(3, Math.floor(span / 9));
            const paneW = axis === 'x' ? span / windowCount * 0.55 : 0.18;
            const paneD = axis === 'x' ? 0.18 : span / windowCount * 0.55;
            const paneH = Math.min(wallHeight * 0.32, 2.2);
            const paneY = wallHeight * 0.58;
            const paneMat = new THREE.MeshStandardMaterial({
                color: CONFIG.colors.window, transparent: true, opacity: 0.55,
                emissive: CONFIG.colors.window, emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.6
            });
            for (let i = 0; i < windowCount; i++) {
                const t = (i + 0.5) / windowCount - 0.5; // -0.5..0.5 across the wall span
                const pane = new THREE.Mesh(new THREE.BoxGeometry(paneW, paneH, paneD), paneMat);
                if (axis === 'x') {
                    pane.position.set(position.x + t * span * 0.92, paneY, position.z + (position.z > 0 ? -0.15 : 0.15));
                } else {
                    pane.position.set(position.x + (position.x > 0 ? -0.15 : 0.15), paneY, position.z + t * span * 0.92);
                }
                pane.visible = wallVisibility[name];
                pane.name = name + '_window';
                windowsGroup.add(pane);
            }
        }
    }

    buildWall('factoryWallBack', new THREE.BoxGeometry(w, wallHeight, 0.25), new THREE.Vector3(0, wallHeight/2, -d/2), 'x');
    buildWall('factoryWallLeft', new THREE.BoxGeometry(0.25, wallHeight, d), new THREE.Vector3(-w/2, wallHeight/2, 0), 'z');
    buildWall('factoryWallRight', new THREE.BoxGeometry(0.25, wallHeight, d), new THREE.Vector3(w/2, wallHeight/2, 0), 'z');

    scene.add(windowsGroup);

    // Front boundary outline (thin floor border)
    const borderGeo = new THREE.BoxGeometry(w, 0.1, 0.4);
    const border = new THREE.Mesh(borderGeo, new THREE.MeshBasicMaterial({ color: CONFIG.colors.wallDark }));
    border.name = 'factoryBorder';
    border.position.set(0, 0, d/2);
    scene.add(border);
}

// Toggle the window-pane strips on/off across all walls (rebuilds the base geometry)
function toggleWindows() {
    showWindows = !showWindows;
    createFactoryBase();
    const btn = document.getElementById('btn-toggle-windows');
    if (btn) btn.classList.toggle('active', showWindows);
}
window.toggleWindows = toggleWindows;

// Generate stylish 3D representations of machines
function createMachineMesh(elem) {
    const group = new THREE.Group();
    group.name = elem.id;
    group.userData = { ...elem };

    // Get color based on machine type
    let primaryColor = CONFIG.colors.cnc;
    if (elem.type === 'fixed') primaryColor = CONFIG.colors.fixed;
    if (elem.type === 'office') primaryColor = CONFIG.colors.office;
    if (elem.type === 'stock') primaryColor = CONFIG.colors.stock;
    if (elem.type === 'utility') primaryColor = CONFIG.colors.utility;
    if (elem.type === 'gate') primaryColor = CONFIG.colors.gate;
    if (elem.type === 'forklift_zone') primaryColor = 0xF59E0B;
    if (elem.type === 'column') primaryColor = 0x64748b;
    // User-picked color from the 3D Yerleşim Editörü always wins for custom elements
    if (elem.color) primaryColor = new THREE.Color(elem.color).getHex();

    // 1. Base Structure
    const baseGeo = new THREE.BoxGeometry(elem.w, elem.h, elem.d);
    const baseMat = new THREE.MeshStandardMaterial({
        color: primaryColor,
        roughness: 0.4,
        metalness: 0.5
    });
    
    // Distinct styles for stock piles or complex machines
    if (elem.type === 'stock') {
        // Stock looks like a stack of wooden sheets/pallets
        baseMat.roughness = 0.9;
        baseMat.metalness = 0.1;
        const stackGroup = new THREE.Group();
        
        const palletGeo = new THREE.BoxGeometry(elem.w, 0.15, elem.d);
        const palletMat = new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.9 });
        const pallet = new THREE.Mesh(palletGeo, palletMat);
        pallet.position.y = 0.075;
        pallet.castShadow = true;
        stackGroup.add(pallet);

        const sheetHeight = 0.08;
        const sheetsCount = Math.floor((elem.h - 0.15) / sheetHeight);
        
        for (let i = 0; i < sheetsCount; i++) {
            const sheetGeo = new THREE.BoxGeometry(elem.w * 0.95, sheetHeight - 0.01, elem.d * 0.95);
            // Alternate colors for stacked wood/foam
            const sheetColor = elem.id === 'kopuk_stok' ? 0xe2e8f0 : 0xd97706;
            const sheetMat = new THREE.MeshStandardMaterial({ color: sheetColor, roughness: 0.8 });
            const sheet = new THREE.Mesh(sheetGeo, sheetMat);
            sheet.position.y = 0.15 + (i * sheetHeight) + sheetHeight/2;
            sheet.castShadow = true;
            stackGroup.add(sheet);
        }
        group.add(stackGroup);
    } else if (elem.type === 'gate') {
        // Gates are floor pads with bright red glowing borders
        const gatePad = new THREE.Mesh(
            new THREE.BoxGeometry(elem.w, 0.05, elem.d),
            new THREE.MeshBasicMaterial({ color: primaryColor, transparent: true, opacity: 0.8 })
        );
        gatePad.position.y = 0.025;
        group.add(gatePad);

        const borderGeo = new THREE.BoxGeometry(elem.w + 0.2, 0.1, elem.d + 0.2);
        const borderMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
        const border = new THREE.Mesh(borderGeo, borderMat);
        border.position.y = 0.05;
        group.add(border);
    } else if (elem.id === 'offices') {
        // Office block is semi-transparent glass
        const officeGeo = new THREE.BoxGeometry(elem.w, elem.h, elem.d);
        const officeMat = new THREE.MeshStandardMaterial({
            color: CONFIG.colors.office,
            transparent: true,
            opacity: 0.35,
            roughness: 0.1,
            metalness: 0.9
        });
        const office = new THREE.Mesh(officeGeo, officeMat);
        office.position.y = elem.h / 2;
        group.add(office);
        
        // Inner divider walls
        const wallGeo = new THREE.BoxGeometry(0.1, elem.h, elem.d);
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
        for (let offset = -elem.w/3; offset <= elem.w/3; offset += elem.w/3) {
            const w1 = new THREE.Mesh(wallGeo, wallMat);
            w1.position.set(offset, elem.h/2, 0);
            group.add(w1);
        }
    } else if (elem.type === 'column') {
        // Structural column: a round concrete pillar with a wider footing cap
        const colGeo = new THREE.CylinderGeometry(elem.w / 2, elem.w / 2, elem.h, 16);
        const colMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85, metalness: 0.1 });
        const col = new THREE.Mesh(colGeo, colMat);
        col.position.y = elem.h / 2;
        col.castShadow = true;
        col.receiveShadow = true;
        group.add(col);

        const capGeo = new THREE.CylinderGeometry(elem.w / 2 + 0.15, elem.w / 2 + 0.15, 0.15, 16);
        const cap = new THREE.Mesh(capGeo, colMat);
        cap.position.y = 0.075;
        group.add(cap);

        // Hazard stripe band at typical forklift-impact height
        const bandGeo = new THREE.CylinderGeometry(elem.w / 2 + 0.02, elem.w / 2 + 0.02, 0.3, 16);
        const bandMat = new THREE.MeshBasicMaterial({ color: 0xFBBF24 });
        const band = new THREE.Mesh(bandGeo, bandMat);
        band.position.y = 0.9;
        group.add(band);
    } else if (elem.type === 'fixed') {
        // Main line machines (Torwegge, Homag, ETA)
        // Draw main chassis + conveyor roller top
        const chassis = new THREE.Mesh(baseGeo, baseMat);
        chassis.position.y = elem.h / 2;
        chassis.castShadow = true;
        chassis.receiveShadow = true;
        group.add(chassis);

        // Conveyor roller rollers
        const rollerCount = Math.floor(elem.w / 0.8);
        const rollerGeo = new THREE.CylinderGeometry(0.1, 0.1, elem.d * 0.95, 8);
        const rollerMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.9, roughness: 0.2 });
        
        for (let i = 0; i < rollerCount; i++) {
            const roller = new THREE.Mesh(rollerGeo, rollerMat);
            roller.rotation.x = Math.PI / 2;
            roller.position.set(
                -elem.w/2 + 0.4 + (i * 0.8),
                elem.h + 0.05,
                0
            );
            roller.castShadow = true;
            group.add(roller);
        }

        // Add glowing panel indicators
        const screenGeo = new THREE.PlaneGeometry(0.5, 0.3);
        const screenMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
        const screen = new THREE.Mesh(screenGeo, screenMat);
        screen.position.set(0, elem.h - 0.5, elem.d/2 + 0.01);
        group.add(screen);
    } else {
        // Standard movable machines (CNC, Saws, Utilities)
        const chassis = new THREE.Mesh(baseGeo, baseMat);
        chassis.position.y = elem.h / 2;
        chassis.castShadow = true;
        chassis.receiveShadow = true;
        group.add(chassis);

        // CNC specific: Add routing gantry
        if (elem.id === 'cnc') {
            const archGeo = new THREE.BoxGeometry(0.4, 1.2, elem.d + 0.2);
            const archMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8 });
            const arch = new THREE.Mesh(archGeo, archMat);
            arch.position.set(0, elem.h + 0.6, 0);
            arch.castShadow = true;
            group.add(arch);

            const toolGeo = new THREE.CylinderGeometry(0.08, 0.01, 0.5, 8);
            const tool = new THREE.Mesh(toolGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.9 }));
            tool.position.set(0, elem.h + 0.2, 0);
            group.add(tool);
        }

        // Toz emme specific: add cylindrical silo and pipes
        if (elem.id === 'toz_emme') {
            // Remove chassis, construct silo
            group.remove(chassis);
            const siloGeo = new THREE.CylinderGeometry(elem.w/2, elem.w/2, elem.h * 0.7, 16);
            const silo = new THREE.Mesh(siloGeo, baseMat);
            silo.position.y = elem.h * 0.65;
            silo.castShadow = true;
            group.add(silo);

            const standGeo = new THREE.BoxGeometry(elem.w * 0.9, elem.h * 0.3, elem.d * 0.9);
            const stand = new THREE.Mesh(standGeo, new THREE.MeshStandardMaterial({ color: 0x0f172a, wireframe: true }));
            stand.position.y = elem.h * 0.15;
            group.add(stand);
        }
    }

    // Floating text label (Canvas textures)
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256;
    labelCanvas.height = 64;
    const ctx = labelCanvas.getContext('2d');
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.lineWidth = 2;
    ctx.strokeStyle = primaryColor.toString(16);
    ctx.strokeRect(2, 2, 252, 60);
    const icon = TYPE_ICONS[elem.type] || '⚙️';
    ctx.font = '28px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, 8, 32);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(elem.label, 140, 32);

    const texture = new THREE.CanvasTexture(labelCanvas);
    const labelMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const labelSprite = new THREE.Sprite(labelMat);
    labelSprite.scale.set(4, 1, 1);
    labelSprite.position.set(0, elem.h + 0.8, 0);
    labelSprite.name = 'label';
    group.add(labelSprite);

    // Collision/Border box for custom layout mode (initially hidden)
    const borderGeo = new THREE.BoxGeometry(elem.w + 0.4, 0.05, elem.d + 0.4);
    const borderMat = new THREE.MeshBasicMaterial({
        color: CONFIG.colors.activeBorder,
        transparent: true,
        opacity: 0.0,
        depthWrite: false
    });
    const activeBorderMesh = new THREE.Mesh(borderGeo, borderMat);
    activeBorderMesh.position.y = 0.01;
    activeBorderMesh.name = 'activeBorder';
    group.add(activeBorderMesh);

    return group;
}

// Spawn all elements on floor
function spawnFactoryElements() {
    // Fixed elements
    factoryElements.fixed.forEach(elem => {
        const mesh = createMachineMesh(elem);
        mesh.position.set(elem.x, 0, elem.z);
        scene.add(mesh);
        sceneObjects[elem.id] = mesh;
    });

    // Movable elements
    factoryElements.movable.forEach(elem => {
        const mesh = createMachineMesh(elem);
        // Position initially at current layout coords
        mesh.position.set(elem.current.x, 0, elem.current.z);
        scene.add(mesh);
        sceneObjects[elem.id] = mesh;
    });
}

// Set active Layout preset
function setLayout(type) {
    currentLayout = type;
    
    // Update button active state
    document.querySelectorAll('.layout-selector .btn').forEach(btn => btn.classList.remove('active'));
    if (type === 'current') document.getElementById('btn-layout-a').classList.add('active');
    if (type === 'optimized') document.getElementById('btn-layout-b').classList.add('active');
    if (type === 'custom') document.getElementById('btn-layout-custom').classList.add('active');

    // Show/hide drag indicators
    const customInstructions = document.getElementById('custom-instructions');
    customInstructions.style.display = type === 'custom' ? 'flex' : 'none';

    factoryElements.movable.forEach(elem => {
        const obj = sceneObjects[elem.id];
        if (!obj) return;

        // Visual drag border toggle
        const border = obj.getObjectByName('activeBorder');
        if (border) {
            border.material.opacity = type === 'custom' ? 0.6 : 0.0;
        }

        if (type === 'current') {
            animateMove(obj, elem.current.x, elem.current.z);
        } else if (type === 'optimized') {
            animateMove(obj, elem.optimized.x, elem.optimized.z);
        }
    });

    // Recalculate metrics
    setTimeout(() => {
        calculateMetrics();
        recreateFlowPaths();
    }, 350);
}
window.setLayout = setLayout; // Expose to global window scope

// Smoothly slide machines to preset locations
function animateMove(obj, targetX, targetZ) {
    const duration = 250; // ms
    const startX = obj.position.x;
    const startZ = obj.position.z;
    const startTime = performance.now();

    function update() {
        const now = performance.now();
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing outQuad
        const eased = progress * (2 - progress);

        obj.position.x = startX + (targetX - startX) * eased;
        obj.position.z = startZ + (targetZ - startZ) * eased;

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            // Ensure absolute precision
            obj.position.x = targetX;
            obj.position.z = targetZ;
        }
    }
    requestAnimationFrame(update);
}

// Camera Modes
function setViewMode(mode) {
    viewMode = mode;
    document.querySelectorAll('.view-mode .mode-btn').forEach(btn => btn.classList.remove('active'));
    
    if (mode === '2d') {
        document.getElementById('btn-2d').classList.add('active');
        // Set camera directly above, looking down
        const duration = 500;
        const startPos = camera.position.clone();
        const startTarget = controls.target.clone();
        const targetPos = new THREE.Vector3(0, 68, 0.001);
        const targetTarget = new THREE.Vector3(0, 0, 0);

        const startTime = performance.now();
        function update() {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1);
            const ease = t * (2 - t);
            
            camera.position.lerpVectors(startPos, targetPos, ease);
            controls.target.lerpVectors(startTarget, targetTarget, ease);
            controls.update();

            if (t < 1) requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
        controls.enableRotate = false;
    } else {
        document.getElementById('btn-3d').classList.add('active');
        controls.enableRotate = true;
        resetCameraPosition();
    }
}
window.setViewMode = setViewMode;

function resetCameraPosition() {
    const targetPos = new THREE.Vector3(0, 45, 62);
    const targetTarget = new THREE.Vector3(0, 0, 0);

    if (!controls) {
        // Initial load camera setup (instant, no animation needed)
        camera.position.copy(targetPos);
        return;
    }

    const duration = 500;
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const startTime = performance.now();
    
    function update() {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const ease = t * (2 - t);
        
        camera.position.lerpVectors(startPos, targetPos, ease);
        controls.target.lerpVectors(startTarget, targetTarget, ease);
        controls.update();

        if (t < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}
window.resetCamera = resetCameraPosition;

// Toggle Visual Helpers
function toggleFlowLines() {
    showFlowLines = !showFlowLines;
    flowLineGroup.visible = showFlowLines;
    document.getElementById('toggle-flow').classList.toggle('active', showFlowLines);
    const simCheckbox = document.getElementById('sim-toggle-flow');
    if (simCheckbox) simCheckbox.checked = showFlowLines;
}
window.toggleFlowLines = toggleFlowLines;

function toggleGrid() {
    showGrid = !showGrid;
    const grid = scene.getObjectByName('gridHelper');
    if (grid) grid.visible = showGrid;
    document.getElementById('toggle-grid').classList.toggle('active', showGrid);
}
window.toggleGrid = toggleGrid;
window.toggleRuler = toggleRuler;
window.clearMeasurements = clearMeasurements;
window.updateCostAnalysis = updateCostAnalysis;

// Drag and Drop implementation
function setupInteractions(container) {
    container.addEventListener('pointerdown', onPointerDown, false);
    container.addEventListener('pointermove', onPointerMove, false);
    container.addEventListener('pointerup', onPointerUp, false);
    
    // Touch support for mobiles/tablets
    container.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            e.preventDefault();
            mouse.x = (e.touches[0].clientX / container.clientWidth) * 2 - 1;
            mouse.y = -(e.touches[0].clientY / container.clientHeight) * 2 + 1;
            onPointerDown(e.touches[0]);
        }
    }, { passive: false });
    
    container.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) {
            mouse.x = (e.touches[0].clientX / container.clientWidth) * 2 - 1;
            mouse.y = -(e.touches[0].clientY / container.clientHeight) * 2 + 1;
            onPointerMove(e.touches[0]);
        }
    }, { passive: true });

    container.addEventListener('touchend', onPointerUp, { passive: true });
}

function onPointerDown(event) {
    const clientX0 = event.clientX || event.pageX;
    const clientY0 = event.clientY || event.pageY;
    pointerDownPos = { x: clientX0, y: clientY0 };

    if (rulerActive) {
        handleRulerClick(event);
        return;
    }

    if (connectionModeActive) {
        handleConnectionClick(event);
        return;
    }

    if (currentLayout !== 'custom') return;

    // Get correct mouse coords for container
    const rect = renderer.domElement.getBoundingClientRect();
    const clientX = event.clientX || event.pageX;
    const clientY = event.clientY || event.pageY;
    
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    
    // Raycast only against movable elements
    const draggableObjects = factoryElements.movable.map(elem => sceneObjects[elem.id]).filter(Boolean);
    const intersects = raycaster.intersectObjects(draggableObjects, true);

    if (intersects.length > 0) {
        // Walk up to find the root Group
        let obj = intersects[0].object;
        while (obj && obj.parent !== scene) {
            obj = obj.parent;
        }

        if (obj) {
            selectedObject = obj;
            controls.enabled = false; // Disable orbit controls during drag
            
            // Set dragging plane
            plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), selectedObject.position);
            
            // Offset from center of object
            if (raycaster.ray.intersectPlane(plane, dragIntersection)) {
                dragOffset.copy(selectedObject.position).sub(dragIntersection);
            }
            
            // Highlight color border
            const border = selectedObject.getObjectByName('activeBorder');
            if (border) border.material.color.setHex(0xffffff); // White highlight on drag

            // Snapshot current efficiency metrics as the baseline for this move
            dragStartMetrics = calculateMetrics();
            const badge = document.getElementById('score-delta');
            if (badge) {
                badge.textContent = selectedObject.userData.name + ' taşınıyor...';
                badge.className = 'score-delta neutral visible';
            }
        }
    }
}

function onPointerMove(event) {
    if (currentLayout !== 'custom' || !selectedObject) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const clientX = event.clientX || event.pageX;
    const clientY = event.clientY || event.pageY;

    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    
    if (raycaster.ray.intersectPlane(plane, dragIntersection)) {
        let newPos = dragIntersection.clone().add(dragOffset);
        
        // Grid Snap (Snap to 0.5 unit)
        newPos.x = Math.round(newPos.x * 2) / 2;
        newPos.z = Math.round(newPos.z * 2) / 2;

        // Boundaries confinement (keep inside factory floor size)
        const marginX = selectedObject.userData.w / 2 + 0.5;
        const marginZ = selectedObject.userData.d / 2 + 0.5;
        const limitX = CONFIG.floorSize.width / 2 - marginX;
        const limitZ = CONFIG.floorSize.depth / 2 - marginZ;

        newPos.x = Math.max(-limitX, Math.min(limitX, newPos.x));
        newPos.z = Math.max(-limitZ, Math.min(limitZ, newPos.z));

        // Update position
        selectedObject.position.copy(newPos);
        
        // Live updates
        const liveMetrics = calculateMetrics();
        recreateFlowPaths();

        // Show how much this specific move changed the efficiency vs. when it was picked up
        if (dragStartMetrics) {
            updateDragDeltaBadge(selectedObject.userData.name, dragStartMetrics, liveMetrics);
        }
    }
}

// Show a live "score changed by X" readout while a machine is being dragged
function updateDragDeltaBadge(elemName, before, after) {
    const badge = document.getElementById('score-delta');
    if (!badge) return;

    const scoreDelta = after.overallScore - before.overallScore;
    const distDelta = after.finalDistanceMeters - before.finalDistanceMeters;
    const distText = (distDelta > 0 ? '+' : '') + distDelta + ' m';

    let icon = '●';
    let cls = 'neutral';
    if (scoreDelta > 0) { icon = '▲'; cls = 'up'; }
    else if (scoreDelta < 0) { icon = '▼'; cls = 'down'; }

    const scoreText = (scoreDelta > 0 ? '+' : '') + scoreDelta;
    badge.textContent = `${icon} ${elemName}: skor ${scoreText} puan, mesafe ${distText}`;
    badge.className = 'score-delta visible ' + cls;
}

// --- 3D YERLEŞİM EDİTÖRÜ (custom elements) ---
const CUSTOM_TYPE_DEFAULTS = {
    cnc: { w: 2, d: 2, h: 1.6, labelPrefix: 'MAKİNE' },
    stock: { w: 3, d: 2, h: 1.2, labelPrefix: 'STOK' },
    office: { w: 4, d: 3, h: 2.5, labelPrefix: 'OFİS' },
    utility: { w: 1.5, d: 1.5, h: 2, labelPrefix: 'ÜNİTE' },
    forklift_zone: { w: 2.5, d: 2.5, h: 0.4, labelPrefix: 'FORKLİFT' },
    column: { w: 0.7, d: 0.7, h: 6, labelPrefix: 'KOLON' }
};

// Visual, icon-based type picker (replaces the old plain <select>) — clicking a card selects
// the machine/element type and gives an immediate visual representation of what will be added.
function selectNewElemType(type, btn) {
    selectedNewElemType = type;
    document.querySelectorAll('.type-card').forEach(card => card.classList.remove('active'));
    if (btn) btn.classList.add('active');
}
window.selectNewElemType = selectNewElemType;

function addCustomElement() {
    const nameInput = document.getElementById('new-elem-name');
    const colorInput = document.getElementById('new-elem-color');

    const type = selectedNewElemType;
    const defaults = CUSTOM_TYPE_DEFAULTS[type] || CUSTOM_TYPE_DEFAULTS.cnc;
    const name = (nameInput.value || '').trim() || (defaults.labelPrefix + ' ' + (customElementCounter + 1));

    customElementCounter++;
    const id = 'custom_' + customElementCounter;

    // Spread new elements out near the front of the floor so they don't spawn stacked on top of each other
    const col = (customElementCounter - 1) % 8;
    const row = Math.floor((customElementCounter - 1) / 8);
    const startX = -CONFIG.floorSize.width / 2 + defaults.w;
    const startZ = CONFIG.floorSize.depth / 2 - defaults.d;
    const x = startX + col * (defaults.w + 1.5);
    const z = startZ - row * (defaults.d + 1.5);

    const elem = {
        id,
        name,
        type,
        custom: true,
        color: colorInput.value,
        w: defaults.w,
        d: defaults.d,
        h: defaults.h,
        label: name.toUpperCase(),
        current: { x, z },
        optimized: { x, z }
    };

    factoryElements.movable.push(elem);

    const mesh = createMachineMesh(elem);
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    sceneObjects[id] = mesh;

    // Show the drag border immediately if we're already in Serbest Tasarım mode
    const border = mesh.getObjectByName('activeBorder');
    if (border) border.material.opacity = currentLayout === 'custom' ? 0.6 : 0.0;

    nameInput.value = '';
    updateFactoryArea();
    renderCustomElementsList();
}
window.addCustomElement = addCustomElement;

function renderCustomElementsList() {
    const container = document.getElementById('custom-elements-list');
    if (!container) return;

    const customEls = factoryElements.movable.filter(e => e.custom);
    if (customEls.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = customEls.map(elem => `
        <div class="custom-elem-item">
            <span class="custom-elem-swatch" style="background:${elem.color || '#38BDF8'}"></span>
            <span class="custom-elem-name">${elem.name}</span>
            <button class="btn-elem-remove" onclick="window.removeCustomElement('${elem.id}')" title="Bu elemanı sil">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `).join('');
}

function removeCustomElement(id) {
    const idx = factoryElements.movable.findIndex(e => e.id === id);
    if (idx === -1) return;

    const mesh = sceneObjects[id];
    if (mesh) {
        scene.remove(mesh);
        delete sceneObjects[id];
    }
    factoryElements.movable.splice(idx, 1);

    // Also drop any custom connections that referenced this element
    customConnections = customConnections.filter(c => {
        if (c.fromId === id || c.toId === id) {
            connectionsGroup.remove(c.line);
            if (c.vehicleMesh) connectionsGroup.remove(c.vehicleMesh);
            return false;
        }
        return true;
    });

    selectedDetailElement = null;
    document.getElementById('element-details').innerHTML = 'Detaylarını görmek için 3D sahnedeki herhangi bir makine, stok alanı veya odaya tıklayın.';
    updateFactoryArea();
    calculateMetrics();
    recreateFlowPaths();
    renderCustomElementsList();
}
window.removeCustomElement = removeCustomElement;

// --- COST ANALYSIS ---
// Uses the total material-flow distance plus user-entered assumptions (₺/metre/sefer, günlük sefer, yıllık gün)
// to give a live, editable logistics cost estimate for the current layout.
function updateCostAnalysis(distanceMetersOverride) {
    const costPerMeterInput = document.getElementById('cost-per-meter');
    const tripsInput = document.getElementById('trips-per-day');
    const daysInput = document.getElementById('days-per-year');
    if (!costPerMeterInput || !tripsInput || !daysInput) return;

    const costPerMeter = parseFloat(costPerMeterInput.value) || 0;
    const trips = parseFloat(tripsInput.value) || 0;
    const days = parseFloat(daysInput.value) || 0;
    const distanceMeters = typeof distanceMetersOverride === 'number' ? distanceMetersOverride : lastDistanceMeters;

    const dailyCost = Math.round(distanceMeters * costPerMeter * trips);
    const yearlyCost = Math.round(dailyCost * days);

    const dailyEl = document.getElementById('cost-daily');
    const yearlyEl = document.getElementById('cost-yearly');
    if (dailyEl) dailyEl.textContent = '₺' + dailyCost.toLocaleString('tr-TR');
    if (yearlyEl) yearlyEl.textContent = '₺' + yearlyCost.toLocaleString('tr-TR');

    const savingsRow = document.getElementById('cost-savings-row');
    const savingsEl = document.getElementById('cost-savings');
    if (!savingsRow || !savingsEl) return;

    if (baselineDistanceMeters !== null && currentLayout !== 'current') {
        const baselineYearly = Math.round(baselineDistanceMeters * costPerMeter * trips * days);
        const diff = yearlyCost - baselineYearly;
        savingsRow.style.display = 'flex';
        savingsEl.textContent = (diff <= 0 ? '-₺' : '+₺') + Math.abs(diff).toLocaleString('tr-TR');
        savingsEl.className = diff <= 0 ? 'positive' : 'negative';
    } else {
        savingsRow.style.display = 'none';
    }
}

// --- BAĞLANTI KURMA MODU (custom material-flow / forklift connections) ---
function toggleConnectionMode() {
    connectionModeActive = !connectionModeActive;
    if (connectionPendingId) resetPendingBorder(connectionPendingId);
    connectionPendingId = null;

    const btn = document.getElementById('btn-connection-mode');
    const status = document.getElementById('connection-mode-status');
    const hint = document.getElementById('connection-hint');
    if (btn) btn.classList.toggle('active', connectionModeActive);
    if (status) status.textContent = connectionModeActive ? 'AÇIK' : 'KAPALI';
    if (hint) hint.textContent = connectionModeActive
        ? 'Kaynak eleman olarak bir makineye tıklayın.'
        : 'Bağlantı modunu açın, sırayla 3D sahnede kaynak ve hedef makinelere tıklayın.';

    controls.enabled = !connectionModeActive; // precise picking needs the camera to hold still
    renderer.domElement.style.cursor = connectionModeActive ? 'crosshair' : 'default';
}
window.toggleConnectionMode = toggleConnectionMode;

function resetPendingBorder(id) {
    const obj = sceneObjects[id];
    if (!obj) return;
    const border = obj.getObjectByName('activeBorder');
    if (border) {
        border.material.color.setHex(CONFIG.colors.activeBorder);
        border.material.opacity = currentLayout === 'custom' ? 0.6 : 0.0;
    }
}

function handleConnectionClick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const clientX = event.clientX || event.pageX;
    const clientY = event.clientY || event.pageY;
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const allObjects = [...factoryElements.fixed, ...factoryElements.movable].map(e => sceneObjects[e.id]).filter(Boolean);
    const intersects = raycaster.intersectObjects(allObjects, true);
    if (intersects.length === 0) return;

    let obj = intersects[0].object;
    while (obj && obj.parent !== scene) obj = obj.parent;
    if (!obj) return;

    const id = obj.name;
    const hint = document.getElementById('connection-hint');

    if (!connectionPendingId) {
        connectionPendingId = id;
        const border = obj.getObjectByName('activeBorder');
        if (border) { border.material.color.setHex(0xffffff); border.material.opacity = 0.7; }
        if (hint) hint.textContent = '"' + (obj.userData.name || id) + '" kaynak seçildi. Şimdi hedef elemana tıklayın.';
    } else if (connectionPendingId === id) {
        resetPendingBorder(connectionPendingId);
        connectionPendingId = null;
        if (hint) hint.textContent = 'Seçim iptal edildi. Kaynak eleman olarak bir makineye tıklayın.';
    } else {
        const kind = document.getElementById('connection-kind').value;
        createCustomConnection(connectionPendingId, id, kind);
        suggestOptimalPosition(connectionPendingId, id, kind);
        resetPendingBorder(connectionPendingId);
        connectionPendingId = null;
        if (hint) hint.textContent = 'Bağlantı oluşturuldu! Aşağıda konum önerisini görebilirsiniz.';
    }
}

function createCustomConnection(fromId, toId, kind) {
    const fromObj = sceneObjects[fromId];
    const toObj = sceneObjects[toId];
    if (!fromObj || !toObj) return null;

    const color = kind === 'forklift' ? 0xF59E0B : 0x38BDF8;
    const p1 = fromObj.position.clone(); p1.y = kind === 'forklift' ? 0.05 : 0.15;
    const p2 = toObj.position.clone(); p2.y = kind === 'forklift' ? 0.05 : 0.15;

    // Forklifts drive down aisles, not diagonally through machines - route with one 90° turn (Manhattan-style)
    const curve = kind === 'forklift'
        ? new THREE.CatmullRomCurve3([p1, new THREE.Vector3(p1.x, p1.y, p2.z), p2])
        : new THREE.CatmullRomCurve3([p1, p2]);

    const tubeGeo = new THREE.TubeGeometry(curve, 30, kind === 'forklift' ? 0.1 : 0.08, 8, false);
    const tubeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: kind === 'forklift' ? 0.4 : 0.75 });
    const line = new THREE.Mesh(tubeGeo, tubeMat);
    connectionsGroup.add(line);

    let vehicleMesh = null;
    if (kind === 'forklift') {
        vehicleMesh = createForkliftMesh();
        vehicleMesh.position.copy(p1);
        connectionsGroup.add(vehicleMesh);
    }

    const connection = { fromId, toId, kind, line, vehicleMesh, curve, progress: Math.random(), speed: kind === 'forklift' ? 0.0025 : 0.005 };
    customConnections.push(connection);
    return connection;
}

// Build a small, recognizable forklift model (chassis, cabin, mast, forks, wheels).
// The forks point toward local -Z, matching THREE's lookAt() "-Z faces target" convention,
// so orienting the group along the travel direction each frame works without extra rotation.
function createForkliftMesh() {
    const group = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(0.65, 0.5, 1.0);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xF59E0B, metalness: 0.4, roughness: 0.5 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, 0.35, 0.15);
    body.castShadow = true;
    group.add(body);

    const cabinGeo = new THREE.BoxGeometry(0.5, 0.4, 0.4);
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, transparent: true, opacity: 0.7 });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 0.75, 0.35);
    group.add(cabin);

    const mastGeo = new THREE.BoxGeometry(0.55, 1.1, 0.06);
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7 });
    const mast = new THREE.Mesh(mastGeo, mastMat);
    mast.position.set(0, 0.65, -0.38);
    group.add(mast);

    const forkGeo = new THREE.BoxGeometry(0.1, 0.05, 0.5);
    const forkMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 });
    const fork1 = new THREE.Mesh(forkGeo, forkMat);
    fork1.position.set(-0.15, 0.12, -0.65);
    group.add(fork1);
    const fork2 = fork1.clone();
    fork2.position.x = 0.15;
    group.add(fork2);

    const wheelGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.12, 10);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });
    [[-0.3, 0.15, -0.25], [0.3, 0.15, -0.25], [-0.3, 0.15, 0.45], [0.3, 0.15, 0.45]].forEach(([x, y, z]) => {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, y, z);
        group.add(wheel);
    });

    return group;
}

function resetCustomConnections() {
    customConnections.forEach(c => {
        connectionsGroup.remove(c.line);
        if (c.vehicleMesh) connectionsGroup.remove(c.vehicleMesh);
    });
    customConnections = [];
    connectionPendingId = null;
    const hint = document.getElementById('connection-hint');
    if (hint) hint.textContent = 'Bağlantı modunu açın, sırayla 3D sahnede kaynak ve hedef makinelere tıklayın.';
}
window.resetCustomConnections = resetCustomConnections;

// Keep every custom connection's geometry glued to its two endpoints as they get dragged around
function updateCustomConnections() {
    customConnections.forEach(c => {
        const fromObj = sceneObjects[c.fromId];
        const toObj = sceneObjects[c.toId];
        if (!fromObj || !toObj) return;
        const p1 = fromObj.position.clone(); p1.y = c.kind === 'forklift' ? 0.05 : 0.15;
        const p2 = toObj.position.clone(); p2.y = c.kind === 'forklift' ? 0.05 : 0.15;
        c.curve = c.kind === 'forklift'
            ? new THREE.CatmullRomCurve3([p1, new THREE.Vector3(p1.x, p1.y, p2.z), p2])
            : new THREE.CatmullRomCurve3([p1, p2]);
        c.line.geometry.dispose();
        c.line.geometry = new THREE.TubeGeometry(c.curve, 30, c.kind === 'forklift' ? 0.1 : 0.08, 8, false);
    });
}

// --- KONUM ÖNERİSİ (best-position suggestion when a connection is made) ---
function getElemData(id) {
    return [...factoryElements.fixed, ...factoryElements.movable].find(e => e.id === id);
}

// Pushes `pos` out of any bounding-box overlap with other placed elements (except excludeId),
// so a suggested spot doesn't land the target directly inside another machine.
function resolveOverlap(pos, elem, excludeId) {
    const others = [...factoryElements.fixed, ...factoryElements.movable].filter(e => e.id !== excludeId);
    for (let iter = 0; iter < 6; iter++) {
        let moved = false;
        for (const other of others) {
            const otherObj = sceneObjects[other.id];
            if (!otherObj) continue;
            const dx = pos.x - otherObj.position.x;
            const dz = pos.z - otherObj.position.z;
            const overlapX = (elem.w / 2 + other.w / 2 + 0.4) - Math.abs(dx);
            const overlapZ = (elem.d / 2 + other.d / 2 + 0.4) - Math.abs(dz);
            if (overlapX > 0 && overlapZ > 0) {
                moved = true;
                if (overlapX < overlapZ) {
                    pos.x += (dx >= 0 ? 1 : -1) * overlapX;
                } else {
                    pos.z += (dz >= 0 ? 1 : -1) * overlapZ;
                }
            }
        }
        if (!moved) break;
    }
    return pos;
}

// Suggests the best location for an element based on EVERY connection it currently has
// (not just the pair just linked), and biases the result toward nearby forklift/transport
// zones when any of those connections is a forklift route — so vehicle access is preserved.
function suggestOptimalPosition(fromId, toId, kind) {
    const movableIds = new Set(factoryElements.movable.map(e => e.id));
    // Prefer repositioning the just-linked target end; if it's a fixed element (office), try the source instead
    const targetId = movableIds.has(toId) ? toId : (movableIds.has(fromId) ? fromId : null);
    if (!targetId) {
        showConnectionSuggestion(null);
        return;
    }

    const targetElem = getElemData(targetId);
    const targetObj = sceneObjects[targetId];
    if (!targetElem || !targetObj) return;

    // Gather EVERY connection touching this element (multi-connection aware), not just the new one.
    const links = customConnections
        .filter(c => c.fromId === targetId || c.toId === targetId)
        .map(c => {
            const anchorId = c.fromId === targetId ? c.toId : c.fromId;
            const anchorObj = sceneObjects[anchorId];
            const anchorElem = getElemData(anchorId);
            return anchorObj && anchorElem ? { anchorId, anchorObj, anchorElem, kind: c.kind } : null;
        })
        .filter(Boolean);
    if (links.length === 0) return;

    const currentDist = links.reduce((sum, l) => sum + targetObj.position.distanceTo(l.anchorObj.position), 0) * UNIT_TO_METER;

    // 1) Centroid of every connected element = the position that minimizes total travel to all of them.
    let idealPos = new THREE.Vector3();
    links.forEach(l => idealPos.add(l.anchorObj.position));
    idealPos.divideScalar(links.length);

    // 2) Transport-vehicle awareness: if any link is a forklift route, pull the result toward the
    // nearest forklift/transport parking zone so the element stays reachable by vehicle aisles.
    const hasForkliftLink = links.some(l => l.kind === 'forklift');
    const forkliftZones = factoryElements.movable.filter(e => e.type === 'forklift_zone');
    if (hasForkliftLink && forkliftZones.length > 0) {
        let nearest = null, nearestDist = Infinity;
        forkliftZones.forEach(fz => {
            const fzObj = sceneObjects[fz.id];
            if (!fzObj) return;
            const dist = idealPos.distanceTo(fzObj.position);
            if (dist < nearestDist) { nearestDist = dist; nearest = fzObj; }
        });
        if (nearest) idealPos.lerp(nearest.position, 0.25);
    }

    // Keep it inside the factory floor
    const marginX = targetElem.w / 2 + 0.5;
    const marginZ = targetElem.d / 2 + 0.5;
    const limitX = CONFIG.floorSize.width / 2 - marginX;
    const limitZ = CONFIG.floorSize.depth / 2 - marginZ;
    idealPos.x = Math.max(-limitX, Math.min(limitX, idealPos.x));
    idealPos.z = Math.max(-limitZ, Math.min(limitZ, idealPos.z));

    // 3) Nudge out of any overlap with other machines/storage.
    resolveOverlap(idealPos, targetElem, targetId);
    idealPos.x = Math.max(-limitX, Math.min(limitX, idealPos.x));
    idealPos.z = Math.max(-limitZ, Math.min(limitZ, idealPos.z));

    const newDist = links.reduce((sum, l) => sum + idealPos.distanceTo(l.anchorObj.position), 0) * UNIT_TO_METER;
    const savings = currentDist - newDist;
    const savingsPct = currentDist > 0 ? Math.round((savings / currentDist) * 100) : 0;

    pendingSuggestion = { targetId, idealPos: idealPos.clone() };
    showConnectionSuggestion({
        targetElem, idealPos, currentDist, newDist, savings, savingsPct, kind,
        linkCount: links.length, hasForkliftLink,
        anchorNames: links.map(l => l.anchorElem.name)
    });
    renderSuggestionGhost(targetElem, idealPos);
}

function showConnectionSuggestion(data) {
    const box = document.getElementById('connection-suggestion');
    if (!box) return;

    if (!data) {
        box.style.display = 'block';
        box.innerHTML = '<p>Bu iki eleman da sabit (ofis/kapı) olduğu için bir konum önerisi sunulamıyor.</p>';
        return;
    }

    const multiNote = data.linkCount > 1
        ? `Bu eleman toplam <strong>${data.linkCount} bağlantıya</strong> sahip (${data.anchorNames.join(', ')}); öneri hepsine olan toplam mesafeyi en aza indirecek şekilde hesaplandı.`
        : `Öneri, ${data.anchorNames[0]} elemanına olan bağlantı dikkate alınarak hesaplandı.`;
    const forkliftNote = data.hasForkliftLink
        ? ' Forklift rotası da bulunduğu için konum, en yakın forklift/taşıma aracı park alanına erişimi korumak üzere ayarlandı.'
        : '';

    let verdict;
    if (data.savings > 0.3) {
        verdict = `${data.targetElem.name} önerilen konuma taşınırsa toplam bağlantı mesafesi <strong>${data.savings.toFixed(1)} m (%${data.savingsPct})</strong> kısalır — daha az yürüme/taşıma süresi ve daha düşük geri akış riski demektir.`;
    } else {
        verdict = 'Mevcut konum bu bağlantılar için zaten iyi; önerilen konum toplam mesafeyi belirgin şekilde değiştirmiyor.';
    }

    box.style.display = 'block';
    box.innerHTML = `
        <div class="suggestion-title"><i class="fa-solid fa-wand-magic-sparkles"></i> Konum Önerisi</div>
        <p>${multiNote}${forkliftNote}</p>
        <div class="suggestion-stats">
            <span>Mevcut toplam mesafe<br><strong>${data.currentDist.toFixed(1)} m</strong></span>
            <span>Önerilen toplam mesafe<br><strong>${data.newDist.toFixed(1)} m</strong></span>
        </div>
        <p class="suggestion-verdict">${verdict}</p>
        <div class="suggestion-actions">
            <button class="btn-apply-suggestion" onclick="window.applySuggestion()"><i class="fa-solid fa-check"></i> Öneriyi Uygula</button>
            <button class="btn-dismiss-suggestion" onclick="window.dismissSuggestion()"><i class="fa-solid fa-xmark"></i> Kapat</button>
        </div>
    `;
}

function renderSuggestionGhost(elem, pos) {
    while (suggestionGroup.children.length > 0) suggestionGroup.remove(suggestionGroup.children[0]);

    const ghostGeo = new THREE.BoxGeometry(elem.w, elem.h, elem.d);
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x34D399, wireframe: true, transparent: true, opacity: 0.8 });
    const ghost = new THREE.Mesh(ghostGeo, ghostMat);
    ghost.position.set(pos.x, elem.h / 2, pos.z);
    ghost.name = 'suggestionGhost';
    suggestionGroup.add(ghost);

    const padGeo = new THREE.PlaneGeometry(elem.w, elem.d);
    const padMat = new THREE.MeshBasicMaterial({ color: 0x34D399, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(pos.x, 0.04, pos.z);
    suggestionGroup.add(pad);
}

function clearSuggestionGhost() {
    while (suggestionGroup.children.length > 0) suggestionGroup.remove(suggestionGroup.children[0]);
}

function applySuggestion() {
    if (!pendingSuggestion) return;
    const obj = sceneObjects[pendingSuggestion.targetId];
    if (obj) {
        animateMove(obj, pendingSuggestion.idealPos.x, pendingSuggestion.idealPos.z);
        setTimeout(() => { calculateMetrics(); recreateFlowPaths(); }, 260);
    }
    clearSuggestionGhost();
    const box = document.getElementById('connection-suggestion');
    if (box) box.style.display = 'none';
    pendingSuggestion = null;
}
window.applySuggestion = applySuggestion;

function dismissSuggestion() {
    clearSuggestionGhost();
    const box = document.getElementById('connection-suggestion');
    if (box) box.style.display = 'none';
    pendingSuggestion = null;
}
window.dismissSuggestion = dismissSuggestion;

// --- SPAGETTİ DİYAGRAMI ---
// Overlays every material-flow route AND every custom connection as plain straight crossing lines,
// so the tangle ("spaghetti") of paths is visible at a glance.
function renderSpaghettiDiagram() {
    while (spaghettiGroup.children.length > 0) spaghettiGroup.remove(spaghettiGroup.children[0]);
    if (!spaghettiVisible) return;

    const allPairs = [
        ...lastFlowRoutes.map(r => ({ from: r.from, to: r.to })),
        ...customConnections.map(c => ({ from: c.fromId, to: c.toId }))
    ];

    allPairs.forEach(pair => {
        const fromObj = sceneObjects[pair.from];
        const toObj = sceneObjects[pair.to];
        if (!fromObj || !toObj) return;
        const p1 = fromObj.position.clone(); p1.y = 0.4;
        const p2 = toObj.position.clone(); p2.y = 0.4;
        const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
        spaghettiGroup.add(new THREE.Line(geo, mat));
    });
}

function toggleSpaghettiDiagram() {
    spaghettiVisible = !spaghettiVisible;
    renderSpaghettiDiagram();
}
window.toggleSpaghettiDiagram = toggleSpaghettiDiagram;

// --- İŞ GÜVENLİĞİ SINIRLARI ---
function renderSafetyZones() {
    while (safetyZoneGroup.children.length > 0) safetyZoneGroup.remove(safetyZoneGroup.children[0]);
    if (!safetyZonesVisible) return;

    factoryElements.movable.forEach(elem => {
        const obj = sceneObjects[elem.id];
        if (!obj) return;
        const radius = Math.max(elem.w, elem.d) / 2 + 1.2;
        const ringGeo = new THREE.RingGeometry(radius - 0.1, radius, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xFBBF24, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(obj.position);
        ring.position.y = 0.03;
        safetyZoneGroup.add(ring);
    });
}

function toggleSafetyZones() {
    safetyZonesVisible = !safetyZonesVisible;
    renderSafetyZones();
}
window.toggleSafetyZones = toggleSafetyZones;

function updateFlowSpeed() {
    const slider = document.getElementById('sim-flow-speed');
    flowSpeedMultiplier = parseFloat(slider.value) || 1;
}
window.updateFlowSpeed = updateFlowSpeed;

// --- ALAN & METREKARE HESAPLAYICI ---
function updateFactoryArea() {
    const widthInput = document.getElementById('factory-width-m');
    const depthInput = document.getElementById('factory-depth-m');
    if (!widthInput || !depthInput) return;

    const widthM = parseFloat(widthInput.value) || CONFIG.floorSize.width * UNIT_TO_METER;
    const depthM = parseFloat(depthInput.value) || CONFIG.floorSize.depth * UNIT_TO_METER;

    // Resize the actual 3D floor/walls/grid to match (converted from real meters to scene units)
    CONFIG.floorSize.width = widthM / UNIT_TO_METER;
    CONFIG.floorSize.depth = depthM / UNIT_TO_METER;
    CONFIG.gridDivisions = Math.max(10, Math.round(CONFIG.floorSize.width));
    createFactoryBase();

    // Occupied area = sum of every element's real-world footprint (w × d in meters)
    const allElements = [...factoryElements.fixed, ...factoryElements.movable];
    let occupiedM2 = 0;
    allElements.forEach(elem => {
        occupiedM2 += (elem.w * UNIT_TO_METER) * (elem.d * UNIT_TO_METER);
    });

    const totalM2 = widthM * depthM;
    const freeM2 = Math.max(0, totalM2 - occupiedM2);
    const usagePct = totalM2 > 0 ? Math.min(100, Math.round((occupiedM2 / totalM2) * 100)) : 0;

    document.getElementById('area-total').textContent = Math.round(totalM2).toLocaleString('tr-TR') + ' m²';
    document.getElementById('area-occupied').textContent = Math.round(occupiedM2).toLocaleString('tr-TR') + ' m²';
    document.getElementById('area-free').textContent = Math.round(freeM2).toLocaleString('tr-TR') + ' m²';
    document.getElementById('area-usage-pct').textContent = usagePct + '%';

    const bar = document.getElementById('area-usage-bar');
    if (bar) {
        bar.style.width = usagePct + '%';
        bar.className = 'progress-bar ' + (usagePct > 60 ? 'danger' : usagePct > 35 ? 'warning' : 'success');
    }
}
window.updateFactoryArea = updateFactoryArea;

// --- YAPISAL ELEMANLAR (removable walls) ---
function toggleWall(wallName) {
    wallVisibility[wallName] = !wallVisibility[wallName];
    const wall = scene.getObjectByName(wallName);
    if (wall) wall.visible = wallVisibility[wallName];
    const windowsGroup = scene.getObjectByName('windowsGroup');
    if (windowsGroup) {
        windowsGroup.children.forEach(pane => {
            if (pane.name === wallName + '_window') pane.visible = wallVisibility[wallName];
        });
    }
}
window.toggleWall = toggleWall;

function updateWallHeight() {
    const slider = document.getElementById('wall-height-m');
    const label = document.getElementById('wall-height-val');
    if (!slider) return;

    const meters = parseFloat(slider.value) || 15;
    CONFIG.wallHeight = meters / UNIT_TO_METER;
    if (label) label.textContent = meters + ' m';

    createFactoryBase(); // rebuild walls at the new height (wall visibility state is preserved)
}
window.updateWallHeight = updateWallHeight;

// --- ELEMAN DETAYLARI ---
const ELEMENT_TYPE_LABELS = {
    fixed: 'Ana Hat', office: 'Ofis', stock: 'Stok Alanı', utility: 'Teknik Ünite',
    gate: 'Kapı', cnc: 'CNC / Makine', forklift_zone: 'Forklift Alanı'
};

// Records the element's original (1.0×) dimensions the first time it's touched, so repeated
// scaling stays relative to the true original size instead of compounding on the last value.
function ensureBaseDims(elem) {
    if (elem._baseW === undefined) {
        elem._baseW = elem.w;
        elem._baseD = elem.d;
        elem._baseH = elem.h;
    }
}

function isFixedElement(id) {
    return factoryElements.fixed.some(e => e.id === id);
}

// Rebuilds an element's 3D mesh in place (same scene position) — used after scaling so every
// internal detail (rollers, gantry, stack sheets, label icon...) is redrawn at the new size.
function rebuildElementMesh(id) {
    const elem = getElemData(id);
    const oldMesh = sceneObjects[id];
    if (!elem || !oldMesh) return;
    const pos = oldMesh.position.clone();
    scene.remove(oldMesh);
    const mesh = createMachineMesh(elem);
    mesh.position.copy(pos);
    scene.add(mesh);
    sceneObjects[id] = mesh;
    const border = mesh.getObjectByName('activeBorder');
    if (border) border.material.opacity = currentLayout === 'custom' ? 0.6 : 0.0;
}

function scaleSelectedElement(scaleStr) {
    if (!selectedDetailElement) return;
    const elem = getElemData(selectedDetailElement.id);
    if (!elem) return;
    ensureBaseDims(elem);
    const scale = Math.max(0.4, Math.min(3, parseFloat(scaleStr) || 1));
    elem.scale = scale;
    elem.w = +(elem._baseW * scale).toFixed(3);
    elem.d = +(elem._baseD * scale).toFixed(3);
    elem.h = +(elem._baseH * scale).toFixed(3);

    rebuildElementMesh(elem.id);
    updateCustomConnections();
    updateFactoryArea();
    calculateMetrics();
    recreateFlowPaths();
    showElementDetails({ ...elem });
}
window.scaleSelectedElement = scaleSelectedElement;

function showElementDetails(elemData) {
    selectedDetailElement = elemData;
    const box = document.getElementById('element-details');
    if (!box) return;

    const wM = elemData.w * UNIT_TO_METER;
    const dM = elemData.d * UNIT_TO_METER;
    const hM = elemData.h * UNIT_TO_METER;
    const typeLabel = ELEMENT_TYPE_LABELS[elemData.type] || elemData.type;
    const scale = elemData.scale || 1;

    let html = `
        <div class="detail-name">${TYPE_ICONS[elemData.type] || ''} ${elemData.label || elemData.name}</div>
        <div class="detail-row"><span>Tür</span><strong>${typeLabel}</strong></div>
        <div class="detail-row"><span>Boyut (G×D×Y)</span><strong>${wM.toFixed(1)} × ${dM.toFixed(1)} × ${hM.toFixed(1)} m</strong></div>
        <div class="detail-row"><span>Taban Alanı</span><strong>${(wM * dM).toFixed(1)} m²</strong></div>
    `;

    if (!isFixedElement(elemData.id)) {
        html += `
        <div class="detail-scale-row">
            <span>Ölçek <strong id="elem-scale-val">${scale.toFixed(1)}×</strong></span>
            <input type="range" min="0.4" max="3" step="0.1" value="${scale}"
                oninput="document.getElementById('elem-scale-val').textContent = parseFloat(this.value).toFixed(1)+'×'; window.scaleSelectedElement(this.value)">
        </div>`;
    }
    if (elemData.custom) {
        html += `<button class="btn-delete-elem" onclick="window.removeCustomElement('${elemData.id}')"><i class="fa-solid fa-trash"></i> Bu Elemanı Sil</button>`;
    }
    box.innerHTML = html;
}

function handleElementDetailClick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const clientX = event.clientX || event.pageX;
    const clientY = event.clientY || event.pageY;
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const allObjects = [...factoryElements.fixed, ...factoryElements.movable].map(e => sceneObjects[e.id]).filter(Boolean);
    const intersects = raycaster.intersectObjects(allObjects, true);
    if (intersects.length === 0) return;

    let obj = intersects[0].object;
    while (obj && obj.parent !== scene) obj = obj.parent;
    if (!obj) return;

    showElementDetails(obj.userData);
}

// --- RULER / MEASUREMENT TOOL ---

function toggleRuler() {
    rulerActive = !rulerActive;
    rulerPendingPoint = null;

    const btn = document.getElementById('toggle-ruler');
    const clearBtn = document.getElementById('clear-ruler');
    if (btn) btn.classList.toggle('active', rulerActive);
    if (clearBtn) clearBtn.style.display = measurements.length > 0 ? 'flex' : 'none';

    // Orbit camera would fight with precise point-picking, so pause it while measuring
    controls.enabled = !rulerActive;

    renderer.domElement.style.cursor = rulerActive ? 'crosshair' : 'default';
}

function handleRulerClick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const clientX = event.clientX || event.pageX;
    const clientY = event.clientY || event.pageY;

    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return;

    if (!rulerPendingPoint) {
        // First point of a new measurement
        rulerPendingPoint = hit.clone();
        addRulerMarker(rulerPendingPoint, 0xC084FC);
    } else {
        // Second point - complete the measurement
        finishMeasurement(rulerPendingPoint, hit.clone());
        rulerPendingPoint = null;
    }
}

function addRulerMarker(point, colorHex) {
    const geo = new THREE.SphereGeometry(0.35, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });
    const marker = new THREE.Mesh(geo, mat);
    marker.position.copy(point);
    marker.position.y = 0.1;
    marker.name = 'rulerMarker';
    scene.add(marker);
    return marker;
}

function finishMeasurement(p1, p2) {
    const marker1 = addRulerMarker(p1, 0xC084FC);
    const marker2 = addRulerMarker(p2, 0xC084FC);

    // Line between the two points
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(p1.x, 0.1, p1.z),
        new THREE.Vector3(p2.x, 0.1, p2.z)
    ]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xC084FC, linewidth: 2 });
    const line = new THREE.Line(lineGeo, lineMat);
    scene.add(line);

    const distUnits = p1.distanceTo(p2);
    const distMeters = Math.round(distUnits * UNIT_TO_METER * 10) / 10;

    // Floating HTML label at the midpoint
    const labelEl = document.createElement('div');
    labelEl.className = 'ruler-label';
    labelEl.textContent = distMeters + ' m';
    document.getElementById('ruler-labels').appendChild(labelEl);

    const midpoint = new THREE.Vector3((p1.x + p2.x) / 2, 0.1, (p1.z + p2.z) / 2);

    measurements.push({ p1, p2, midpoint, line, markers: [marker1, marker2], labelEl });

    const clearBtn = document.getElementById('clear-ruler');
    if (clearBtn) clearBtn.style.display = 'flex';

    updateRulerLabelPositions();
}

// Project each measurement's 3D midpoint into 2D screen space so its label div tracks the camera
function updateRulerLabelPositions() {
    if (measurements.length === 0) return;
    const container = document.getElementById('canvas-container');
    const w = container.clientWidth;
    const h = container.clientHeight;

    measurements.forEach(m => {
        const projected = m.midpoint.clone().project(camera);
        const x = (projected.x * 0.5 + 0.5) * w;
        const y = (-projected.y * 0.5 + 0.5) * h;
        const behindCamera = projected.z > 1;
        m.labelEl.style.display = behindCamera ? 'none' : 'block';
        m.labelEl.style.left = x + 'px';
        m.labelEl.style.top = y + 'px';
    });
}

function clearMeasurements() {
    measurements.forEach(m => {
        scene.remove(m.line);
        m.markers.forEach(marker => scene.remove(marker));
        m.labelEl.remove();
    });
    measurements = [];
    rulerPendingPoint = null;

    const clearBtn = document.getElementById('clear-ruler');
    if (clearBtn) clearBtn.style.display = 'none';
}

function onPointerUp(event) {
    if (selectedObject) {
        // Return border to standard green active color
        const border = selectedObject.getObjectByName('activeBorder');
        if (border) border.material.color.setHex(CONFIG.colors.activeBorder);

        selectedObject = null;
        controls.enabled = true; // Enable orbit controls back
        dragStartMetrics = null; // ready for the next move's baseline
    }

    // If the pointer barely moved between down and up, treat it as a click and show element details
    // (skip this while the ruler or connection-mode tools are active - they handle their own clicks)
    if (!rulerActive && !connectionModeActive && pointerDownPos) {
        const clientX = event.clientX || event.pageX || pointerDownPos.x;
        const clientY = event.clientY || event.pageY || pointerDownPos.y;
        const dx = clientX - pointerDownPos.x;
        const dy = clientY - pointerDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) < 5) {
            handleElementDetailClick(event);
        }
    }
    pointerDownPos = null;
}

// Render dynamic animated tubes representing flow directions
function recreateFlowPaths() {
    // Clear old lines
    while (flowLineGroup.children.length > 0) {
        const obj = flowLineGroup.children[0];
        flowLineGroup.remove(obj);
    }
    particlesArray = [];

    // Define standard process routing (source -> target) with volume weights and expected flow direction
    const flowRoutes = [
        // Raw Inflow -> stocks (Upper Zone - moving Left to Right: +x)
        { from: 'gate_left_top', to: 'levha_stok', vol: 0.5, color: 0xa855f7, expectedDir: '+x' },
        { from: 'gate_left_top', to: 'seren_stok', vol: 0.8, color: 0xa855f7, expectedDir: '+x' },
        
        // Stock prep -> assembly (Upper Zone - moving Left to Right: +x)
        { from: 'levha_stok', to: 'seren_kesim_montaj', vol: 0.5, color: 0xa855f7, expectedDir: '+x' },
        { from: 'seren_stok', to: 'seren_kesim_montaj', vol: 0.8, color: 0xa855f7, expectedDir: '+x' },
        { from: 'seren_kesim_montaj', to: 'montajli_seren', vol: 0.9, color: 0xa855f7, expectedDir: '+x' },
        { from: 'montajli_seren', to: 'seren_dolum', vol: 0.9, color: 0xa855f7, expectedDir: '+x' },
        { from: 'dolum_stok', to: 'seren_dolum', vol: 0.6, color: 0xa855f7, expectedDir: '+x' },
        
        // Prep -> ETA press (Besleme - moving Left to Right: +x)
        { from: 'seren_dolum', to: 'eta', vol: 1.0, color: 0x38bdf8, expectedDir: '+x' },
        { from: 'kopuk_stok', to: 'eta', vol: 0.4, color: 0x38bdf8, expectedDir: '+x' },

        // Main line processing (Right -> Left flow: -x)
        { from: 'eta', to: 'homag', vol: 1.0, color: 0x38bdf8, expectedDir: '-x' },
        { from: 'homag', to: 'torwegge', vol: 1.0, color: 0x38bdf8, expectedDir: '-x' },
        
        // Torwegge output -> Vacuum Prep
        { from: 'torwegge', to: 'vakum_hazirlik', vol: 1.0, color: 0xf97316, expectedDir: 'none' },

        // Vacuum Prep -> Symmetrical Presses & Vacuum Press
        { from: 'vakum_hazirlik', to: 'vakum_makinesi', vol: 1.0, color: 0xf97316, expectedDir: 'none' },
        { from: 'vakum_makinesi', to: 'vakum_bitis', vol: 1.0, color: 0xf97316, expectedDir: 'none' },
        
        // Vacuum Cell Output -> Intermediate Processes (Moving Right to Left: -x)
        { from: 'vakum_bitis', to: 'yatar_large', vol: 0.8, color: 0xf97316, expectedDir: '-x' },
        { from: 'yatar_large', to: 'doper', vol: 0.8, color: 0xf97316, expectedDir: '-x' },
        
        // Intermediate -> CNC Sizing & Routing (Moving Right to Left: -x)
        { from: 'doper', to: 'cnc', vol: 0.8, color: 0xf97316, expectedDir: '-x' },
        { from: 'cnc', to: 'cnc_bitmis_stok', vol: 0.8, color: 0x10b981, expectedDir: 'none' },
        { from: 'cnc_bitmis_stok', to: 'gate_left_mid', vol: 1.0, color: 0x10b981, expectedDir: '-x' },
        
        // Small yatar near CNC
        { from: 'cnc', to: 'yatar_small', vol: 0.2, color: 0xf97316, expectedDir: 'none' },
        { from: 'yatar_small', to: 'gate_left_mid', vol: 0.2, color: 0x10b981, expectedDir: '-x' }
    ];

    // Add paths to/from the 15 presses dynamically
    for (let i = 1; i <= 15; i++) {
        flowRoutes.push({ from: 'vakum_hazirlik', to: `pres_${i}`, vol: 0.07, color: 0xf97316, expectedDir: 'none' });
        flowRoutes.push({ from: `pres_${i}`, to: 'vakum_makinesi', vol: 0.07, color: 0xf97316, expectedDir: 'none' });
    }

    lastFlowRoutes = flowRoutes;

    flowRoutes.forEach(route => {
        const fromObj = sceneObjects[route.from];
        const toObj = sceneObjects[route.to];

        if (!fromObj || !toObj) return;

        const p1 = fromObj.position.clone();
        const p2 = toObj.position.clone();
        
        p1.y = 0.3;
        p2.y = 0.3;

        // Draw curved flow paths (bezier curves)
        const midPoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        const dist = p1.distanceTo(p2);
        midPoint.y += Math.min(dist * 0.15, 4);

        const curve = new THREE.QuadraticBezierCurve3(p1, midPoint, p2);
        
        // Create glowing tube mesh for the path
        const tubeGeo = new THREE.TubeGeometry(curve, 20, 0.06 * route.vol, 6, false);
        const tubeMat = new THREE.MeshBasicMaterial({
            color: route.color,
            transparent: true,
            opacity: 0.20,
            blending: THREE.AdditiveBlending
        });
        const tube = new THREE.Mesh(tubeGeo, tubeMat);
        flowLineGroup.add(tube);

        // Particle generator along curve for animation
        const particleCount = Math.max(1, Math.floor(route.vol * 5));
        
        for (let k = 0; k < particleCount; k++) {
            const particleGeo = new THREE.SphereGeometry(0.10 * route.vol, 8, 8);
            const particleMat = new THREE.MeshBasicMaterial({
                color: route.color,
                transparent: true,
                opacity: 0.95
            });
            const particle = new THREE.Mesh(particleGeo, particleMat);
            
            const progress = (k / particleCount) + Math.random() * 0.1;
            
            flowLineGroup.add(particle);
            particlesArray.push({
                mesh: particle,
                curve: curve,
                progress: progress % 1.0,
                speed: 0.003 + (Math.random() * 0.002)
            });
        }
    });

    // Keep the custom connections, spaghetti overlay, and safety zones aligned with current positions
    updateCustomConnections();
    renderSpaghettiDiagram();
    renderSafetyZones();
}

// Calculate Facility Layout Metrics dynamically
function calculateMetrics() {
    let totalWeightedDistance = 0;
    let totalFlowWeight = 0;
    let backtrackingDistance = 0;

    const flowRoutes = [
        { from: 'gate_left_top', to: 'levha_stok', vol: 0.5, expectedDir: '+x' },
        { from: 'gate_left_top', to: 'seren_stok', vol: 0.8, expectedDir: '+x' },
        { from: 'levha_stok', to: 'seren_kesim_montaj', vol: 0.5, expectedDir: '+x' },
        { from: 'seren_stok', to: 'seren_kesim_montaj', vol: 0.8, expectedDir: '+x' },
        { from: 'seren_kesim_montaj', to: 'montajli_seren', vol: 0.9, expectedDir: '+x' },
        { from: 'montajli_seren', to: 'seren_dolum', vol: 0.9, expectedDir: '+x' },
        { from: 'dolum_stok', to: 'seren_dolum', vol: 0.6, expectedDir: '+x' },
        { from: 'seren_dolum', to: 'eta', vol: 1.0, expectedDir: '+x' },
        { from: 'kopuk_stok', to: 'eta', vol: 0.4, expectedDir: '+x' },
        { from: 'eta', to: 'homag', vol: 1.0, expectedDir: '-x' },
        { from: 'homag', to: 'torwegge', vol: 1.0, expectedDir: '-x' },
        { from: 'torwegge', to: 'vakum_hazirlik', vol: 1.0, expectedDir: 'none' },
        { from: 'vakum_hazirlik', to: 'vakum_makinesi', vol: 1.0, expectedDir: 'none' },
        { from: 'vakum_makinesi', to: 'vakum_bitis', vol: 1.0, expectedDir: 'none' },
        { from: 'vakum_bitis', to: 'yatar_large', vol: 0.8, expectedDir: '-x' },
        { from: 'yatar_large', to: 'doper', vol: 0.8, expectedDir: '-x' },
        { from: 'doper', to: 'cnc', vol: 0.8, expectedDir: '-x' },
        { from: 'cnc', to: 'cnc_bitmis_stok', vol: 0.8, expectedDir: 'none' },
        { from: 'cnc_bitmis_stok', to: 'gate_left_mid', vol: 1.0, expectedDir: '-x' },
        { from: 'cnc', to: 'yatar_small', vol: 0.2, expectedDir: 'none' },
        { from: 'yatar_small', to: 'gate_left_mid', vol: 0.2, expectedDir: '-x' }
    ];

    // Add presses routing to metric calculation dynamically
    for (let i = 1; i <= 15; i++) {
        flowRoutes.push({ from: 'vakum_hazirlik', to: `pres_${i}`, vol: 0.07, expectedDir: 'none' });
        flowRoutes.push({ from: `pres_${i}`, to: 'vakum_makinesi', vol: 0.07, expectedDir: 'none' });
    }

    flowRoutes.forEach(route => {
        const fromObj = sceneObjects[route.from];
        const toObj = sceneObjects[route.to];

        if (!fromObj || !toObj) return;

        // Euclidean Distance
        const dist = fromObj.position.distanceTo(toObj.position);
        const weighted = dist * route.vol;

        totalWeightedDistance += weighted;
        totalFlowWeight += route.vol;

        // BACKTRACKING CHECK
        if (route.expectedDir === '+x') {
            // Expected left-to-right flow. If target x is less than source x, it is backtracking.
            if (toObj.position.x < fromObj.position.x) {
                backtrackingDistance += (fromObj.position.x - toObj.position.x) * route.vol;
            }
        } else if (route.expectedDir === '-x') {
            // Expected right-to-left flow. If target x is greater than source x, it is backtracking.
            if (toObj.position.x > fromObj.position.x) {
                backtrackingDistance += (toObj.position.x - fromObj.position.x) * route.vol;
            }
        }
    });

    const finalDistanceMeters = Math.round(totalWeightedDistance * UNIT_TO_METER);
    lastDistanceMeters = finalDistanceMeters;
    if (baselineDistanceMeters === null && currentLayout === 'current') {
        baselineDistanceMeters = finalDistanceMeters;
    }
    updateCostAnalysis(finalDistanceMeters);
    
    // Backtracking Rate
    const btRate = Math.min(100, Math.round((backtrackingDistance / totalWeightedDistance) * 160));

    // Toz Emme Efficiency (distance from Toz Emme to CNC, Yatarlar, Doper)
    // In U-Shape, Toz Emme is fixed at X=28, Z=4. Saws and CNC move to the left.
    // So the duct distance increases, which is a physical constraint trade-off.
    const tozEmme = sceneObjects['toz_emme'];
    let avgDustDistance = 0;
    if (tozEmme) {
        const dustMakers = ['cnc', 'yatar_small', 'yatar_large', 'doper'];
        let activeMakers = 0;
        dustMakers.forEach(m => {
            const obj = sceneObjects[m];
            if (obj) {
                avgDustDistance += tozEmme.position.distanceTo(obj.position);
                activeMakers++;
            }
        });
        avgDustDistance = (avgDustDistance / activeMakers) * UNIT_TO_METER;
    }
    const dustEfficiency = Math.max(10, Math.min(95, Math.round(100 - (avgDustDistance * 1.3))));

    // Overall Score Calculation (minimizing total distance and backtracking)
    // Best optimized distance target is ~210 meters due to expanded U-shape cell
    const distScore = Math.max(0, Math.min(100, 100 - ((finalDistanceMeters - 180) / 2.5)));
    const btScore = 100 - btRate;
    const overallScore = Math.round((distScore * 0.5) + (btScore * 0.3) + (dustEfficiency * 0.2));

    // Map Overall Score to Letter Grades
    let grade = 'F';
    let ratingClass = 'rating-d';
    let btText = 'Düşük (%' + btRate + ')';
    let btClass = 'success';

    if (overallScore >= 80) { grade = 'A'; ratingClass = 'rating-a'; }
    else if (overallScore >= 68) { grade = 'B'; ratingClass = 'rating-b'; }
    else if (overallScore >= 52) { grade = 'C'; ratingClass = 'rating-c'; }
    else { grade = 'D'; ratingClass = 'rating-d'; }

    if (btRate > 30) {
        btText = 'Yüksek (%' + btRate + ')';
        btClass = 'danger';
    } else if (btRate > 12) {
        btText = 'Orta (%' + btRate + ')';
        btClass = 'warning';
    }

    // Update DOM Dashboard Elements
    document.getElementById('val-distance').innerText = finalDistanceMeters + ' m';
    document.getElementById('val-backtracking').innerText = btText;
    document.getElementById('val-dust').innerText = dustEfficiency + '%';
    document.getElementById('val-score').innerText = grade + ' (%' + overallScore + ')';

    // Update Progress Bar UI
    const barDist = document.getElementById('bar-distance');
    barDist.style.width = Math.min(100, Math.round((finalDistanceMeters / 400) * 100)) + '%';
    barDist.className = 'progress-bar ' + (finalDistanceMeters > 320 ? 'danger' : finalDistanceMeters > 240 ? 'warning' : finalDistanceMeters > 190 ? 'info' : 'success');

    const barBt = document.getElementById('bar-backtracking');
    barBt.style.width = btRate + '%';
    barBt.className = 'progress-bar ' + btClass;

    const barDust = document.getElementById('bar-dust');
    barDust.style.width = dustEfficiency + '%';
    barDust.className = 'progress-bar ' + (dustEfficiency > 75 ? 'success' : dustEfficiency > 50 ? 'info' : 'warning');

    const barScore = document.getElementById('bar-score');
    barScore.style.width = overallScore + '%';
    barScore.className = 'progress-bar ' + ratingClass;

    // Return raw values so callers (e.g. drag handlers) can compare before/after a move
    return { overallScore, finalDistanceMeters, btRate, dustEfficiency };
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    // Update orbit controls
    controls.update();

    // Animate flow line particles
    if (showFlowLines && particlesArray.length > 0) {
        particlesArray.forEach(p => {
            p.progress += p.speed * flowSpeedMultiplier;
            if (p.progress > 1.0) p.progress = 0.0;
            
            // Get position along bezier spline
            const pos = p.curve.getPointAt(p.progress);
            p.mesh.position.copy(pos);
        });
    }

    // Move forklift vehicles back and forth along their custom routes, facing the direction of travel
    customConnections.forEach(c => {
        if (c.kind === 'forklift' && c.vehicleMesh) {
            c.progress += c.speed * flowSpeedMultiplier;
            if (c.progress > 1.0) c.progress = 0.0;
            const t = Math.min(c.progress, 0.999);
            const pos = c.curve.getPointAt(t);
            const tangent = c.curve.getTangentAt(t);
            c.vehicleMesh.position.set(pos.x, 0, pos.z);
            c.vehicleMesh.lookAt(pos.x + tangent.x, 0, pos.z + tangent.z);
        }
    });

    // Always make machine text labels face the active camera
    factoryElements.fixed.forEach(elem => {
        const obj = sceneObjects[elem.id];
        if (obj) {
            const sprite = obj.getObjectByName('label');
            if (sprite) sprite.quaternion.copy(camera.quaternion);
        }
    });
    factoryElements.movable.forEach(elem => {
        const obj = sceneObjects[elem.id];
        if (obj) {
            const sprite = obj.getObjectByName('label');
            if (sprite) sprite.quaternion.copy(camera.quaternion);
        }
    });

    // Keep floating ruler/measurement labels aligned with their 3D points
    updateRulerLabelPositions();

    // Render viewport scene
    renderer.render(scene, camera);
}

// Handle window resizing
window.addEventListener('resize', onWindowResize, false);

function onWindowResize() {
    if (!camera || !renderer) return; // init() henüz çalışmadıysa hiçbir şey yapma
    const container = document.getElementById('canvas-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// Run app
window.onload = init;

// --- PDF REPORT EXPORT ---
async function exportPdfReport() {
    const btn = document.getElementById('btn-export-pdf');
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Rapor Hazırlanıyor...';
    }

    try {
        // Render one fresh frame immediately before capture (buffer isn't preserved between frames)
        renderer.render(scene, camera);
        const canvasDataUrl = renderer.domElement.toDataURL('image/png');

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 15;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text('Tesis Planlama Optimizasyonu Raporu', margin, 20);

        const layoutNames = { current: 'Alternatif 1 (Mevcut)', optimized: 'Layout B (U-Tipi Önerilen)', custom: 'Serbest Tasarım' };
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text('Düzen: ' + (layoutNames[currentLayout] || currentLayout) + '   •   Tarih: ' + new Date().toLocaleDateString('tr-TR'), margin, 27);

        const imgWidth = pageWidth - margin * 2;
        const imgHeight = imgWidth * (renderer.domElement.height / renderer.domElement.width);
        doc.addImage(canvasDataUrl, 'PNG', margin, 34, imgWidth, imgHeight);

        let y = 34 + imgHeight + 12;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(20);
        doc.text('Verimlilik Analizi', margin, y);
        y += 7;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        [
            ['Toplam Malzeme Akış Mesafesi', document.getElementById('val-distance').innerText],
            ['Geri Akış (Backtracking) Oranı', document.getElementById('val-backtracking').innerText],
            ['Toz Emme Yükü & Verim', document.getElementById('val-dust').innerText],
            ['Genel Düzen Skoru', document.getElementById('val-score').innerText]
        ].forEach(([label, value]) => {
            doc.text(label + ':', margin, y);
            doc.text(String(value), pageWidth - margin, y, { align: 'right' });
            y += 6.5;
        });

        y += 6;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text('Maliyet Analizi (Varsayımlara Dayalı Tahmin)', margin, y);
        y += 7;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        [
            ['Varsayım: Taşıma maliyeti', document.getElementById('cost-per-meter').value + ' ₺ / metre / sefer'],
            ['Varsayım: Günlük sefer sayısı', document.getElementById('trips-per-day').value],
            ['Varsayım: Yıllık çalışma günü', document.getElementById('days-per-year').value],
            ['Günlük Lojistik Maliyeti', document.getElementById('cost-daily').innerText],
            ['Yıllık Tahmini Maliyet', document.getElementById('cost-yearly').innerText]
        ].forEach(([label, value]) => {
            doc.text(label + ':', margin, y);
            doc.text(String(value), pageWidth - margin, y, { align: 'right' });
            y += 6.5;
        });

        const savingsRow = document.getElementById('cost-savings-row');
        if (savingsRow && savingsRow.style.display !== 'none') {
            doc.text("Alternatif 1'e göre yıllık fark:", margin, y);
            doc.text(document.getElementById('cost-savings').innerText, pageWidth - margin, y, { align: 'right' });
            y += 6.5;
        }

        doc.setFontSize(8);
        doc.setTextColor(140);
        doc.text('Bu rapor girilen varsayımlara dayanan bir tahmindir; gerçek maliyet ve verimlilik rakamları saha ölçümleriyle doğrulanmalıdır.', margin, 287);

        doc.save('tesis-planlama-raporu-' + Date.now() + '.pdf');
    } catch (err) {
        console.error('PDF export failed:', err);
        alert('PDF oluşturulurken bir hata oluştu: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}
window.exportPdfReport = exportPdfReport;

// --- KAYDET & DIŞA AKTAR: free-form design persistence (JSON) + PNG snapshot ---

function downloadBlob(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Serializes the entire editable state (every movable/custom element's position, size, scale and
// color, every custom connection, the wall/window/dimension settings) so a free-form layout can be
// restored exactly later, or shared with someone else.
function saveDesignJSON() {
    const data = {
        version: 1,
        savedAt: new Date().toISOString(),
        currentLayout,
        factory: {
            widthM: parseFloat(document.getElementById('factory-width-m')?.value) || (CONFIG.floorSize.width * UNIT_TO_METER),
            depthM: parseFloat(document.getElementById('factory-depth-m')?.value) || (CONFIG.floorSize.depth * UNIT_TO_METER),
            wallHeight: CONFIG.wallHeight
        },
        wallVisibility,
        showWindows,
        elements: factoryElements.movable.map(elem => {
            const obj = sceneObjects[elem.id];
            return {
                id: elem.id, name: elem.name, type: elem.type, custom: !!elem.custom,
                color: elem.color || null, label: elem.label,
                w: elem.w, d: elem.d, h: elem.h, scale: elem.scale || 1,
                baseW: elem._baseW || elem.w, baseD: elem._baseD || elem.d, baseH: elem._baseH || elem.h,
                x: obj ? obj.position.x : elem.current.x,
                z: obj ? obj.position.z : elem.current.z
            };
        }),
        connections: customConnections.map(c => ({ fromId: c.fromId, toId: c.toId, kind: c.kind }))
    };
    downloadBlob('tesis-tasarim-' + Date.now() + '.json', JSON.stringify(data, null, 2), 'application/json');
}
window.saveDesignJSON = saveDesignJSON;

function loadDesignJSON(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            applyLoadedDesign(data);
        } catch (err) {
            console.error('Tasarım yüklenemedi:', err);
            alert('Bu JSON dosyası okunamadı: ' + err.message);
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}
window.loadDesignJSON = loadDesignJSON;

function applyLoadedDesign(data) {
    if (!data || !Array.isArray(data.elements)) {
        alert('Geçersiz tasarım dosyası.');
        return;
    }

    // Remove every current custom element and connection — we'll rebuild the full state from the file.
    factoryElements.movable.filter(e => e.custom).forEach(e => {
        const mesh = sceneObjects[e.id];
        if (mesh) { scene.remove(mesh); delete sceneObjects[e.id]; }
    });
    factoryElements.movable = factoryElements.movable.filter(e => !e.custom);
    resetCustomConnections();

    // Restore factory dimensions, walls & windows
    if (data.factory) {
        if (document.getElementById('factory-width-m')) document.getElementById('factory-width-m').value = data.factory.widthM;
        if (document.getElementById('factory-depth-m')) document.getElementById('factory-depth-m').value = data.factory.depthM;
        if (typeof data.factory.wallHeight === 'number') {
            CONFIG.wallHeight = data.factory.wallHeight;
            if (document.getElementById('wall-height-m')) document.getElementById('wall-height-m').value = data.factory.wallHeight;
            if (document.getElementById('wall-height-val')) document.getElementById('wall-height-val').textContent = data.factory.wallHeight + ' m';
        }
        updateFactoryArea();
    }
    if (data.wallVisibility) {
        wallVisibility = { ...wallVisibility, ...data.wallVisibility };
        ['factoryWallBack', 'factoryWallLeft', 'factoryWallRight'].forEach(name => {
            const inputId = { factoryWallBack: 'wall-back', factoryWallLeft: 'wall-left', factoryWallRight: 'wall-right' }[name];
            if (document.getElementById(inputId)) document.getElementById(inputId).checked = wallVisibility[name];
        });
    }
    if (typeof data.showWindows === 'boolean') {
        showWindows = data.showWindows;
        if (document.getElementById('wall-windows')) document.getElementById('wall-windows').checked = showWindows;
    }
    createFactoryBase();

    // Restore every element's position/size/scale/color
    data.elements.forEach(saved => {
        let elem = getElemData(saved.id);
        if (!elem && saved.custom) {
            // Recreate a custom element that doesn't exist yet
            elem = {
                id: saved.id, name: saved.name, type: saved.type, custom: true,
                color: saved.color, label: saved.label || saved.name,
                w: saved.baseW, d: saved.baseD, h: saved.baseH,
                current: { x: saved.x, z: saved.z }, optimized: { x: saved.x, z: saved.z }
            };
            factoryElements.movable.push(elem);
            const m = saved.id.match(/custom_(\d+)/);
            if (m) customElementCounter = Math.max(customElementCounter, parseInt(m[1], 10));
        }
        if (!elem) return; // built-in id no longer exists in this version, skip

        ensureBaseDims(elem);
        elem._baseW = saved.baseW || elem._baseW;
        elem._baseD = saved.baseD || elem._baseD;
        elem._baseH = saved.baseH || elem._baseH;
        elem.scale = saved.scale || 1;
        elem.w = saved.w; elem.d = saved.d; elem.h = saved.h;
        if (saved.color) elem.color = saved.color;

        let mesh = sceneObjects[elem.id];
        if (mesh) { scene.remove(mesh); }
        mesh = createMachineMesh(elem);
        mesh.position.set(saved.x, 0, saved.z);
        scene.add(mesh);
        sceneObjects[elem.id] = mesh;
    });

    // Restore custom connections (positions are already in place, so tubes/forklift routes are correct)
    (data.connections || []).forEach(c => createCustomConnection(c.fromId, c.toId, c.kind));

    setLayout('custom');
    updateFactoryArea();
    calculateMetrics();
    recreateFlowPaths();
    renderCustomElementsList();
    alert('Tasarım başarıyla yüklendi.');
}

// Exports the current 3D viewport as a downloadable PNG image.
function exportImage() {
    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'tesis-tasarim-' + Date.now() + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
window.exportImage = exportImage;
