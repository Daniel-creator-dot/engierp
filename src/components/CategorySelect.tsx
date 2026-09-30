import React, { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useAuth } from '../contexts/AuthContext';
import { apiErrorMessage, catalogApi, CategoryType } from '../lib/api';
import { canAddCategory, CATEGORY_TYPE_LABELS, categoryOptions, notifyCategoriesChanged, useCategories } from '../lib/catalog';

const ADD_NEW = '__add_new_category__';

interface CategorySelectProps {
  type: CategoryType;
  /** Form field name, so uncontrolled forms can read the value through FormData. */
  name?: string;
  value?: string;
  defaultValue?: string | null;
  onValueChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  triggerClassName?: string;
  contentClassName?: string;
}

/**
 * Dropdown of active categories of one type. Roles allowed to add categories of
 * that type also get an "Add new category" option that creates and selects it.
 */
export default function CategorySelect({
  type,
  name,
  value,
  defaultValue,
  onValueChange,
  required,
  disabled,
  placeholder = 'Select category...',
  triggerClassName,
  contentClassName,
}: CategorySelectProps) {
  const { user } = useAuth();
  const categories = useCategories(type);
  const [internalValue, setInternalValue] = useState(defaultValue || '');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const current = value !== undefined ? value : internalValue;
  const canAdd = canAddCategory(user?.role, type);
  const label = CATEGORY_TYPE_LABELS[type].toLowerCase();

  const select = (next: string) => {
    if (value === undefined) setInternalValue(next);
    onValueChange?.(next);
  };

  const handleValueChange = (next: string) => {
    if (next === ADD_NEW) {
      setNewName('');
      setNewDescription('');
      // Let the dropdown finish closing before the dialog takes focus.
      setTimeout(() => setDialogOpen(true), 0);
      return;
    }
    select(next);
  };

  const createCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    // The dialog is portaled, but React still bubbles submit to any enclosing form.
    e.stopPropagation();
    const trimmed = newName.trim();
    if (!trimmed) return;
    setIsSaving(true);
    try {
      const res = await catalogApi.createCategory({ type, name: trimmed, description: newDescription.trim() || null });
      notifyCategoriesChanged(type);
      select(res.data.name);
      toast.success(`Added "${res.data.name}"`);
      setDialogOpen(false);
    } catch (error: any) {
      const existing = error?.response?.status === 409 ? error.response.data?.category : null;
      if (existing?.is_active) {
        notifyCategoriesChanged(type);
        select(existing.name);
        toast.info(`"${existing.name}" already exists, so it has been selected.`);
        setDialogOpen(false);
      } else {
        toast.error(apiErrorMessage(error, 'Failed to add category'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Select name={name} value={current} onValueChange={handleValueChange} required={required} disabled={disabled}>
        <SelectTrigger className={triggerClassName}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent className={contentClassName}>
          {categoryOptions(categories, current).map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
          {canAdd && (
            <>
              {categories.length > 0 && <SelectSeparator />}
              <SelectItem value={ADD_NEW} className="text-blue-700 font-semibold">
                <span className="flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add new category…</span>
              </SelectItem>
            </>
          )}
        </SelectContent>
      </Select>

      {canAdd && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="rounded-2xl sm:max-w-md">
            <form onSubmit={createCategory}>
              <DialogHeader>
                <DialogTitle>New {label} category</DialogTitle>
                <DialogDescription>It will be available in every {label} category list straight away.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor={`new-${type}-category-name`}>Name</Label>
                  <Input
                    id={`new-${type}-category-name`}
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. Food & Canteen Services"
                    maxLength={100}
                    required
                    autoFocus
                    className="bg-[#F5F5F5] border-none rounded-xl h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`new-${type}-category-description`}>Description (optional)</Label>
                  <Input
                    id={`new-${type}-category-description`}
                    value={newDescription}
                    onChange={e => setNewDescription(e.target.value)}
                    className="bg-[#F5F5F5] border-none rounded-xl h-11"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" className="rounded-xl" onClick={() => setDialogOpen(false)} disabled={isSaving}>Cancel</Button>
                <Button type="submit" className="bg-[#141414] text-white rounded-xl" disabled={isSaving || !newName.trim()}>
                  {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Add category
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
