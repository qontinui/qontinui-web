'use client'

// Horizontal icon popover for collapsed sidebar - updated icons v3
import React, { useState, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { LayoutDashboard, Workflow, Network, Sparkles, CheckCircle2, BarChart3, Settings, FileText, ChevronDown, ChevronLeft, ChevronRight, Scissors, Search, ImageIcon, Camera, Map, Eraser, Edit3, ListTree, Box, GitBranch, Scan, Target, Sliders, Globe, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CollapsedMenuPopover } from './collapsed-menu-popover'
import { OrganizationSwitcher } from '@/components/collaboration/OrganizationSwitcher'
import { CreateOrganizationDialog } from '@/components/collaboration/CreateOrganizationDialog'
import { useOrganization } from '@/contexts/organization-context'
import { useSidebar } from '@/contexts/sidebar-context'
import { useAuth } from '@/contexts/auth-context'
import type { Organization } from '@/types/collaboration'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  route: string
  color: string
  children?: NavItem[]
  badge?: 'beta' | 'experimental'
  adminOnly?: boolean
}

const navItems: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: <LayoutDashboard size={28} />,
    route: '/dashboard',
    color: '#00D9FF',
  },
  {
    id: 'structure',
    label: 'Structure',
    icon: <Network size={28} />,
    route: '/automation-builder/states',
    color: '#BD00FF',
    children: [
      {
        id: 'workflows',
        label: 'Workflows',
        icon: <Workflow size={22} />,
        route: '/automation-builder',
        color: '#BD00FF',
      },
      {
        id: 'states',
        label: 'States',
        icon: <Network size={22} />,
        route: '/automation-builder/states',
        color: '#BD00FF',
      },
      {
        id: 'images',
        label: 'Images',
        icon: <ImageIcon size={22} />,
        route: '/automation-builder/images',
        color: '#BD00FF',
      },
      {
        id: 'screenshots',
        label: 'Screenshots',
        icon: <Camera size={22} />,
        route: '/automation-builder/screenshots',
        color: '#BD00FF',
      },
    ],
  },
  {
    id: 'project-tools',
    label: 'Project Tools',
    icon: <Box size={28} />,
    route: '/automation-builder/overview',
    color: '#00D9FF',
    children: [
      {
        id: 'overview',
        label: 'Overview',
        icon: <LayoutDashboard size={22} />,
        route: '/automation-builder/overview',
        color: '#00D9FF',
      },
      {
        id: 'dependencies',
        label: 'Dependencies',
        icon: <GitBranch size={22} />,
        route: '/automation-builder/dependencies',
        color: '#00D9FF',
      },
      {
        id: 'components',
        label: 'Components',
        icon: <Box size={22} />,
        route: '/automation-builder/components',
        color: '#00D9FF',
      },
      {
        id: 'documentation',
        label: 'Documentation',
        icon: <FileText size={22} />,
        route: '/automation-builder/documentation',
        color: '#00D9FF',
      },
    ],
  },
  {
    id: 'create',
    label: 'Create',
    icon: <Sparkles size={28} />,
    route: '/automation-builder/image-extraction',
    color: '#00FF88',
    children: [
      {
        id: 'extract-images',
        label: 'Extract Images',
        icon: <Scissors size={22} />,
        route: '/automation-builder/image-extraction',
        color: '#FFA500',
      },
      {
        id: 'optimize-patterns',
        label: 'Optimize Patterns',
        icon: <Sparkles size={22} />,
        route: '/automation-builder/pattern-optimization',
        color: '#FFD700',
      },
      {
        id: 'discover-states',
        label: 'Discover States',
        icon: <Search size={22} />,
        route: '/automation-builder/state-discovery',
        color: '#4ECDC4',
        badge: 'beta',
      },
      {
        id: 'remove-backgrounds',
        label: 'Remove Backgrounds',
        icon: <Eraser size={22} />,
        route: '/automation-builder/background-removal',
        color: '#9B59B6',
        badge: 'experimental',
      },
    ],
  },
  {
    id: 'verify',
    label: 'Verify',
    icon: <CheckCircle2 size={28} />,
    route: '/automation-builder/testing',
    color: '#FF6B6B',
    children: [
      {
        id: 'pattern-tests',
        label: 'Pattern Tests',
        icon: <Target size={22} />,
        route: '/automation-builder/testing',
        color: '#FF6B6B',
      },
      {
        id: 'workflow-visualization',
        label: 'Workflow Visualization',
        icon: <Layers size={22} />,
        route: '/workflow-viz',
        color: '#FF6B6B',
      },
      {
        id: 'integration-tests',
        label: 'Integration Tests',
        icon: <Globe size={22} />,
        route: '/integration-testing',
        color: '#FF6B6B',
        badge: 'beta',
      },
      {
        id: 'semantic-analysis',
        label: 'Semantic Analysis',
        icon: <Scan size={22} />,
        route: '/automation-builder/semantic-analysis',
        color: '#FF6B6B',
      },
    ],
  },
  {
    id: 'project',
    label: 'Project',
    icon: <FileText size={28} />,
    route: '/project-dashboard',
    color: '#FFD700',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: <BarChart3 size={28} />,
    route: '/analytics',
    color: '#FFD700',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: <Settings size={28} />,
    route: '/automation-builder/settings',
    color: '#FFD700',
    children: [
      {
        id: 'automation-settings',
        label: 'Automation',
        icon: <Sliders size={22} />,
        route: '/automation-builder/settings',
        color: '#FFD700',
      },
      {
        id: 'application-settings',
        label: 'Profile',
        icon: <Settings size={22} />,
        route: '/profile',
        color: '#FFD700',
      },
    ],
  },
  {
    id: 'organizations',
    label: 'Organizations',
    icon: <Users size={28} />,
    route: '/organizations',
    color: '#00D9FF',
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: <Settings size={28} />,
    route: '/admin',
    color: '#FF6B6B',
    adminOnly: true,
    children: [
      {
        id: 'admin-dashboard',
        label: 'Dashboard',
        icon: <LayoutDashboard size={22} />,
        route: '/admin',
        color: '#FF6B6B',
        adminOnly: true,
      },
      {
        id: 'admin-annotations',
        label: 'Annotations',
        icon: <Scan size={22} />,
        route: '/admin/annotations',
        color: '#FF6B6B',
        adminOnly: true,
      },
      {
        id: 'admin-screenshot-annotations',
        label: 'Screenshot Annotations',
        icon: <Camera size={22} />,
        route: '/automation-builder/annotations',
        color: '#FF6B6B',
        adminOnly: true,
      },
      {
        id: 'admin-analysis',
        label: 'GUI Analysis',
        icon: <Search size={22} />,
        route: '/admin/analysis',
        color: '#FF6B6B',
        adminOnly: true,
      },
      {
        id: 'admin-regions',
        label: 'Region Analysis',
        icon: <Map size={22} />,
        route: '/admin/region-analysis',
        color: '#FF6B6B',
        adminOnly: true,
      },
      {
        id: 'admin-architecture',
        label: 'Architecture',
        icon: <Network size={22} />,
        route: '/admin/architecture',
        color: '#FF6B6B',
        adminOnly: true,
      },
    ],
  },
]

