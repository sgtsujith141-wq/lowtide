import { Copy, Download, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Announcer, ErrorNotice } from '../../components/ui/Notice';
import type { BackupData } from '../../db/repositories';
import { downloadText } from '../backup/download';
import { buildContextPack, renderContextMarkdown, type ContextScope } from './pack';

/**
 * Shows exactly what an AI client would receive for a scope, with Copy and
 * Download. Nothing is sent anywhere: LOWTIDE has no network connection.
 */
export function ContextPreview({
  data,
  scope,
  fileName,
  onRefresh,
}: {
  data: BackupData;
  scope: ContextScope;
  fileName: string;
  onRefresh: () => void;
}) {
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<string | null>(null);
  let markdown = '';
  try {
    markdown = renderContextMarkdown(buildContextPack(data, scope, new Date()));
  } catch {
    markdown = '';
  }

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(markdown);
      setAnnouncement('Context copied.');
    } catch {
      setError('Couldn’t copy. Select the text and copy it, or download it instead.');
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void copy()} disabled={!markdown}>
          <Copy aria-hidden className="size-4" /> Copy
        </Button>
        <Button
          onClick={() => {
            downloadText(fileName, markdown, 'text/markdown');
            setAnnouncement(`Downloaded ${fileName}.`);
          }}
          disabled={!markdown}
        >
          <Download aria-hidden className="size-4" /> Download {fileName}
        </Button>
        <Button variant="ghost" onClick={onRefresh}>
          <RefreshCw aria-hidden className="size-4" /> Refresh
        </Button>
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <pre
        tabIndex={0}
        aria-label="Context preview"
        className="mt-3 max-h-96 overflow-auto rounded-lg border border-line bg-surface p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
      >
        {markdown || 'Nothing to show for this scope.'}
      </pre>
      <Announcer message={announcement} />
    </div>
  );
}
