import { useRepositories } from '../../hooks/useRepositories';
import { useWatch } from '../../hooks/useWatch';
import type { OffTimeSession, WorkSession } from '../../types/domain';

/** The open work session and the open off-time window, live. */
export function useModes(): {
  work: WorkSession | undefined;
  offTime: OffTimeSession | undefined;
  ready: boolean;
} {
  const { work, offTime } = useRepositories();
  const activeWork = useWatch(work.watchActive);
  const activeOff = useWatch(offTime.watchActive);
  return {
    work: activeWork.status === 'ready' ? activeWork.data : undefined,
    offTime: activeOff.status === 'ready' ? activeOff.data : undefined,
    ready: activeWork.status === 'ready' && activeOff.status === 'ready',
  };
}
