import { useState } from 'react';
import { 
  LayoutDashboard, 
  Calculator, 
  Users, 
  Briefcase, 
  ShoppingCart, 
  HardHat, 
  Settings,
  Menu,
  Bell,
  Search,
  LogOut,
  User,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import LogoImg from './thisone.png';
import { Module, ParentModule } from './types';
import { Button } from './components/ui/button';
import { ScrollArea } from './components/ui/scroll-area';
import { Separator } from './components/ui/separator';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from './components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from './components/ui/avatar';
import { 
  Sheet, 
  SheetContent, 
  SheetTrigger,
  SheetHeader,
  SheetTitle
} from './components/ui/sheet';
import { Toaster } from './components/ui/sonner';
import { motion, AnimatePresence } from 'motion/react';

// Module Components
import Dashboard from './components/modules/Dashboard';
import Accounting from './components/modules/Accounting';
import HR from './components/modules/HR';
import Projects from './components/modules/Projects';
import Procurement from './components/modules/Procurement';
import FieldOps from './components/modules/FieldOps';
import SettingsView from './components/modules/Settings';

interface NavItem {
  id: ParentModule;
  label: string;
  icon: any;
  subItems?: { id: Module; label: string }[];
}

import { useAuth } from './contexts/AuthContext';
import Login from './components/Login';

export default function App() {
  const { user, loading, logout } = useAuth();
  const [activeModule, setActiveModule] = useState<Module>('dashboard');
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#F5F5F5]">
        <Loader2 className="w-8 h-8 animate-spin text-[#141414]" />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Login />
        <Toaster position="top-right" />
      </>
    );
  }

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { 
      id: 'accounting', 
      label: 'Accounting', 
      icon: Calculator,
      subItems: [
        { id: 'accounting-bank', label: 'Bank & Cash' },
        { id: 'accounting-ar', label: 'Accounts Receivable (AR)' },
        { id: 'accounting-ap', label: 'Accounts Payable (AP)' },
        { id: 'accounting-transactions', label: 'General Ledger' },
        { id: 'accounting-reports', label: 'Financial Reports' },
      ]
    },
    { 
      id: 'hr', 
      label: 'HR & Payroll', 
      icon: Users,
      subItems: [
        { id: 'hr-directory', label: 'Employee Directory' },
        { id: 'hr-payroll', label: 'Payroll' },
        { id: 'hr-attendance', label: 'Attendance' },
        { id: 'hr-leave', label: 'Leave Management' },
      ]
    },
    { 
      id: 'projects', 
      label: 'Projects', 
      icon: Briefcase,
      subItems: [
        { id: 'projects-active', label: 'Active Projects' },
        { id: 'projects-costing', label: 'Job Costing' },
        { id: 'projects-contracts', label: 'Contracts' },
        { id: 'projects-wip', label: 'WIP Accounting' },
      ]
    },
    { 
      id: 'procurement', 
      label: 'Procurement', 
      icon: ShoppingCart,
      subItems: [
        { id: 'procurement-pos', label: 'Purchase Orders' },
        { id: 'procurement-inventory', label: 'Site Inventory' },
        { id: 'procurement-suppliers', label: 'Suppliers' },
      ]
    },
    { id: 'field-ops', label: 'Field Operations', icon: HardHat },
  ];

  // HR sub-items visible per role
  const hrSubItemsForRole = (role: string) => {
    if (role === 'admin' || role === 'hr') {
      return undefined; // show all sub-items
    }
    // Accountant, PM, Procurement, and all other roles only see Leave & Payroll
    return ['hr-leave', 'hr-payroll'];
  };

  // Role-based filtering (with sub-item scoping)
  const filteredNavItems = navItems.filter(item => {
    if (user.role === 'admin') return true;
    if (item.id === 'dashboard') return true;
    
    switch (user.role) {
      case 'hr':
        return ['hr', 'projects', 'settings'].includes(item.id);
      case 'accountant':
        return ['accounting', 'hr', 'projects', 'settings'].includes(item.id);
      case 'pm':
        return ['projects', 'hr', 'field-ops'].includes(item.id);
      case 'procurement':
        return ['procurement', 'hr'].includes(item.id);
      default:
        return false;
    }
  }).map(item => {
    // Scope HR sub-items based on role
    if (item.id === 'hr' && item.subItems) {
      const allowedSubs = hrSubItemsForRole(user.role);
      if (allowedSubs) {
        return { ...item, subItems: item.subItems.filter(sub => allowedSubs.includes(sub.id)) };
      }
    }
    return item;
  });

  // The 'Settings' shortcut is permanently docked at the bottom of the sidebar.
  const finalNavItems = [...filteredNavItems];

  const toggleParent = (id: string) => {
    const newExpanded = new Set(expandedParents);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedParents(newExpanded);
  };

  const renderModule = () => {
    if (activeModule === 'dashboard') return <Dashboard />;
    if (activeModule.startsWith('accounting')) return <Accounting activeSub={activeModule} />;
    if (activeModule.startsWith('hr')) return <HR activeSub={activeModule} />;
    if (activeModule.startsWith('projects')) return <Projects activeSub={activeModule} />;
    if (activeModule.startsWith('procurement')) return <Procurement activeSub={activeModule} />;
    if (activeModule === 'field-ops') return <FieldOps />;
    if (activeModule === 'settings') return <SettingsView />;
    return <Dashboard />;
  };

  const isChildActive = (parent: NavItem) => {
    if (!parent.subItems) return activeModule === parent.id;
    return parent.subItems.some(sub => sub.id === activeModule);
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-[#1e293b] text-white">
      <div className="p-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden shadow-sm border border-white/10">
          <img src={LogoImg} className="w-full h-full object-cover" alt="Logo" />
        </div>
        <span className="font-bold text-xl tracking-tight truncate">bytzforge</span>
      </div>

      <ScrollArea className="flex-1 px-3">
        <nav className="space-y-1">
          {finalNavItems.map((item) => {
            const isActive = isChildActive(item);
            const isExpanded = expandedParents.has(item.id);

            return (
              <div key={item.id} className="space-y-1">
                <button
                  onClick={() => {
                    if (item.subItems) {
                      toggleParent(item.id);
                    } else {
                      setActiveModule(item.id as Module);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${
                    isActive && !item.subItems
                      ? 'bg-white text-[#141414]' 
                      : 'hover:bg-white/10 text-white/70'
                  } ${isActive && item.subItems ? 'text-white' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <item.icon className="w-5 h-5 shrink-0" />
                    <span className="font-medium truncate">{item.label}</span>
                  </div>
                  {item.subItems && (
                    isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
                  )}
                </button>

                <AnimatePresence>
                  {isExpanded && item.subItems && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden pl-9 space-y-1"
                    >
                      {item.subItems.map((sub) => (
                        <button
                          key={sub.id}
                          onClick={() => setActiveModule(sub.id)}
                          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                            activeModule === sub.id
                              ? 'text-white font-semibold bg-white/10'
                              : 'text-white/50 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          {sub.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>
      </ScrollArea>

      <div className="p-4 border-t border-white/10">
        <button 
          onClick={() => setActiveModule('settings')}
          className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/10 text-white/70 transition-colors ${
            activeModule === 'settings' ? 'bg-white/10 text-white' : ''
          }`}
        >
          <Settings className="w-5 h-5 shrink-0" />
          <span className="font-medium">Settings</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#F5F5F5] text-[#141414] font-sans">
      {/* Desktop Sidebar */}
      <aside 
        className={`${
          isSidebarOpen ? 'w-64' : 'w-20'
        } bg-[#141414] text-white transition-all duration-300 hidden lg:flex flex-col z-50`}
      >
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden shadow-sm border border-white/10">
            <img src={LogoImg} className="w-full h-full object-cover" alt="Logo" />
          </div>
          {isSidebarOpen && <span className="font-bold text-xl tracking-tight truncate">bytzforge</span>}
        </div>

        <ScrollArea className="flex-1 px-3">
          <nav className="space-y-1">
            {finalNavItems.map((item) => {
              const isActive = isChildActive(item);
              const isExpanded = expandedParents.has(item.id);

              return (
                <div key={item.id} className="space-y-1">
                  <button
                    onClick={() => {
                      if (item.subItems) {
                        toggleParent(item.id);
                      } else {
                        setActiveModule(item.id as Module);
                      }
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${
                      isActive && !item.subItems
                        ? 'bg-white text-[#141414]' 
                        : 'hover:bg-white/10 text-white/70'
                    } ${isActive && item.subItems ? 'text-white' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className="w-5 h-5 shrink-0" />
                      {isSidebarOpen && <span className="font-medium truncate">{item.label}</span>}
                    </div>
                    {isSidebarOpen && item.subItems && (
                      isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
                    )}
                  </button>

                  <AnimatePresence>
                    {isSidebarOpen && isExpanded && item.subItems && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden pl-9 space-y-1"
                      >
                        {item.subItems.map((sub) => (
                          <button
                            key={sub.id}
                            onClick={() => setActiveModule(sub.id)}
                            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                              activeModule === sub.id
                                ? 'text-white font-semibold bg-white/10'
                                : 'text-white/50 hover:text-white hover:bg-white/5'
                            }`}
                          >
                            {sub.label}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </nav>
        </ScrollArea>

        <div className="p-4 border-t border-white/10">
          <button 
            onClick={() => setActiveModule('settings')}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/10 text-white/70 transition-colors ${
              activeModule === 'settings' ? 'bg-white/10 text-white' : ''
            }`}
          >
            <Settings className="w-5 h-5 shrink-0" />
            {isSidebarOpen && <span className="font-medium">Settings</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-[#E4E3E0] flex items-center justify-between px-4 md:px-8 shrink-0">
          <div className="flex items-center gap-2 md:gap-4">
            {/* Mobile Sidebar Trigger */}
            <div className="lg:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="hover:bg-[#F5F5F5]">
                    <Menu className="w-5 h-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="p-0 w-72 bg-[#141414] border-none">
                  <SheetHeader className="sr-only">
                    <SheetTitle>Navigation Menu</SheetTitle>
                  </SheetHeader>
                  <SidebarContent />
                </SheetContent>
              </Sheet>
            </div>

            {/* Desktop Sidebar Toggle */}
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="hover:bg-[#F5F5F5] hidden lg:flex"
            >
              <Menu className="w-5 h-5" />
            </Button>
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8E9299]" />
              <input 
                type="text" 
                placeholder="Search projects, invoices..." 
                className="bg-[#F5F5F5] border-none rounded-full pl-10 pr-4 py-2 text-sm w-64 focus:ring-2 focus:ring-[#141414] outline-none transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="relative hover:bg-[#F5F5F5]">
              <Bell className="w-5 h-5" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            </Button>
            
            <Separator orientation="vertical" className="h-6 hidden sm:block" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2 hover:bg-[#F5F5F5]">
                  <Avatar className="w-9 h-9 border-2 border-slate-100 shadow-sm">
                    <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${user.email}&backgroundColor=2563eb,3b82f6,60a5fa`} />
                    <AvatarFallback className="bg-blue-600 text-white font-bold">{user.email.substring(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="text-left hidden sm:block">
                    <p className="text-sm font-semibold leading-none">{user.email.split('@')[0]}</p>
                    <p className="text-xs text-[#8E9299] mt-1 capitalize">{user.role}</p>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveModule('settings')}>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-red-600" onClick={logout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Module Content */}
        <ScrollArea className="flex-1 p-8">
          <div className="max-w-7xl mx-auto">
            {renderModule()}
          </div>
        </ScrollArea>
      </main>
      <Toaster position="top-right" />
    </div>
  );
}

import { Loader2 } from 'lucide-react';

