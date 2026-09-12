// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import {
  Activity,
  Boxes,
  Calculator,
  Code2,
  Cpu,
  Download,
  FlaskConical,
  Gauge,
  Globe,
  BookOpen,
  Flame,
  Heart,
  History,
  LifeBuoy,
  Radar,
  Shapes,
  Languages,
  LayoutGrid,
  LineChart,
  List,
  Lock,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icon names arrive from the JSON message bundles as plain strings, so they
 * must be resolved through an explicit map – dynamic `import()` of lucide icons
 * would break tree-shaking and the static build.
 * Keep the keys in sync with `features.items[].icon` in messages/*.json.
 */
export const FEATURE_ICONS: Record<string, LucideIcon> = {
  Zap,
  Globe,
  LayoutGrid,
  ShieldCheck,
  Languages,
  Cpu,
  Activity,
  Boxes,
  Gauge,
  LineChart,
  Lock,
  Radio,
  SlidersHorizontal,
  Sparkles,
  Wallet,
  History,
  FlaskConical,
  Table2,
  Calculator,
  List,
  Download,
  Heart,
  Shapes,
  Flame,
  BookOpen,
  Radar,
  Code2,
  LifeBuoy,
};

export function FeatureIcon({ name, className }: { name: string; className?: string }) {
  const Icon = FEATURE_ICONS[name] ?? Zap;
  return <Icon className={className} aria-hidden strokeWidth={1.75} />;
}
