import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { GeometryProcessor } from '@ifc-lite/geometry';
import { Renderer } from '@ifc-lite/renderer';
import ChatPanel from './ChatPanel';
import ModelPanel from './ModelPanel';
import {
  DEFAULT_SERVER_URL,
  checkServer,
  createServerClient,
  streamFromServer,
} from './serverLoader';

type ProcessingMode = 'local' | 'server';

type ViewerSession = {
  renderer: Renderer;
  destroy: () => void;
};

function setupCameraControls(canvas: HTMLCanvasElement, renderer: Renderer): () => void {
  const camera = renderer.getCamera();
  let isDragging = false;
  let isPanning = false;
  let lastX = 0;
  let lastY = 0;

  const onMouseDown = (event: MouseEvent) => {
    isDragging = true;
    isPanning = event.button === 1 || event.button === 2 || event.shiftKey;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.style.cursor = isPanning ? 'move' : 'grabbing';
  };

  const onMouseMove = (event: MouseEvent) => {
    if (!isDragging) return;
    const deltaX = event.clientX - lastX;
    const deltaY = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    if (isPanning) {
      camera.pan(deltaX, deltaY);
    } else {
      camera.orbit(deltaX, deltaY);
    }
  };

  const stopDrag = () => {
    isDragging = false;
    isPanning = false;
    canvas.style.cursor = 'grab';
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    camera.zoom(event.deltaY);
  };

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', stopDrag);
  canvas.addEventListener('mouseleave', stopDrag);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.style.cursor = 'grab';

  return () => {
    canvas.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', stopDrag);
    canvas.removeEventListener('mouseleave', stopDrag);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
  };
}

