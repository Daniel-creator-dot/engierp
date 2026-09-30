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

export function useCategories(type: CategoryType) {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    let cancelled = false;
    catalogApi.getCategories({ type, active: true })
      .then(res => { if (!cancelled) setCategories(res.data); })
      .catch(() => { if (!cancelled) setCategories([]); });
    return () => { cancelled = true; };
  }, [type]);

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
