import {
  Home,
  Timer,
  History,
  Users,
  Tag,
  ListChecks,
  UserCog,
  Wallet,
  Bell,
  BarChart3,
  CalendarClock,
  ScrollText,
  BookOpen,
  CalendarDays,
  FileText,
  Plug,
  User,
  type LucideIcon,
} from "lucide-react";

// Shared href -> icon map for both the desktop Sidebar and the mobile
// BottomNav, so the two navs never drift out of sync on which icon
// represents which screen. Originally lived only in BottomNav.tsx
// (Phase 7); pulled out here when the Sidebar was added (redesign
// direction A) so both consume one source.
export const NAV_ICONS: Record<string, LucideIcon> = {
  "/app": Home,
  "/app/timer": Timer,
  "/app/my-time": History,
  "/app/tasks": ListChecks,
  "/app/clients": Users,
  "/app/categories": Tag,
  "/app/time-entries": ListChecks,
  "/app/users": UserCog,
  "/app/hour-banks": Wallet,
  "/app/alerts": Bell,
  "/app/reports": BarChart3,
  "/app/report-schedules": CalendarClock,
  "/app/audit-log": ScrollText,
  "/app/integrations": Plug,
  "/app/guide": BookOpen,
  "/app/notifications": Bell,
  "/app/profile": User,
  // Portal phase 1: the client's home is the promises screen, and the
  // hour bank moved to its own entry.
  "/app/portal": Home,
  "/app/portal/activity": ListChecks,
  "/app/portal/hours": Wallet,
  "/app/portal/weekly": CalendarDays,
  "/app/portal/monthly": FileText,
  "/app/portal/history": History,
};
