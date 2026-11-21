import { Download, Search } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { UserFilter, UserSort } from './api';

export const FILTERS: UserFilter[] = [
  'all',
  'active',
  'deactivated',
  'admins',
  'pushOff',
  'storageHigh',
];
export const SORTS: UserSort[] = ['newest', 'oldest', 'name', 'lastActive', 'storage'];

const SELECT =
  'h-10 rounded-lg border bg-surface px-3 text-sm shadow-sm outline-none focus-visible:border-brand-text focus-visible:ring-3 focus-visible:ring-brand/20 pointer-coarse:h-11';

/** Search, filter, sort and the CSV download, in one row that wraps on a phone. */
export function UsersToolbar({
  search,
  onSearch,
  filter,
  onFilter,
  sort,
  onSort,
  onExport,
  exporting,
}: {
  search: string;
  onSearch: (value: string) => void;
  filter: UserFilter;
  onFilter: (value: UserFilter) => void;
  sort: UserSort;
  onSort: (value: UserSort) => void;
  onExport: () => void;
  exporting: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="relative min-w-0 flex-[1_1_16rem]">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={t('admin.searchUsers')}
          aria-label={t('admin.searchUsers')}
          className="pl-9 pointer-coarse:h-11"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-filter`} className="text-xs font-medium text-text-muted">
          {t('adminPanel.users.filterLabel')}
        </label>
        <select
          id={`${id}-filter`}
          value={filter}
          onChange={(event) => onFilter(event.target.value as UserFilter)}
          className={SELECT}
        >
          {FILTERS.map((value) => (
            <option key={value} value={value}>
              {t(`adminPanel.users.filter.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-sort`} className="text-xs font-medium text-text-muted">
          {t('adminPanel.users.sortLabel')}
        </label>
        <select
          id={`${id}-sort`}
          value={sort}
          onChange={(event) => onSort(event.target.value as UserSort)}
          className={SELECT}
        >
          {SORTS.map((value) => (
            <option key={value} value={value}>
              {t(`adminPanel.users.sort.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <Button
        variant="outline"
        onClick={onExport}
        disabled={exporting}
        className="pointer-coarse:h-11"
      >
        <Download className="size-4" aria-hidden />
        {t('adminPanel.users.export')}
      </Button>
    </div>
  );
}
