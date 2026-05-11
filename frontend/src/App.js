import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "./components/ui/sonner";

import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";

import LoginAgent from "./pages/LoginAgent";
import LoginMaster from "./pages/LoginMaster";
import LoginAdmin from "./pages/LoginAdmin";
import AgentDashboard from "./pages/AgentDashboard";
import AgentQueueSelect from "./pages/AgentQueueSelect";
import Dashboard from "./pages/Dashboard";
import Realtime from "./pages/Realtime";
import Recordings from "./pages/Recordings";
import Reports from "./pages/Reports";
import Queues from "./pages/Queues";
import Agents from "./pages/Agents";
import Extensions from "./pages/Extensions";
import TvPanel from "./pages/TvPanel";
import Users from "./pages/Users";
import RoleTemplates from "./pages/RoleTemplates";
import Auditoria from "./pages/Auditoria";
import Provisioning from "./pages/Provisioning";
import Manager from "./pages/Manager";
import Strategic from "./pages/Strategic";
import ScheduledReports from "./pages/ScheduledReports";
import AuditLogs from "./pages/AuditLogs";
import Tenants from "./pages/Tenants";
import Plans from "./pages/Plans";
import BillingSettings from "./pages/BillingSettings";
import Charges from "./pages/Charges";
import FusionPBXSettings from "./pages/FusionPBXSettings";
import SystemUpdate from "./pages/SystemUpdate";
import SiteBranding from "./pages/SiteBranding";
import SuperAdmins from "./pages/SuperAdmins";
import VersionWatcher from "./components/VersionWatcher";
import BrandingLoader from "./components/BrandingLoader";

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <VersionWatcher />
          <BrandingLoader />
          <Routes>
            <Route path="/login" element={<LoginAgent />} />
            <Route path="/master" element={<LoginMaster />} />
            <Route path="/admin" element={<LoginAdmin />} />
            <Route path="/" element={<ProtectedRoute hint="master"><Dashboard /></ProtectedRoute>} />
            <Route path="/agent" element={<ProtectedRoute><AgentDashboard /></ProtectedRoute>} />
            <Route path="/agent/select-queues" element={<ProtectedRoute><AgentQueueSelect /></ProtectedRoute>} />
            <Route path="/realtime" element={<ProtectedRoute><Realtime /></ProtectedRoute>} />
            <Route path="/recordings" element={<ProtectedRoute><Recordings /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute hint="master"><Reports /></ProtectedRoute>} />
            <Route path="/strategic" element={<ProtectedRoute hint="master"><Strategic /></ProtectedRoute>} />
            <Route path="/scheduled-reports" element={<ProtectedRoute hint="master"><ScheduledReports /></ProtectedRoute>} />
            <Route path="/queues" element={<ProtectedRoute hint="master"><Queues /></ProtectedRoute>} />
            <Route path="/agents" element={<ProtectedRoute hint="master"><Agents /></ProtectedRoute>} />
            <Route path="/extensions" element={<ProtectedRoute hint="master"><Extensions /></ProtectedRoute>} />
            <Route path="/tv" element={<ProtectedRoute hint="master"><TvPanel /></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute hint="master"><Users /></ProtectedRoute>} />
            <Route path="/role-templates" element={<ProtectedRoute hint="master"><RoleTemplates /></ProtectedRoute>} />
            <Route path="/auditoria" element={<ProtectedRoute hint="master"><Auditoria /></ProtectedRoute>} />
            <Route path="/provisioning" element={<ProtectedRoute hint="master"><Provisioning /></ProtectedRoute>} />
            <Route path="/manager" element={<ProtectedRoute hint="master"><Manager /></ProtectedRoute>} />
            <Route path="/audit" element={<ProtectedRoute hint="master"><AuditLogs /></ProtectedRoute>} />
            <Route path="/tenants" element={<ProtectedRoute requireSuperAdmin hint="admin"><Tenants /></ProtectedRoute>} />
            <Route path="/plans" element={<ProtectedRoute requireSuperAdmin hint="admin"><Plans /></ProtectedRoute>} />
            <Route path="/billing" element={<ProtectedRoute requireSuperAdmin hint="admin"><BillingSettings /></ProtectedRoute>} />
            <Route path="/charges" element={<ProtectedRoute requireSuperAdmin hint="admin"><Charges /></ProtectedRoute>} />
            <Route path="/fusionpbx" element={<ProtectedRoute hint="master"><FusionPBXSettings /></ProtectedRoute>} />
            <Route path="/system" element={<ProtectedRoute requireSuperAdmin hint="admin"><SystemUpdate /></ProtectedRoute>} />
            <Route path="/branding" element={<ProtectedRoute requireSuperAdmin hint="admin"><SiteBranding /></ProtectedRoute>} />
            <Route path="/super-admins" element={<ProtectedRoute requireSuperAdmin hint="admin"><SuperAdmins /></ProtectedRoute>} />
          </Routes>
          <Toaster richColors position="top-right" />
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
