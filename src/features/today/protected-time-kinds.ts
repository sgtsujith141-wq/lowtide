import { Heart, House, Leaf, Moon, Users, type LucideIcon } from 'lucide-react';
import type { ProtectedTimeKind } from '../../types/domain';

export const KIND_LABEL: Record<ProtectedTimeKind, string> = {
  relationship: 'Relationship',
  family: 'Family',
  friends: 'Friends',
  rest: 'Rest',
  personal: 'Personal',
};

export const KIND_ICON: Record<ProtectedTimeKind, LucideIcon> = {
  relationship: Heart,
  family: House,
  friends: Users,
  rest: Moon,
  personal: Leaf,
};
