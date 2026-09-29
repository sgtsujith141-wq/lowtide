import { useEffect, useState } from 'react';
import type { BackupData } from '../../db/repositories';
import { useRepositories } from '../../hooks/useRepositories';

/**
 * One consistent snapshot of LOWTIDE (the backup export's single read-only
 * transaction), taken on mount and again on `refresh()`.
 */
export function useSnapshot() {
  const { backup } = useRepositories();
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ data: BackupData | null; error: boolean }>({
    data: null,
    error: false,
  });
  useEffect(() => {
    let live = true;
    backup.exportBackup().then(
      (doc) => live && setState({ data: doc.data, error: false }),
      () => live && setState((s) => ({ ...s, error: true })),
    );
    return () => {
      live = false;
    };
  }, [backup, version]);
  return { ...state, refresh: () => setVersion((v) => v + 1) };
}
