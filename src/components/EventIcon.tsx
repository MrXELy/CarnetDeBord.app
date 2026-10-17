import { Fuel, PackageCheck, PackagePlus, Sunrise, Sunset, type LucideProps } from 'lucide-react';
import type { EventType } from '../types';

const ICONS = {
  debut_journee: Sunrise,
  chargement: PackagePlus,
  livraison: PackageCheck,
  carburant: Fuel,
  fin_journee: Sunset,
} satisfies Record<EventType, unknown>;

export default function EventIcon({ type, ...props }: { type: EventType } & LucideProps) {
  const Icon = ICONS[type];
  return <Icon size={20} strokeWidth={1.75} aria-hidden {...props} />;
}
