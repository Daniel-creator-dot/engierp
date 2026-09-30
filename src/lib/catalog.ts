import { useEffect, useState } from 'react';
import { catalogApi, CategoryType } from './api';

export interface Category {
  id: number;
  name: string;
  type: CategoryType;
  description?: string | null;
  account_id?: number | null;
  account_code?: string | null;
  account_name?: string | null;
  is_active: boolean;
}

export interface Service {
  id: number;
  name: string;
  description?: string | null;
  category_id?: number | null;
  category_name?: string | null;
  unit: string;
  default_price: number | string;
  is_active: boolean;
}

export const CATEGORY_TYPE_LABELS: Record<CategoryType, string> = {
  expense: 'Expense',
  supplier: 'Supplier',
  inventory: 'Inventory',
  asset: 'Equipment',
  service: 'Service',
};

const CATEGORY_MANAGER_ROLES = ['admin', 'accountant'];

// Roles besides admin/accountant that may add and rename categories of a type.
// Keep in sync with CATEGORY_EDITORS in server/src/routes/catalog.ts.
const CATEGORY_EDITORS: Partial<Record<CategoryType, string[]>> = {
  supplier: ['procurement'],
  inventory: ['procurement'],
};

/** Full control: every type, including archive and delete. */
export function canManageCategories(role?: string | null) {
  return CATEGORY_MANAGER_ROLES.includes(role || '');
}

export function canAddCategory(role: string | null | undefined, type: CategoryType) {
  return canManageCategories(role) || (CATEGORY_EDITORS[type] || []).includes(role || '');
}

/** Category types a role may add to, in display order. */
export function editableCategoryTypes(role?: string | null) {
  return (Object.keys(CATEGORY_TYPE_LABELS) as CategoryType[]).filter(type => canAddCategory(role, type));
}

const changeListeners = new Set<(type: CategoryType) => void>();

/** Makes every mounted `useCategories(type)` refetch. */
export function notifyCategoriesChanged(type: CategoryType) {
  changeListeners.forEach(listener => listener(type));
}

export function useCategories(type: CategoryType) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const listener = (changed: CategoryType) => { if (changed === type) setVersion(v => v + 1); };
    changeListeners.add(listener);
    return () => { changeListeners.delete(listener); };
  }, [type]);

  useEffect(() => {
    let cancelled = false;
    catalogApi.getCategories({ type, active: true })
      .then(res => { if (!cancelled) setCategories(res.data); })
      .catch(() => { if (!cancelled) setCategories([]); });
    return () => { cancelled = true; };
  }, [type, version]);

  return categories;
}

/**
 * Names to offer in a category dropdown. Records saved before a category was
 * archived or renamed keep their old value, so it is kept selectable.
 */
export function categoryOptions(categories: Category[], currentValue?: string | null) {
  const names = categories.map(c => c.name);
  if (currentValue && !names.includes(currentValue)) names.unshift(currentValue);
  return names;
}
