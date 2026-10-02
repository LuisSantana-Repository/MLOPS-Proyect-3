import { AnnotateScreen } from "@p2/components/annotate/AnnotateScreen";
import { AppLayout } from "@p2/components/layout/AppLayout";
import { UploadScreen } from "@p2/components/upload/UploadScreen";
import { DashboardPage } from "@p2/pages/Dashboard";
import { AnalyticsPage } from "@p2/pages/quality/AnalyticsPage";
import { AnalyzersPage } from "@p2/pages/quality/AnalyzersPage";
import { CopilotPage } from "@p2/pages/quality/CopilotPage";
import { OverviewPage } from "@p2/pages/quality/OverviewPage";
import { SettingsPage } from "@p2/pages/quality/SettingsPage";
import { SplitsPage } from "@p2/pages/quality/SplitsPage";
import { VersionsPage } from "@p2/pages/quality/VersionsPage";
import { SearchPage } from "@p2/pages/SearchPage";
import { Navigate, Route, Routes } from "react-router-dom";

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        path="/dashboard"
        element={
          <AppLayout>
            <DashboardPage />
          </AppLayout>
        }
      />
      {/* SearchPage se envuelve con AppLayout internamente (no aquí), porque
          necesita pasarle su propio contenido de filtros como sidebarExtra
          — ver SearchPage.tsx. */}
      <Route path="/search" element={<SearchPage />} />
      <Route
        path="/upload"
        element={
          <AppLayout>
            <UploadScreen />
          </AppLayout>
        }
      />
      {/* Seis vistas de calidad del Proyecto 2 (Frente 3). */}
      <Route
        path="/overview"
        element={
          <AppLayout>
            <OverviewPage />
          </AppLayout>
        }
      />
      <Route
        path="/analyzers"
        element={
          <AppLayout>
            <AnalyzersPage />
          </AppLayout>
        }
      />
      <Route
        path="/analytics"
        element={
          <AppLayout>
            <AnalyticsPage />
          </AppLayout>
        }
      />
      <Route
        path="/splits"
        element={
          <AppLayout>
            <SplitsPage />
          </AppLayout>
        }
      />
      <Route
        path="/versions"
        element={
          <AppLayout>
            <VersionsPage />
          </AppLayout>
        }
      />
      <Route
        path="/settings"
        element={
          <AppLayout>
            <SettingsPage />
          </AppLayout>
        }
      />
      <Route
        path="/copilot"
        element={
          <AppLayout>
            <CopilotPage />
          </AppLayout>
        }
      />
      {/* Annotate es un modo de enfoque de pantalla completa a propósito: sin
          nav global, con su propio botón "Volver". Ver GlobalNav.tsx. */}
      <Route path="/annotate/:imageId" element={<AnnotateScreen />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
