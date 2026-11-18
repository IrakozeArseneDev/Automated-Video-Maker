'use client';

interface ScriptBoxProps {
  value: string;
  onChange: (value: string) => void;
}

export default function ScriptBox({ value, onChange }: ScriptBoxProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-2">
        Your Script
      </label>
      <textarea
        className="w-full h-[400px] p-4 rounded-xl bg-black border border-gray-700 text-white focus:border-blue-500 focus:outline-none transition-colors resize-none"
        placeholder="Paste your script here...&#10;&#10;Example:&#10;The sun rises over the mountains, painting the sky in brilliant oranges and pinks. Birds begin their morning chorus as the valley wakes from its slumber. A gentle breeze carries the scent of pine and wildflowers through the air."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="mt-2 text-sm text-gray-500">
        {value.split(/\s+/).filter(Boolean).length} words
      </div>
    </div>
  );
}