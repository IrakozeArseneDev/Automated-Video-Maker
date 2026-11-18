'use client';

interface ModeSelectorProps {
  value: 'short' | 'long';
  onChange: (mode: 'short' | 'long') => void;
}

export default function ModeSelector({ value, onChange }: ModeSelectorProps) {
  const modes = [
    { id: 'short', label: 'Shorts (9:16)', icon: '📱', description: '30-90 seconds, fast pacing' },
    { id: 'long', label: 'Long-form (16:9)', icon: '🖥️', description: '5-60+ minutes, slow pacing' }
  ];

  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-3">
        Video Mode
      </label>
      <div className="grid grid-cols-2 gap-4">
        {modes.map((mode) => (
          <button
            key={mode.id}
            onClick={() => onChange(mode.id as 'short' | 'long')}
            className={`p-4 rounded-xl border-2 transition-all ${
              value === mode.id
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-gray-700 hover:border-gray-600'
            }`}
          >
            <div className="text-2xl mb-2">{mode.icon}</div>
            <div className="font-medium">{mode.label}</div>
            <div className="text-xs text-gray-500 mt-1">{mode.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}