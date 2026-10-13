# ifc-viewer-webapp

React + Vite IFC viewer using [IFC-Lite](https://github.com/LTplus-AG/ifc-lite).

## Quick Start

```bash
npm install
npm run dev
```

Open the app in your browser and drop an IFC file onto the viewport.

## Features

- React + Vite developer experience
- IFC-Lite geometry streaming for progressive loading
- WebGPU rendering via `@ifc-lite/renderer`
- Drag-and-drop or file picker loading
- Orbit, pan, and zoom camera controls

## Learn More

- [IFC-Lite Documentation](https://ifclite.dev/docs/)
- [Rendering Guide](https://ifclite.dev/docs/guide/rendering/)
- [Geometry Guide](https://ifclite.dev/docs/guide/geometry/)

## Notes

- `vite.config.ts` contains a small plugin (`fix-ifc-lite-worker-url`) working around `@ifc-lite/geometry@7.8.1`, whose published build points its worker URL to `geometry.worker.ts` while only `geometry.worker.js` is shipped. It can be removed once upstream fixes this.
- The viewer processes IFC files fully client-side (WASM + WebGPU). To offload processing to a server, see the companion `ifc-server` project.
