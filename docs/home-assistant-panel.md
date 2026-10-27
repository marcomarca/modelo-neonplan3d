# Witronix 3D – Panel Personalizado para Home Assistant

Esta rama (`ha-custom-panel`) contiene la versión **ultra-simplificada y optimizada** diseñada específicamente para ejecutarse dentro de **Home Assistant**.

---

## 🎯 Separación de Entornos

| Archivo | Propósito | Características |
|---|---|---|
| [`preview/showroom-viewer.html`](../preview/showroom-viewer.html) | **Estudio / Generador 3D** | Permite calibrar posiciones, mover sliders X/Y/Z, rotar, probar estilos visuales, exportar JSON, inspeccionar mallas y ajustar escalas. |
| [`preview/ha-panel.html`](../preview/ha-panel.html) | **Panel de Producción (Home Assistant)** | Fijo en estilo Neón, coordenadas fijas bloqueadas, cámara 3D/2D, control de aire acondicionado, marcadores de temperatura en 3D, control de luces y aislamiento de oficinas con desenfoque de fondo. |

---

## 🚀 Cómo Integrar en Home Assistant

### Opción 1: Panel de Barra Lateral (Vía `panel_iframe`)
Copia la carpeta con los archivos a la carpeta `www` de tu Home Assistant (ej: `/config/www/witronix3d/`):
- `ha-panel.html`
- `ha-panel-bundle.js`
- `building.glb`, `lobby.glb`, `showroom.glb`
- `draco/`

Luego añade en tu `configuration.yaml`:

```yaml
panel_iframe:
  edificio_3d:
    title: "Witronix 3D"
    icon: "mdi:office-building"
    url: "/local/witronix3d/ha-panel.html"
    require_admin: false
```

---

### Opción 2: Tarjeta Lovelace para Dashboard (Webpage Card)
En cualquier dashboard de Lovelace, añade una tarjeta de tipo **Página Web**:

```yaml
type: iframe
url: /local/witronix3d/ha-panel.html
aspect_ratio: 16x9
```

---

## ⚡ Entidades Conectadas en 3D

El panel escucha y envía llamadas de servicio (`call-service`) para:
1. **Clima / Aire Acondicionado:**
   - `climate.showroom_ac` y `climate.lobby_ac`
   - Servicios: `climate.set_temperature`, `climate.turn_on`, `climate.turn_off`.
   - Incluye unidad de aire acondicionado física modelada en 3D en la pared con indicador LED y flap de ventilación.
2. **Iluminación:**
   - `light.showroom_lights` y `light.lobby_lights`
   - Servicios: `light.turn_on`, `light.turn_off`.
   - Modifica en tiempo real la emisión de luz y candelabros en la escena 3D.
3. **Pines Flotantes en 3D:**
   - Proyectan la temperatura actual (`22.5 °C` en Lobby, `21.0 °C` en Showroom).
   - Al pulsar un pin, aísla la oficina en primer plano y atenúa todo el exterior al 3.5% de opacidad.
