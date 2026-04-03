import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import StaffLogin from './pages/StaffLogin';
import ChangePassword from './pages/ChangePassword';
import StaffDashboard from './pages/StaffDashboard';
import AttendanceHistory from './pages/AttendanceHistory';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<StaffLogin />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/dashboard" element={<StaffDashboard />} />
        <Route path="/history" element={<AttendanceHistory />} />
      </Routes>
    </Router>
  );
}

export default App;
