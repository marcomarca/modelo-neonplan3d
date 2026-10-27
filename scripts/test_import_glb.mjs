import fs from "fs";

// We can read showroom.glb and test extracting triangles with the logic from neonplan-import.js
const buf = fs.readFileSync("showroom.glb");
const arr = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

function mn(e) {
  let t, n = null, o = new DataView(e.buffer, e.byteOffset, e.byteLength);
  if (e.length > 12 && o.getUint32(0, !0) === 1179937895) {
    let p = 12;
    for (t = {}; p + 8 <= e.length;) {
      let c = o.getUint32(p, !0), d = o.getUint32(p + 4, !0), u = e.subarray(p + 8, p + 8 + c);
      d === 1313821514 ? t = JSON.parse(new TextDecoder().decode(u)) : d === 5130562 && (n = u);
      p += 8 + c;
    }
  } else {
    t = JSON.parse(new TextDecoder().decode(e));
  }
  let r = (t.buffers ?? []).map((p, c) => {
    if (c === 0 && n) return n;
    let d = p.uri?.match(/^data:[^;]*;base64,(.*)$/);
    if (!d) throw new Error("gltf_external");
    let u = atob(d[1]), m = new Uint8Array(u.length);
    for (let h = 0; h < u.length; h++) m[h] = u.charCodeAt(h);
    return m;
  });
  let l = p => {
    let c = t.accessors[p], d = t.bufferViews[c.bufferView ?? 0], u = r[d.buffer],
      m = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[c.type] ?? 1,
      h = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[c.componentType] ?? 4,
      b = d.byteStride || m * h, g = u.byteOffset + (d.byteOffset ?? 0) + (c.byteOffset ?? 0),
      f = new DataView(u.buffer), w = [];
    for (let _ = 0; _ < c.count; _++)
      for (let M = 0; M < m; M++) {
        let x = g + _ * b + M * h;
        w.push(c.componentType === 5126 ? f.getFloat32(x, !0) : c.componentType === 5125 ? f.getUint32(x, !0) : c.componentType === 5123 ? f.getUint16(x, !0) : c.componentType === 5121 ? f.getUint8(x) : c.componentType === 5122 ? f.getInt16(x, !0) : f.getInt8(x));
      }
    return w;
  };
  let i = [];
  function Hn(e, t) {
    let n = new Array(16).fill(0);
    for (let o = 0; o < 4; o++) for (let r = 0; r < 4; r++) for (let l = 0; l < 4; l++) n[o * 4 + r] += e[l * 4 + r] * t[o * 4 + l];
    return n;
  }
  function Xn(e) {
    let [t, n, o] = e.translation ?? [0, 0, 0], [r, l, i, s] = e.rotation ?? [0, 0, 0, 1], [a, p, c] = e.scale ?? [1, 1, 1];
    return [(1 - 2 * (l * l + i * i)) * a, 2 * (r * l + i * s) * a, 2 * (r * i - l * s) * a, 0, 2 * (r * l - i * s) * p, (1 - 2 * (r * r + i * i)) * p, 2 * (l * i + r * s) * p, 0, 2 * (r * i + l * s) * c, 2 * (l * i - r * s) * c, (1 - 2 * (r * r + l * l)) * c, 0, t, n, o, 1];
  }
  let s = (p, c) => {
    let d = t.nodes[p], u = Hn(c, d.matrix?.length === 16 ? d.matrix : Xn(d));
    if (d.mesh !== void 0) {
      for (let m of t.meshes[d.mesh].primitives) {
        if ((m.mode ?? 4) !== 4 || m.attributes.POSITION === void 0) continue;
        let h = l(m.attributes.POSITION), b = m.indices !== void 0 ? l(m.indices) : [...Array(h.length / 3).keys()];
        for (let g of b) {
          let f = h[g * 3], w = h[g * 3 + 1], _ = h[g * 3 + 2];
          i.push(u[0] * f + u[4] * w + u[8] * _ + u[12], u[1] * f + u[5] * w + u[9] * _ + u[13], u[2] * f + u[6] * w + u[10] * _ + u[14]);
        }
      }
    }
    for (let m of d.children ?? []) s(m, u);
  };
  let a = t.scenes?.[t.scene ?? 0]?.nodes ?? (t.nodes ?? []).map((p, c) => c);
  for (let p of a) s(p, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return i;
}

try {
  const tris = mn(arr);
  console.log("Successfully extracted vertex coordinates, total floats:", tris.length, "total triangles:", tris.length / 9);
} catch (err) {
  console.error("Error:", err);
}