interface UnifiedSidebarProps {
  className?: string
  projectId?: number | null
}

export const UnifiedSidebar: React.FC<UnifiedSidebarProps> = ({
  className,
  projectId,
}) => {
  const { user } = useAuth()
  const { isCollapsed, setIsCollapsed } = useSidebar()
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['workflows', 'structure', 'create', 'verify', 'settings'])
  )
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [closeTimer, setCloseTimer] = useState<NodeJS.Timeout | null>(null)
  const [showCreateOrgDialog, setShowCreateOrgDialog] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { currentOrganization, organizations, loading, switchOrganization } = useOrganization()

  // Filter nav items based on admin status
  const filterNavItems = (items: NavItem[]): NavItem[] => {
    return items
      .filter(item => !item.adminOnly || user?.is_superuser)
      .map(item => ({
        ...item,
        children: item.children ? filterNavItems(item.children) : undefined
      }))
      .filter(item => !item.children || item.children.length > 0)
  }

  const visibleNavItems = filterNavItems(navItems)

  // Save collapse state to localStorage
  const toggleCollapse = () => {
    const newState = !isCollapsed
    setIsCollapsed(newState)
    localStorage.setItem('unified-sidebar-collapsed', JSON.stringify(newState))
    
    // Expand default sections when expanding sidebar
    if (!newState) {
      setExpandedSections(new Set(['workflows', 'structure', 'create', 'verify', 'settings']))
    }
  }

  const toggleSection = (id: string) => {
    const newExpanded = new Set(expandedSections)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedSections(newExpanded)
  }

  const isRouteActive = (route: string, item: NavItem): boolean => {
    // Check if route matches
    const checkRouteMatch = (routeToCheck: string): boolean => {
      if (routeToCheck.includes('?')) {
        const [basePath, query] = routeToCheck.split('?')
        const queryParams = new URLSearchParams(query)
        const currentParams = searchParams

        const baseMatch = pathname === basePath
        const categoryMatch = queryParams.get('category') === currentParams.get('category')
        const tabMatch = queryParams.get('tab') === currentParams.get('tab')

        const matches = baseMatch && categoryMatch && tabMatch
        console.log('[ROUTE CHECK]', {
          routeToCheck,
          pathname,
          basePath,
          category: { expected: queryParams.get('category'), actual: currentParams.get('category') },
          tab: { expected: queryParams.get('tab'), actual: currentParams.get('tab') },
          matches
        })
        return matches
      } else {
        // Route has no query params - it should only match if current path also has no query params
        const currentHasParams = searchParams.toString().length > 0
        const matches = pathname === routeToCheck && !currentHasParams
        console.log('[ROUTE CHECK]', {
          routeToCheck,
          pathname,
          currentHasParams,
          matches
        })
        return matches
      }
    }

    // If item has children, check if any child is active
    if (item.children && item.children.length > 0) {
      const childActive = item.children.some(child => checkRouteMatch(child.route))
      console.log('[PARENT ACTIVE CHECK]', {
        itemId: item.id,
        itemLabel: item.label,
        hasChildren: true,
        childRoutes: item.children.map(c => c.route),
        childActive
      })
      return childActive
    }

    const active = checkRouteMatch(route)
    console.log('[ITEM ACTIVE CHECK]', {
      itemId: item.id,
      itemLabel: item.label,
      route,
      active
    })
    return active
  }

  const buildRoute = (route: string): string => {
    if (!projectId) return route
    
    if (route.includes('?')) {
      return `${route}&project=${projectId}`
    } else {
      return `${route}?project=${projectId}`
    }
  }

  const handleNavigation = (route: string) => {
    router.push(buildRoute(route))
  }

  const getBadgeStyles = (badge?: string) => {
    if (badge === 'beta') {
      return 'bg-amber-500 text-black'
    }
    if (badge === 'experimental') {
      return 'bg-purple-500 text-white'
    }
    return ''
  }

  const handleOrganizationChange = async (orgId: string) => {
    try {
      await switchOrganization(orgId)
    } catch (error) {
      console.error('[UnifiedSidebar] Failed to switch organization:', error)
    }
  }

  const handleCreateOrganization = () => {
    setShowCreateOrgDialog(true)
  }

  // Convert organizations to the format expected by OrganizationSwitcher
  const switcherOrganizations: Array<{
    id: string
    name: string
    avatar_url?: string
    member_count: number
    role: 'owner' | 'admin' | 'member' | 'viewer'
  }> = organizations.map((org) => ({
    id: org.id,
    name: org.name,
    avatar_url: undefined, // Organizations don't have avatars yet
    member_count: org.member_count,
    role: 'owner', // TODO: Get actual role from org membership
  }))

  const switcherCurrentOrg = currentOrganization
    ? {
        id: currentOrganization.id,
        name: currentOrganization.name,
        avatar_url: undefined,
        member_count: currentOrganization.member_count,
        role: 'owner' as const,
      }
    : null

  return (
    <div
      className={cn(
        'fixed left-0 top-0 h-screen bg-[#0A0A0B] border-r border-gray-800/50 flex flex-col transition-all duration-300 overflow-visible z-50',
        isCollapsed ? 'w-16' : 'w-64',
        className
      )}
    >
      {/* Top Gradient Overlay */}
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-cyan-500/5 via-purple-500/5 to-transparent pointer-events-none" />

      {/* Header */}
      <div className="relative h-16 border-b border-gray-800/50 flex items-center justify-center px-3 py-2.5 bg-gradient-to-r from-cyan-500/5 via-purple-500/5 to-green-500/5">
        {isCollapsed ? (
          <div className="w-10 h-10 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 flex items-center justify-center text-white font-bold text-lg">
            Q
          </div>
        ) : (
          <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-500 via-purple-500 to-green-500 bg-clip-text text-transparent">
            Qontinui
          </h1>
        )}
      </div>

      {/* Organization Switcher */}
      {!isCollapsed && (
        <div className="px-3 pt-4 pb-2 border-b border-gray-800/50">
          <OrganizationSwitcher
            organizations={switcherOrganizations}
            currentOrganization={switcherCurrentOrg}
            onOrganizationChange={handleOrganizationChange}
            onCreateOrganization={handleCreateOrganization}
            loading={loading}
            className="bg-gray-900/50 border-gray-700 hover:bg-gray-900 hover:border-gray-600"
          />
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin px-2 py-4 space-y-1">
        {visibleNavItems.map((item, index) => {
          const itemZIndex = visibleNavItems.length - index
          console.log('[NAV ITEM Z-INDEX]', { itemId: item.id, index, zIndex: itemZIndex })
          return (
          <div
            key={item.id}
            className="relative"
            style={{ zIndex: itemZIndex }}
          >
            <button
              data-nav-id={item.id}
              onClick={() => {
                if (item.children) {
                  toggleSection(item.id)
                } else {
                  handleNavigation(item.route)
                }
              }}
              onMouseEnter={() => {
                console.log('[BUTTON] Mouse enter:', item.id, 'closeTimer exists:', !!closeTimer)
                if (closeTimer) {
                  clearTimeout(closeTimer)
                  setCloseTimer(null)
                  console.log('[BUTTON] Cleared close timer')
                }
                setHoveredItem(item.id)
              }}
              onMouseLeave={() => {
                console.log('[BUTTON] Mouse leave:', item.id, 'setting timer for 300ms')
                // Delay closing to allow mouse to move to popover
                const timer = setTimeout(() => {
                  console.log('[BUTTON] Timer expired, closing popover for:', item.id)
                  setHoveredItem(null)
                }, 300)
                setCloseTimer(timer)
              }}
              className={cn(
                'w-full px-3 py-2.5 rounded-lg flex items-center justify-between gap-2 transition-all duration-300 relative group',
                isRouteActive(item.route, item)
                  ? `bg-[${item.color}]10 border-l-3 border-[${item.color}]`
                  : 'hover:bg-gray-900'
              )}
              style={isRouteActive(item.route, item) ? {
                backgroundColor: `${item.color}20`,
                borderLeftColor: item.color,
              } : {}}
            >
              {/* Left Border for Active */}
              {isRouteActive(item.route, item) && (
                <div
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full"
                  style={{ backgroundColor: item.color }}
                />
              )}

              {/* Icon Container */}
              <div
                className={cn(
                  'flex items-center transition-all duration-300',
                  isCollapsed ? 'justify-center w-full' : '',
                  hoveredItem === item.id || isRouteActive(item.route, item)
                    ? 'scale-110'
                    : 'scale-100'
                )}
                style={
                  hoveredItem === item.id || isRouteActive(item.route, item)
                    ? {
                        filter: `drop-shadow(0 0 8px ${item.color})`,
                        brightness: isRouteActive(item.route, item) ? 1.5 : 1.1,
                      }
                    : {}
                }
              >
                <span style={{ color: item.color }}>{item.icon}</span>
              </div>

              {/* Label & Chevron (only when expanded) */}
              {!isCollapsed && (
                <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-100 truncate">
                    {item.label}
                  </span>
                  {item.children && (
                    <ChevronDown
                      size={16}
                      className={cn(
                        'flex-shrink-0 transition-transform duration-300',
                        expandedSections.has(item.id) ? 'rotate-180' : ''
                      )}
                    />
                  )}
                </div>
              )}

              {/* Tooltip for Collapsed State */}
              {isCollapsed && hoveredItem === item.id && (
                <div
                  className="absolute left-full ml-3 px-3 py-2 rounded-lg text-sm font-medium bg-gray-950 border text-gray-100 whitespace-nowrap z-50 pointer-events-none"
                  style={{
                    borderColor: item.color,
                    boxShadow: `0 0 12px ${item.color}40`,
                  }}
                >
                  {item.label}
                </div>
              )}
            </button>

            {/* Children - Expanded Sidebar */}
            {item.children && expandedSections.has(item.id) && !isCollapsed && (
              <div className="ml-2 border-l border-gray-800 space-y-1 mt-2">
                {item.children.map((child, childIndex) => {
                  const childIconColor = item.id === 'create' ? item.color : child.color;

                  return (
                    <button
                      key={child.id}
                      onClick={() => handleNavigation(child.route)}
                      onMouseEnter={() => setHoveredItem(child.id)}
                      onMouseLeave={() => setHoveredItem(null)}
                      className={cn(
                        'w-full px-3 py-2.5 rounded-lg flex items-center gap-2 transition-all duration-300 text-sm',
                        isRouteActive(child.route, child)
                          ? 'bg-gray-900 text-gray-100'
                          : 'text-gray-400 hover:text-gray-100 hover:bg-gray-900/50'
                      )}
                      style={{
                        animation: expandedSections.has(item.id)
                          ? `slideIn 0.3s ease-out forwards`
                          : undefined,
                        animationDelay: `${childIndex * 30}ms`,
                      }}
                    >
                      <span style={{ color: childIconColor, opacity: 0.65 }}>{child.icon}</span>
                      <span className="flex-1 text-left truncate">{child.label}</span>
                      {child.badge && (
                        <span
                          className={cn(
                            'text-[10px] font-bold uppercase px-2 py-0.5 rounded',
                            getBadgeStyles(child.badge)
                          )}
                        >
                          {child.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Children - Collapsed Sidebar Popover */}
            {item.children && isCollapsed && hoveredItem === item.id && (() => {
              console.log('[POPOVER RENDER]', {
                parentId: item.id,
                parentLabel: item.label,
                isCollapsed,
                hoveredItem,
                itemZIndex,
                childrenCount: item.children?.length
              })
              return (
              <CollapsedMenuPopover
                parentId={item.id}
                parentColor={item.color}
                children={item.children}
                onNavigate={handleNavigation}
                onClose={() => setHoveredItem(null)}
                onClearTimer={() => {
                  console.log('[CLEAR TIMER] Called, closeTimer exists:', !!closeTimer)
                  if (closeTimer) {
                    clearTimeout(closeTimer)
                    setCloseTimer(null)
                    console.log('[CLEAR TIMER] Timer cleared successfully')
                  }
                }}
              />
              )
            })()}
          </div>
          )
        })}
      </nav>

      {/* Bottom Gradient Overlay */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-purple-500/5 to-transparent pointer-events-none" />

      {/* Footer */}
      <div className="border-t border-gray-800/50 p-2 flex justify-center">
        <button
          onClick={toggleCollapse}
          className="p-2 rounded-lg hover:bg-gray-900 transition-all duration-300 hover:scale-110 text-gray-400 hover:text-gray-100"
        >
          {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      {/* Create Organization Dialog */}
      <CreateOrganizationDialog
        open={showCreateOrgDialog}
        onOpenChange={setShowCreateOrgDialog}
      />
    </div>
  )
}
