import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { GeometryProcessor } from '@ifc-lite/geometry';
import { Renderer } from '@ifc-lite/renderer';

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

  const loadFile = useCallback(async (file: File) => {
    if (!canvasRef.current || !processorRef.current || !ready || busy) return;
    const loadId = ++loadIdRef.current;

    setBusy(true);
    setStatus('Preparing renderer...');

    try {
      const previousViewer = viewerRef.current;
      const viewer = await createViewer(canvasRef.current);
      if (loadId !== loadIdRef.current) {
        viewer.destroy();
        return;
      }

      previousViewer?.destroy();
      viewerRef.current = viewer;
      const renderer = viewer.renderer;
      const processor = processorRef.current;
      if (!processor) {
        throw new Error('Geometry processor is no longer available.');
      }

      const bytes = new Uint8Array(await file.arrayBuffer());

      let loadedMeshes = 0;
      setStatus('Streaming geometry...');

      for await (const event of processor.processStreaming(bytes)) {
        if (loadId !== loadIdRef.current) return;

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
    } catch (error) {
      console.error(error);
      if (loadId === loadIdRef.current) {
        setStatus(error instanceof Error ? error.message : 'Failed to load IFC file.');
      }
    } finally {
      if (loadId === loadIdRef.current) {
        setBusy(false);
      }
    }
  }, [busy, ready]);

  const onFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadFile(file);
    event.target.value = '';
  }, [loadFile]);

  const onDrop = useCallback(async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (!ready || busy) return;
    const file = event.dataTransfer.files?.[0];
    if (file) {
      await loadFile(file);
    }
  }, [busy, loadFile, ready]);

  const openFilePicker = useCallback(() => {
    if (!ready || busy) return;
    fileInputRef.current?.click();
  }, [busy, ready]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">IFC-Lite</p>
          <h1>ifc-viewer-webapp</h1>
          <p className="muted">
            Standalone React + Vite viewer powered by IFC-Lite geometry streaming and WebGPU rendering.
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
      </main>
    </div>
  );
}
