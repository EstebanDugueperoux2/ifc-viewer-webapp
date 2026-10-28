import { useState } from 'react';
import { createBuilding } from './modelCreator';

interface ModelPanelProps {
  /** Disables all actions while the viewer is busy or not ready. */
  disabled: boolean;
  onLoad: (file: File) => Promise<unknown>;
}

export default function ModelPanel({ disabled, onLoad }: ModelPanelProps) {
  const [name, setName] = useState('New building');
  const [width, setWidth] = useState(12);
  const [depth, setDepth] = useState(8);
  const [storeyHeight, setStoreyHeight] = useState(3);
  const [storeys, setStoreys] = useState(2);

  const numberField = (label: string, value: number, set: (value: number) => void, step: number) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isNaN(value) ? '' : value}
        step={step}
        min={0}
        disabled={disabled}
        onChange={(event) => set(event.target.valueAsNumber)}
      />
    </label>
  );

  const onCreate = async () => {
    const { content, fileName } = createBuilding({ name, width, depth, storeyHeight, storeys });
    await onLoad(new File([content], fileName, { type: 'application/x-step' }));
  };

  return (
    <div className="panel">
      <p className="label">New model</p>
      <div className="serverConfig">
        <label className="field">
          <span>Name</span>
          <input type="text" value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} />
        </label>
        {numberField('Width (m)', width, setWidth, 0.5)}
        {numberField('Depth (m)', depth, setDepth, 0.5)}
        {numberField('Storey height (m)', storeyHeight, setStoreyHeight, 0.1)}
        {numberField('Storeys', storeys, setStoreys, 1)}
        <button type="button" disabled={disabled} onClick={() => void onCreate()}>
          Create &amp; preview
        </button>
      </div>
    </div>
  );
}