async function createViewer(canvas: HTMLCanvasElement): Promise<ViewerSession> {
  const renderer = new Renderer(canvas);
  await renderer.init();

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.resize(width, height);
  };

  resize();
  window.addEventListener('resize', resize);
  const cleanupControls = setupCameraControls(canvas, renderer);

  let destroyed = false;
  let frameId = 0;
  const loop = () => {
    if (destroyed) return;
    renderer.render();
    frameId = requestAnimationFrame(loop);
  };
  loop();

  return {
    renderer,
    destroy: () => {
      destroyed = true;
      cancelAnimationFrame(frameId);
      cleanupControls();
      window.removeEventListener('resize', resize);
      renderer.destroy();
    },
  };
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const processorRef = useRef<GeometryProcessor | null>(null);
  const viewerRef = useRef<ViewerSession | null>(null);
  const loadIdRef = useRef(0);
  const [status, setStatus] = useState('Initializing WebGPU viewer...');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(true);
  const [mode, setMode] = useState<ProcessingMode>('server');
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [serverToken, setServerToken] = useState('');
  const [serverStatus, setServerStatus] = useState('');
  const [chatOpen, setChatOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const initId = ++loadIdRef.current;

    const init = async () => {
      if (!canvasRef.current) return;
      if (!('gpu' in navigator)) {
        setStatus('WebGPU is not available in this browser. Try a recent Chromium-based browser.');
        setBusy(false);
        return;
      }

      try {
        const processor = new GeometryProcessor();
        await processor.init();
        if (cancelled || initId !== loadIdRef.current) {
          processor.dispose();
          return;
        }

        processorRef.current = processor;
        const viewer = await createViewer(canvasRef.current);
        if (cancelled || initId !== loadIdRef.current) {
          viewer.destroy();
          return;
        }

        viewerRef.current = viewer;
        setReady(true);
        setBusy(false);
        setStatus('Drop an IFC file or choose one to start rendering.');
      } catch (error) {
        console.error(error);
        setBusy(false);
        setStatus(error instanceof Error ? error.message : 'Failed to initialize viewer.');
      }
    };

    void init();

    return () => {
      cancelled = true;
      loadIdRef.current += 1;
      viewerRef.current?.destroy();
      viewerRef.current = null;
      processorRef.current?.dispose();
      processorRef.current = null;
    };
  }, []);

  const loadFile = useCallback(async (file: File): Promise<boolean> => {
    if (!canvasRef.current || !processorRef.current || !ready || busy) return false;
    const loadId = ++loadIdRef.current;

    setBusy(true);
    setStatus('Preparing renderer...');

    try {
      const previousViewer = viewerRef.current;
      const viewer = await createViewer(canvasRef.current);
      if (loadId !== loadIdRef.current) {
        viewer.destroy();
        return false;
      }

      previousViewer?.destroy();
      viewerRef.current = viewer;
      const renderer = viewer.renderer;
      const processor = processorRef.current;
      if (!processor) {
        throw new Error('Geometry processor is no longer available.');
      }

      if (mode === 'server') {
        setStatus('Uploading to server...');
        const client = createServerClient(serverUrl, serverToken || undefined);
        const problem = await checkServer(client);
        if (problem) throw new Error(problem);

        const total = await streamFromServer(client, await file.arrayBuffer(), (meshes, totalSoFar) => {
          if (loadId !== loadIdRef.current) return;
          renderer.addMeshes(meshes, true);
          setStatus('Received ' + totalSoFar + ' meshes from server...');
        });
        if (loadId !== loadIdRef.current) return false;
        renderer.fitToView();
        setStatus(file.name + ' loaded from server with ' + total + ' meshes.');
        return true;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());

      let loadedMeshes = 0;
      setStatus('Streaming geometry...');

      for await (const event of processor.processStreaming(bytes)) {
        if (loadId !== loadIdRef.current) return false;

        if (event.type === 'batch') {
          renderer.addMeshes(event.meshes, true);
          loadedMeshes = event.totalSoFar;
          setStatus('Loaded ' + loadedMeshes + ' meshes...');
        }

        if (event.type === 'complete') {
          renderer.fitToView();
          setStatus(file.name + ' loaded with ' + event.totalMeshes + ' meshes.');
        }
      }
      if (loadId !== loadIdRef.current) return false;
      return true;
    } catch (error) {
      console.error(error);
      if (loadId === loadIdRef.current) {
        setStatus(error instanceof Error ? error.message : 'Failed to load IFC file.');
      }
      return false;
    } finally {
      if (loadId === loadIdRef.current) {
        setBusy(false);
      }
    }
  }, [busy, ready, mode, serverUrl, serverToken]);

  const openFile = loadFile;

  const onFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await openFile(file);
    event.target.value = '';
  }, [openFile]);

  const onDrop = useCallback(async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (!ready || busy) return;
    const file = event.dataTransfer.files?.[0];
    if (file) {
      await openFile(file);
    }
  }, [busy, openFile, ready]);

  const testServer = useCallback(async () => {
    setServerStatus('Testing...');
    const problem = await checkServer(createServerClient(serverUrl, serverToken || undefined));
    setServerStatus(problem ?? 'Connected.');
  }, [serverUrl, serverToken]);

  const openFilePicker = useCallback(() => {
    if (!ready || busy) return;
    fileInputRef.current?.click();
  }, [busy, ready]);

  // The viewer sizes itself on window resize: tell it when the chat column opens or closes.
  useEffect(() => {
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => cancelAnimationFrame(frame);
  }, [chatOpen]);


  return (
    <div className={`app${chatOpen ? ' withChat' : ''}`}>
      <aside className="sidebar">
        <div>
          <p className="eyebrow">IFC-Lite</p>
          <h1>ifc-viewer-webapp</h1>
          <p className="muted">
            React + Vite viewer powered by IFC-Lite and WebGPU rendering, processing files in the browser or on an IFC-Lite server.
          </p>
        </div>

        <input
          ref={fileInputRef}
          className="visuallyHiddenInput"
          type="file"
          accept=".ifc"
          disabled={!ready || busy}
          aria-label="Choose IFC file"
          onChange={(event) => void onFileChange(event)}
        />
        <button
          type="button"
          className="uploadButton"
          disabled={!ready || busy}
          aria-disabled={!ready || busy}
          onClick={openFilePicker}
        >
          {busy ? 'Working…' : 'Choose IFC File'}
        </button>

        <div className="panel">
          <p className="label">Processing</p>
          <label>
            <input
              type="radio"
              name="mode"
              checked={mode === 'local'}
              disabled={busy}
              onChange={() => setMode('local')}
            />{' '}
            In browser (WASM)
          </label>
          <br />
          <label>
            <input
              type="radio"
              name="mode"
              checked={mode === 'server'}
              disabled={busy}
              onChange={() => setMode('server')}
            />{' '}
            IFC-Lite server
          </label>
          {mode === 'server' && (
            <div className="serverConfig">
              <input
                type="text"
                value={serverUrl}
                disabled={busy}
                aria-label="Server URL"
                placeholder="http://localhost:3001 or https://..."
                onChange={(event) => setServerUrl(event.target.value)}
              />
              <input
                type="password"
                value={serverToken}
                disabled={busy}
                aria-label="Server API token (optional)"
                placeholder="API token (optional)"
                onChange={(event) => setServerToken(event.target.value)}
              />
              <button type="button" disabled={busy} onClick={() => void testServer()}>
                Test connection
              </button>
              {serverStatus && <p className="muted">{serverStatus}</p>}
            </div>
          )}
        </div>

        <ModelPanel disabled={!ready || busy} onLoad={openFile} />

        <div className="panel">
          <p className="label">Status</p>
          <p>{status}</p>
        </div>

        <div className="panel">
          <p className="label">Controls</p>
          <ul>
            <li>Left drag: orbit</li>
            <li>Shift / middle / right drag: pan</li>
            <li>Wheel: zoom</li>
            <li>Drop an IFC anywhere on the viewport</li>
          </ul>
        </div>
      </aside>

      <main className="viewportShell" onDragOver={(event) => event.preventDefault()} onDrop={(event) => void onDrop(event)}>
        <canvas ref={canvasRef} className="viewport" />
        <button type="button" className="chatToggle" onClick={() => setChatOpen((open) => !open)}>
          {chatOpen ? 'Hide assistant' : 'Assistant'}
        </button>
      </main>

      <ChatPanel
        hidden={!chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}
