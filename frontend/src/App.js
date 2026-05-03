import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";

import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Realtime from "./pages/Realtime";
import Recordings from "./pages/Recordings";
import Reports from "./pages/Reports";
import Queues from "./pages/Queues";
import Agents from "./pages/Agents";
import TvPanel from "./pages/TvPanel";
import Users from "./pages/Users";
import AuditLogs from "./pages/AuditLogs";
import Tenants from "./pages/Tenants";
import Plans from "./pages/Plans";
import BillingSettings from "./pages/BillingSettings";
import Charges from "./pages/Charges";
import FusionPBXSettings from "./pages/FusionPBXSettings";

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/realtime" element={<ProtectedRoute><Realtime /></ProtectedRoute>} />
            <Route path="/recordings" element={<ProtectedRoute><Recordings /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="/queues" element={<ProtectedRoute><Queues /></ProtectedRoute>} />
            <Route path="/agents" element={<ProtectedRoute><Agents /></ProtectedRoute>} />
            <Route path="/tv" element={<ProtectedRoute><TvPanel /></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute><Users /></ProtectedRoute>} />
            <Route path="/audit" element={<ProtectedRoute><AuditLogs /></ProtectedRoute>} />
            <Route path="/tenants" element={<ProtectedRoute requireSuperAdmin><Tenants /></ProtectedRoute>} />
            <Route path="/plans" element={<ProtectedRoute requireSuperAdmin><Plans /></ProtectedRoute>} />
            <Route path="/billing" element={<ProtectedRoute requireSuperAdmin><BillingSettings /></ProtectedRoute>} />
            <Route path="/charges" element={<ProtectedRoute requireSuperAdmin><Charges /></ProtectedRoute>} />
            <Route path="/fusionpbx" element={<ProtectedRoute><FusionPBXSettings /></ProtectedRoute>} />
          </Routes>
          <Toaster richColors position="top-right" />
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
