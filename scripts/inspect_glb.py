import struct
import json

with open('building.glb', 'rb') as f:
    f.seek(12)
    chunk_len, _ = struct.unpack('<I4s', f.read(8))
    g = json.loads(f.read(chunk_len).decode('utf-8'))

materials = g.get('materials', [])
for i, m in enumerate(g.get('meshes', [])):
    mat_names = []
    for p in m.get('primitives', []):
        mat_idx = p.get('material')
        if mat_idx is not None and mat_idx < len(materials):
            mat_names.append(materials[mat_idx].get('name', ''))
    print(f"{i:02d}: mesh={m.get('name')} mats={mat_names}")


