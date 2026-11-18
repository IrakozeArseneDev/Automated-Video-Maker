'use client';

interface VideoTypeSelectorProps {
  value: 'discussion' | 'documentary';
  onChange: (type: 'discussion' | 'documentary') => void;
}

export default function VideoTypeSelector({ value, onChange }: VideoTypeSelectorProps) {
  const types = [
    { id: 'discussion', label: 'Discussion Panel', icon: '🎙️', description: 'Steve, Storm, Stone - football analysis' },
    { id: 'documentary', label: 'Documentary', icon: '🎬', description: 'Single narrator, storytelling' }
  ];

  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-3">Video Format</label>
      <div className="grid grid-cols-2 gap-4">
        {types.map((type) => (
          <button
            key={type.id}
            onClick={() => onChange(type.id as 'discussion' | 'documentary')}
            className={`p-4 rounded-xl border-2 transition-all ${
              value === type.id ? 'border-purple-500 bg-purple-500/10' : 'border-gray-700 hover:border-gray-600'
            }`}
          >
            <div className="text-2xl mb-2">{type.icon}</div>
            <div className="font-medium">{type.label}</div>
            <div className="text-xs text-gray-500 mt-1">{type.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}