import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Home } from './routes/Home';
import { Login } from './routes/Login';
import { Init } from './routes/Init';
import { AdminLayout } from './routes/Admin/Layout';
import { AdminCategories } from './routes/Admin/Categories';
import { AdminLinks } from './routes/Admin/Links';
import { AdminToken } from './routes/Admin/Token';
import { AdminImportExport } from './routes/Admin/ImportExport';

const qc = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/init" element={<Init />} />
          <Route path="/login" element={<Login />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/categories" replace />} />
            <Route path="categories" element={<AdminCategories />} />
            <Route path="links" element={<AdminLinks />} />
            <Route path="token" element={<AdminToken />} />
            <Route path="import-export" element={<AdminImportExport />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
