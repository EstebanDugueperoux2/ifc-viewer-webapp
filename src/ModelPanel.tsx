import { useCallback, useEffect, useState } from 'react';
import { createBuilding } from './modelCreator';
import {
  DEFAULT_STORE_URL,
  deleteModel,
  downloadModel,
  listModels,
  saveModel,
  type StoredModel,
} from './modelStore';

interface ModelPanelProps {
  /** Disables all actions while the viewer is busy or not ready. */
  disabled: boolean;
  /** The IFC file currently shown in the viewer, if any. */
  currentFile: File | null;
  /** Loads an IFC file into the viewer. */
  onLoad: (file: File) => Promise<void>;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ModelPanel({ disabled, currentFile, onLoad }: ModelPanelProps) {
  const [storeUrl, setStoreUrl] = useState(DEFAULT_STORE_URL);
  const [storeToken, setStoreToken] = useState('');
  const [models, setModels] = useState<StoredModel[]>([]);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);

  const [name, setName] = useState('New building');
  const [width, setWidth] = useState(12);
  const [depth, setDepth] = useState(8);
  const [storeyHeight, setStoreyHeight] = useState(3);
  const [storeys, setStoreys] = useState(2);

  const locked = disabled || working;
  const token = storeToken || undefined;

  const refresh = useCallback(async () => {
    try {
      setModels(await listModels(storeUrl, token));
      setMessage('');
    } catch (error) {
      setModels([]);
      setMessage(`Model store unavailable: ${errorMessage(error)}`);
    }
  }, [storeUrl, token]);

  useEffect(() => {
    void refresh();
    // Only on first mount: later refreshes are explicit (URL/token edits shouldn't spam requests).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(async (task: () => Promise<void>) => {
    setWorking(true);
    try {
      await task();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setWorking(false);
    }
  }, []);

  const onCreate = () =>
    run(async () => {
      const { content, fileName } = createBuilding({ name, width, depth, storeyHeight, storeys });
      const file = new File([content], fileName, { type: 'application/x-step' });
      setMessage('');
      await onLoad(file);
    });

  const onSave = () =>
    run(async () => {
      if (!currentFile) return;
      const modelName = currentFile.name.replace(/\.ifc$/i, '');
      const saved = await saveModel(storeUrl, token, modelName, currentFile);
      setMessage(`Saved "${saved.name}" (${formatSize(saved.size)}) on the server.`);
      setModels(await listModels(storeUrl, token));
    });

  const onOpen = (model: StoredModel) =>
    run(async () => {
      const file = await downloadModel(storeUrl, token, model);
      setMessage('');
      await onLoad(file);
    });

  const onDelete = (model: StoredModel) =>
    run(async () => {
      if (!window.confirm(`Delete "${model.name}" from the server?`)) return;
      await deleteModel(storeUrl, token, model.id);
      setModels(await listModels(storeUrl, token));
      setMessage(`Deleted "${model.name}".`);
    });

  const numberField = (
    label: string,
    value: number,
    set: (value: number) => void,
    step: number,
  ) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isNaN(value) ? '' : value}
        step={step}
        min={0}
        disabled={locked}
        onChange={(event) => set(event.target.valueAsNumber)}
      />
    </label>
  );

  return (
    <>
      <div className="panel">
        <p className="label">New model</p>
        <div className="serverConfig">
          <label className="field">
            <span>Name</span>
            <input type="text" value={name} disabled={locked} onChange={(event) => setName(event.target.value)} />
          </label>
          {numberField('Width (m)', width, setWidth, 0.5)}
          {numberField('Depth (m)', depth, setDepth, 0.5)}
          {numberField('Storey height (m)', storeyHeight, setStoreyHeight, 0.1)}
          {numberField('Storeys', storeys, setStoreys, 1)}
          <button type="button" disabled={locked} onClick={() => void onCreate()}>
            Create &amp; preview
          </button>
        </div>
      </div>

      <div className="panel">
        <p className="label">Model library (server)</p>
        <div className="serverConfig">
          <input
            type="text"
            value={storeUrl}
            disabled={locked}
            aria-label="Model store URL"
            placeholder="/model-api or https://..."
            onChange={(event) => setStoreUrl(event.target.value)}
          />
          <input
            type="password"
            value={storeToken}
            disabled={locked}
            aria-label="Model store API token (optional)"
            placeholder="API token (optional)"
            onChange={(event) => setStoreToken(event.target.value)}
          />
          <button type="button" disabled={locked || !currentFile} onClick={() => void onSave()}>
            {currentFile ? `Save "${currentFile.name}" to server` : 'Load or create a model to save it'}
          </button>
          <button type="button" disabled={locked} onClick={() => void run(refresh)}>
            Refresh list
          </button>
          {message && <p className="muted">{message}</p>}
          {models.length === 0 && !message && <p className="muted">No stored models yet.</p>}
          <ul className="modelList">
            {models.map((model) => (
              <li key={model.id}>
                <span title={new Date(model.createdAt).toLocaleString()}>
                  {model.name} <small>({formatSize(model.size)})</small>
                </span>
                <span className="modelActions">
                  <button type="button" disabled={locked} onClick={() => void onOpen(model)}>
                    Open
                  </button>
                  <button type="button" disabled={locked} onClick={() => void onDelete(model)}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
