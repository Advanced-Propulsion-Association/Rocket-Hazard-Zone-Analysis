import { useState, useCallback } from 'react';
import { parseOrkFile } from '../simulation/orkParser';
import type { OpenRocketData } from '../types';

interface Props {
  onParsed: (data: OpenRocketData) => void;
  onError: (msg: string) => void;
}

export function OrkUpload({ onParsed, onError }: Props) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.ork')) {
      onError('Please upload a .ork file (OpenRocket format).');
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const data = await parseOrkFile(buffer);
      setFileName(file.name);
      onParsed(data);
    } catch (e) {
      onError(`Failed to parse .ork file: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [onParsed, onError]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div>
      <label
        className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors ${
          dragging ? 'border-blue-400 bg-blue-900/20' : 'border-gray-600 hover:border-blue-500'
        }`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="text-2xl mb-2">📂</span>
        <span className="text-sm text-gray-300">
          {fileName ? `Loaded: ${fileName}` : 'Drop .ork file here or click to browse'}
        </span>
        <input type="file" accept=".ork" className="hidden" onChange={onInputChange} />
      </label>
    </div>
  );
}
