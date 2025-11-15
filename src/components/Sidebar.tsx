import React from 'react';
import {
  Home,
  Box,
  BarChart2,
  Clock,
  Bell,
  Leaf,
  Users,
  Settings,
} from 'lucide-react';

interface Props {
  mobileOpen?: boolean;
  onClose?: () => void;
  /** Optional callback when a menu item is activated. If omitted, sidebar will only track active item locally. */
  onNavigate?: (key: string) => void;
}

type MenuItemType = {
  key: string;
  label: string;
  icon: React.ReactNode;
  href?: string; // optional URL
  category: string;
};

const items: MenuItemType[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <Home className="w-5 h-5" />, category: 'Main', href: '/' },
  { key: 'inventory', label: 'Inventory', icon: <Box className="w-5 h-5" />, category: 'Main', href: '/inventory' },
  { key: 'stats', label: 'Statistics', icon: <BarChart2 className="w-5 h-5" />, category: 'Insights', href: '/stats' },
  { key: 'predictions', label: 'Predictions', icon: <Clock className="w-5 h-5" />, category: 'Insights', href: '/predictions' },
  { key: 'alerts', label: 'Alerts', icon: <Bell className="w-5 h-5" />, category: 'Main', href: '/alerts' },
  { key: 'sustainability', label: 'Sustainability', icon: <Leaf className="w-5 h-5" />, category: 'Insights', href: '/sustainability' },
  { key: 'team', label: 'Team', icon: <Users className="w-5 h-5" />, category: 'Admin', href: '/team' },
  { key: 'settings', label: 'Settings', icon: <Settings className="w-5 h-5" />, category: 'Admin', href: '/settings' },
];

export const Sidebar: React.FC<Props> = ({ mobileOpen = false, onClose, onNavigate }) => {
  const [active, setActive] = React.useState<string>('dashboard');
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  // Build categories
  const categories = React.useMemo(() => {
    const map = new Map<string, MenuItemType[]>();
    for (const it of items) {
      const list = map.get(it.category) || [];
      list.push(it);
      map.set(it.category, list);
    }
    return Array.from(map.entries()); // [ [category, items[]], ... ]
  }, []);

  const activate = (key: string) => {
    setActive(key);
    if (onNavigate) onNavigate(key);
  };

  const MenuItem = ({ item }: { item: MenuItemType }) => {
    const isActive = item.key === active;

    const handleClick = (e?: React.MouseEvent) => {
      e?.preventDefault();
      activate(item.key);
      // If href exists, navigate via history API so single-page apps work without react-router
      if (item.href) {
        try {
          const url = new URL(item.href, window.location.origin);
          window.history.pushState({}, '', url.pathname + url.search + url.hash);
          // dispatch a popstate so other parts of the app can react
          window.dispatchEvent(new PopStateEvent('popstate'));
        } catch (err) {
          // fallback to full navigation
          window.location.href = item.href as string;
        }
      }
      if (onClose) onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    };

    const baseClasses = `w-full text-left flex items-center gap-3 px-4 py-2 rounded-lg transition-colors cursor-pointer pointer-events-auto ${
      isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-700 hover:bg-gray-100'
    }`;

    // Render as anchor if href provided, otherwise button
    if (item.href) {
      return (
        <a
          href={item.href}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          role="menuitem"
          tabIndex={0}
          className={baseClasses}
          aria-current={isActive ? 'page' : undefined}
        >
          <div className="flex-shrink-0">{item.icon}</div>
          <div className="flex-1">{item.label}</div>
        </a>
      );
    }

    return (
      <button
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="menuitem"
        className={baseClasses}
      >
        <div className="flex-shrink-0">{item.icon}</div>
        <div className="flex-1">{item.label}</div>
      </button>
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 z-40 md:hidden ${mobileOpen ? 'block' : 'hidden'}`}
        onClick={onClose}
      />

      {/* Sidebar panel */}
      <aside
        className={`fixed z-50 inset-y-0 left-0 w-64 bg-white border-r border-gray-200 shadow-sm transform transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0 md:sticky md:top-0 md:h-screen md:shadow-none overflow-y-auto`}
        aria-label="Main navigation"
      >
        <div className="h-full flex flex-col p-4">
          <div className="flex items-center gap-3 px-2 py-3 mb-4">
            <div className="bg-blue-50 text-blue-600 rounded-full w-9 h-9 flex items-center justify-center font-bold">SP</div>
            <div>
              <div className="text-sm font-bold text-gray-800">Supply Predictor</div>
              <div className="text-xs text-gray-500">Welcome back</div>
            </div>
          </div>

          <nav className="mt-2" role="menu">
            {categories.map(([category, list]) => (
              <div key={category} className="mb-4">
                <div className="flex items-center justify-between px-3 mb-2">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{category}</div>
                  <button
                    aria-label={`Toggle ${category}`}
                    onClick={() => setCollapsed((s) => ({ ...s, [category]: !s[category] }))}
                    className="text-gray-400 hover:text-gray-600 focus:outline-none"
                  >
                    <svg
                      className={`w-4 h-4 transform transition-transform ${collapsed[category] ? '-rotate-90' : 'rotate-0'}`}
                      viewBox="0 0 20 20"
                      fill="none"
                    >
                      <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>

                <div className={`${collapsed[category] ? 'hidden' : 'block'} space-y-1 px-1`}>
                  {list.map((it) => (
                    <MenuItem key={it.key} item={it} />
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="mt-auto px-4">
            <hr className="my-4 border-gray-100" />
            <div className="text-xs text-gray-500">v1.0.0</div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
