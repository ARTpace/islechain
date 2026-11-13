// Bundled locally with pinned three@0.180.0 and esbuild@0.25.11; no CDN at runtime.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
window.THREE = THREE;
window.GameGLTFLoader = GLTFLoader;
window.GameOrbitControls = OrbitControls;
window.GameRoomEnvironment = RoomEnvironment;

import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
window.GameHDRLoader = HDRLoader;
