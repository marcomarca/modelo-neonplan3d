import fs from "fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

const files = ["showroom.glb", "building.glb", "lobby.glb"];

for (const fn of files) {
  if (fs.existsSync(fn)) {
    const buf = fs.readFileSync(fn);
    const arr = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    console.log(`Loaded ${fn}: ${arr.byteLength} bytes`);
  }
}
