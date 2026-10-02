import { AppLayout } from "@p2/components/layout/AppLayout";
import { DeleteImagesModal } from "@p2/components/search/DeleteImagesModal";
import { FilterChips } from "@p2/components/search/FilterChips";
import { FiltersSidebar } from "@p2/components/search/FiltersSidebar";
import { ImagePreviewModal } from "@p2/components/search/ImagePreviewModal";
import { Pagination } from "@p2/components/search/Pagination";
import { ResultsGrid } from "@p2/components/search/ResultsGrid";
import { SearchBar } from "@p2/components/search/SearchBar";
import { SelectionToolbar } from "@p2/components/search/SelectionToolbar";
import { ToastStack } from "@p2/components/shared/ToastStack";
import { useCategories } from "@p2/hooks/useCategories";
import { useImageSearch } from "@p2/hooks/useImageSearch";
import { useToasts } from "@p2/hooks/useToasts";
import { deleteImage } from "@p2/lib/api/images";
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  hasActiveFilters,
  type SearchFilters,
} from "@p2/lib/searchFilters";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

export function SearchPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = filtersFromSearchParams(searchParams);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const { toasts, showToast, dismissToast } = useToasts();
  const {
    categories,
    isLoading: categoriesLoading,
    error: categoriesError,
    retry: retryCategories,
  } = useCategories();
  const { images, pagination, isLoading, error, retry } = useImageSearch(filters);

  function applyFilters(next: Partial<SearchFilters>): void {
    const merged: SearchFilters = { ...filters, ...next };
    setSearchParams(filtersToSearchParams(merged));
  }

  function toggleSelect(id: number): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDeleteConfirm(): Promise<void> {
    setIsDeleting(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map((id) => deleteImage(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    const succeeded = ids.length - failed;

    setIsDeleting(false);
    setIsDeleteModalOpen(false);
    setSelectedIds(new Set());

    if (succeeded > 0) {
      showToast(
        `${succeeded} ${succeeded === 1 ? "foto eliminada" : "fotos eliminadas"}.`,
        "success",
      );
    }
    if (failed > 0) {
      showToast(`No se pudo eliminar ${failed} ${failed === 1 ? "foto" : "fotos"}.`, "error");
    }
    retry();
  }

  function handleExport(): void {
    // Solo visual por ahora, a propósito: todavía no conectado a un endpoint de exportación.
  }

  return (
    <AppLayout
      sidebarExtra={
        <FiltersSidebar
          filters={filters}
          categories={categories}
          categoriesLoading={categoriesLoading}
          categoriesError={categoriesError}
          onRetryCategories={retryCategories}
          onChangeFilters={applyFilters}
        />
      }
    >
      <main className="flex-1 px-6 py-8 lg:px-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-5">
          <header className="flex flex-col gap-3">
            <h1 className="text-xl font-semibold text-ink">Buscar fotografías</h1>
            <SearchBar initialValue={filters.q} onSearch={(q) => applyFilters({ q, page: 1 })} />
            <FilterChips filters={filters} categories={categories} onChange={applyFilters} />
          </header>

          {selectedIds.size > 0 && (
            <SelectionToolbar
              count={selectedIds.size}
              onClearSelection={() => setSelectedIds(new Set())}
              onDelete={() => setIsDeleteModalOpen(true)}
              onExport={handleExport}
            />
          )}

          <div className="flex items-center justify-between">
            <p className="text-sm text-ink-muted">
              {pagination ? `${pagination.total} resultados` : isLoading ? "Buscando…" : ""}
            </p>
          </div>

          <ResultsGrid
            images={images}
            isLoading={isLoading}
            error={error}
            hasActiveFilters={hasActiveFilters(filters)}
            onRetry={retry}
            onImageClick={setPreviewIndex}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
          />

          {pagination && pagination.total > 0 && (
            <Pagination pagination={pagination} onPageChange={(page) => applyFilters({ page })} />
          )}
        </div>
      </main>

      {previewIndex !== null && (
        <ImagePreviewModal
          images={images}
          initialIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}

      {isDeleteModalOpen && (
        <DeleteImagesModal
          count={selectedIds.size}
          isDeleting={isDeleting}
          onCancel={() => setIsDeleteModalOpen(false)}
          onConfirm={() => void handleDeleteConfirm()}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </AppLayout>
  );
}
