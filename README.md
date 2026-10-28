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

## Using the IFC-Lite server

The sidebar has a **Processing** switch:

- **In browser (WASM)**: files are processed locally (default).
- **IFC-Lite server**: the file is uploaded to the server, which streams geometry back as Parquet batches (`@ifc-lite/server-client`). Useful for large models and repeat access (server-side cache).

1. Start the server from the companion `ifc-server` repo: `docker compose up -d` (listens on http://localhost:3001).
2. Start the webapp: `npm run dev`. In dev, Vite proxies `/ifc-api` to the server, which is the default **Server URL**.
3. Choose **IFC-Lite server**, click **Test connection**, then load an IFC file.

Configuration:

| Variable | Where | Purpose |
|---|---|---|
| `IFC_SERVER_URL` | Vite dev server env | Target of the `/ifc-api` proxy (default `http://localhost:3001`) |
| `VITE_IFC_SERVER_URL` | build-time env | Default Server URL for deployed builds (e.g. `https://ifc.example.com`); the server must then allow CORS from the webapp origin |

If the server sets `IFC_SERVER_API_TOKEN`, enter the token in the sidebar. It is only kept in memory.

## Creating models

- **New model**: generates a simple IFC4 building (4 walls and a floor slab per storey, plus a roof slab) from a name, footprint, storey height and number of storeys, using `@ifc-lite/create`, then displays it. Non-ASCII characters in names are escaped as required by the STEP format.

## AI assistant (chat)

The **Assistant** button (top right of the viewport) opens a chat column. Describe what you want and Claude creates, queries and edits the IFC model through the `assistant` service of `ifc-server`, which embeds the `@ifc-lite/mcp` server (see that repository's README for the architecture and security model).

- Examples: "Create a two-storey 12 x 8 m building", "How many walls are there?", "Move the north wall 50 cm", "Rename the storeys".
- The assistant can create and edit models managed by the `ifc-server` assistant service. It does not read the IFC file currently open in the viewer.
- Each tool call is shown as a small line (✓ done, ✗ failed). **New chat** starts a fresh conversation; **Stop** cancels the current answer.

Start the stack with `docker compose up -d` in `ifc-server` after setting `ANTHROPIC_API_KEY` in its `.env`. The key stays on the server and is never sent to the browser.

| Variable | Where | Purpose |
|---|---|---|
| `ASSISTANT_URL` | Vite dev server env | Target of the `/assistant-api` proxy (default `http://localhost:3003`) |
| `VITE_ASSISTANT_URL` | build-time env | Default assistant URL for deployed builds; the assistant must then list the webapp origin in `CORS_ALLOWED_ORIGINS` |

If the assistant sets `ASSISTANT_API_TOKEN`, enter it under the chat's **Settings** (kept in memory only).
