import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { Login } from './routes/Login';
import { Init } from './routes/Init';
import { AdminLayout } from './routes/Admin/Layout';
import { AdminCategories } from './routes/Admin/Categories';
import { AdminLinks } from './routes/Admin/Links';
import { AdminToken } from './routes/Admin/Token';
import { AdminImportExport } from './routes/Admin/ImportExport';
import { AdminTheme } from './routes/Admin/Theme';
import { AdminSettings } from './routes/Admin/Settings';
import { AdminAiConfig } from './routes/Admin/AiConfig';
import { AdminOpLogs } from './routes/Admin/OpLogs';
import { AdminAssistant } from './routes/Admin/Assistant';

// 默认值:30s 内不重拉(切页/聚焦不重复请求);写操作经 useInvalidatingMutation 手动失效,不依赖焦点重拉
const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <Toaster position="top-center" />
      <BrowserRouter>
        <Routes>
          <Route path="/admin/init" element={<Init />} />
          <Route path="/admin/login" element={<Login />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/categories" replace />} />
            <Route path="categories" element={<AdminCategories />} />
            <Route path="links" element={<AdminLinks />} />
            <Route path="token" element={<AdminToken />} />
            <Route path="import-export" element={<AdminImportExport />} />
            <Route path="theme" element={<AdminTheme />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="op-logs" element={<AdminOpLogs />} />
            <Route path="ai-config" element={<AdminAiConfig />} />
            <Route path="assistant" element={<AdminAssistant />} />
          </Route>
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
