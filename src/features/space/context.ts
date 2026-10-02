import { createContext, useContext } from 'react';
import type { SpaceNode } from '../../types/domain';
import type { EntityLookup } from './entities';
import type { SpaceIndex } from './model';

/** What every SPACE pane shares: all nodes, their index and the record lookup. */
export interface SpaceData {
  nodes: readonly SpaceNode[];
  index: SpaceIndex;
  lookup: EntityLookup;
}

export const SpaceDataContext = createContext<SpaceData | null>(null);

export function useSpaceData(): SpaceData {
  const data = useContext(SpaceDataContext);
  if (!data) throw new Error('SPACE data is only available inside SPACE');
  return data;
}
